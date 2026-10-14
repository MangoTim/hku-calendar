// DB module — connection pool, schema bootstrap, seed migration.
import pg from 'pg';
import { AUDIT_EVENTS, SYSTEM_LOGS } from '../../src/lib/data.ts';
import { logSystem } from './audit.ts';

// Coerce DATE / TIME columns to ISO strings at the driver layer so they
// round-trip losslessly in any server timezone (the .105 / local / .103 VMs
// don't all run in UTC). Without this, `new Date('2025-10-29')` from a DATE
// column comes back as a local-midnight Date whose toISOString() shifts the
// date by ±1 day. Type OIDs:
//   1082 = date
//   1083 = time
//   1266 = timetz
//   1114 = timestamp
//   1184 = timestamptz → keep as Date (already correct)
pg.types.setTypeParser(1082, (val: string) => val);        // date → 'YYYY-MM-DD'
pg.types.setTypeParser(1083, (val: string) => val);        // time → 'HH:MM:SS'
pg.types.setTypeParser(1266, (val: string) => val);        // timetz → 'HH:MM:SS+Z'

const HOST = process.env.DB_HOST || '192.168.147.103';
const PORT = Number(process.env.DB_PORT || 5432);
const USER = process.env.DB_USER || 'postgres';
const PASSWORD = process.env.DB_PASSWORD || 'redhat';
const DATABASE = process.env.DB_NAME || 'engg_intranet';

const { Pool: PgPool } = pg;

let pool: pg.Pool | null = null;

async function ensureDatabaseExists(): Promise<void> {
  const adminPool = new PgPool({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' });
  try {
    const r = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE]);
    if (r.rowCount === 0) {
      // pg_database name must be safe identifier (no quotes)
      console.log(`[db] creating database "${DATABASE}" on ${HOST}:${PORT}`);
      await adminPool.query(`CREATE DATABASE "${DATABASE}"`);
    } else {
      console.log(`[db] database "${DATABASE}" already exists`);
    }
  } finally {
    await adminPool.end();
  }
}

async function ensureSchema(): Promise<void> {
  await pool!.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actor_username TEXT NOT NULL,
      actor_user_id INTEGER,
      action_type TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      summary TEXT,
      ip_address TEXT,
      success BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events (actor_username);

    CREATE TABLE IF NOT EXISTS system_logs (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      level TEXT NOT NULL CHECK (level IN ('INFO','WARN','ERROR','CRITICAL')),
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      detail TEXT,
      resolved BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs (level);

    -- Holiday storage (shared, org-wide). The HK 1823 canonical seed lives in
    -- code (HOLIDAYS_FLAT imported from src/lib/data.ts) — only deltas are
    -- persisted here: user-added/imported holidays + dates the admin has
    -- chosen to hide from the seed.
    CREATE TABLE IF NOT EXISTS holidays (
      date DATE PRIMARY KEY,
      name TEXT NOT NULL,
      import_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_holidays_import_id ON holidays (import_id);

    CREATE TABLE IF NOT EXISTS holiday_seed_removed (
      date DATE PRIMARY KEY,
      removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      removed_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS holiday_imports (
      import_id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('vcalendar','json','csv','xlsx')),
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      imported_by INTEGER,
      count INTEGER NOT NULL DEFAULT 0
    );

    -- Singleton row (id=1) for the Microsoft Entra / SSO integration
    -- managed by /admin/sso. Seeded from env on first boot; admins edit
    -- through the UI after that. client_secret is stored plaintext
    -- server-side (masked on read) — rotatable via Azure Portal.
    CREATE TABLE IF NOT EXISTS sso_config (
      id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      mode              TEXT NOT NULL CHECK (mode IN ('LOCAL','MIXED','SSO')),
      directory_mode    TEXT NOT NULL CHECK (directory_mode IN ('DEMO','GRAPH')),
      tenant_id         TEXT NOT NULL,
      authority_url     TEXT NOT NULL,
      client_id         TEXT NOT NULL,
      client_secret     TEXT NOT NULL,
      last_tested_at    TIMESTAMPTZ,
      last_test_result  TEXT,
      last_test_steps   JSONB,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by        INTEGER
    );

    -- Admin-controlled SSO allowlist. The bridge (/api/sso/callback) only
    -- signs a user in if their email (case-insensitive) matches a row here.
    -- Admins populate via /admin/users; empty by design at boot. The oid
    -- column records the last-seen Azure OID (fire-and-forget side-effect).
    CREATE TABLE IF NOT EXISTS sso_users (
      id                                  SERIAL PRIMARY KEY,
      email                               TEXT NOT NULL,
      display_name                        TEXT NOT NULL,
      username                            TEXT NOT NULL,
      oid                                 TEXT,
      role                                TEXT NOT NULL CHECK (role IN ('USER','TASK_MANAGER','ADMIN','AUDITOR')),
      team                                TEXT NOT NULL DEFAULT 'SSO',
      title                               TEXT NOT NULL DEFAULT '',
      enabled                             BOOLEAN NOT NULL DEFAULT TRUE,
      created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by                          INTEGER,
      updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by                          INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sso_users_email_lower ON sso_users (lower(email));
    CREATE INDEX IF NOT EXISTS idx_sso_users_role ON sso_users (role);

    -- Admin-editable email templates. One row per template (PRIMARY KEY on
    -- the 'code' column). Seeded from code on first boot so the IT-support
    -- email has something to render before any admin opens the UI. body_text
    -- is the source of truth; body_html is optional and used as-is when
    -- present, otherwise the server auto-generates HTML from body_text (with
    -- line breaks preserved). Variables use {{name}} and are substituted at
    -- send time. See server/src/email.ts for the supported list.
    CREATE TABLE IF NOT EXISTS email_templates (
      code          TEXT PRIMARY KEY,
      subject       TEXT NOT NULL,
      body_text     TEXT NOT NULL,
      body_html     TEXT,
      description   TEXT NOT NULL DEFAULT '',
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by    INTEGER
    );

    -- Key-value store for runtime-editable app config (e.g. the IT team
    -- email used by /api/email/it-support). The row is seeded with an
    -- empty value on first boot if missing; smtpConfig() then falls
    -- back to the IT_TEAM_EMAIL env var when the row is empty so a
    -- bare dev deploy without IT_TEAM_EMAIL set still gets a sensible
    -- value. Admins edit via /admin/support and the next IT-support
    -- email pick up the new value (no restart needed).
    CREATE TABLE IF NOT EXISTS app_config (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by  INTEGER
    );
    INSERT INTO app_config (key, value) VALUES ('IT_TEAM_EMAIL', '')
      ON CONFLICT (key) DO NOTHING;
    -- Daily + weekly leave digest schedule (RFQ §2(c)). The hour is a
    -- 0-23 integer stored as text (matches the existing app_config pattern).
    -- Admins edit on /admin/email. The scheduler re-reads every tick so
    -- changes take effect on the next run.
    --
    -- LEAVE_DIGEST_DEFAULT_RECIPIENT: fallback recipient used when no
    -- user has the relevant Profile preference enabled. Lets the demo
    -- deliver a digest to a known mailbox even before any user has
    -- toggled their preferences on, so the feature can be verified
    -- without configuring SSO opt-in. Admins can clear or change it on
    -- /admin/email.
    INSERT INTO app_config (key, value) VALUES
        ('LEAVE_DIGEST_ENABLED',                  'true'),
        ('LEAVE_DIGEST_HOUR',                     '8'),
        ('WEEKLY_LEAVE_REPORT_HOUR',             '8'),
        ('LEAVE_DIGEST_DEFAULT_RECIPIENT',        'tim.wong@rainbowtech.com.hk')
      ON CONFLICT (key) DO NOTHING;

    -- leave_records — mirror of the FE localStorage leave. The FE books
    -- the save to localStorage first, then POSTs a mirror here. The
    -- scheduler reads from this table to compose the daily + weekly
    -- digest so emails fire even when no browser is open. PRIMARY KEY
    -- is (user_source, id) because seed LOCAL/DEMO users (1-21) and
    -- sso_users (1-N) share an id namespace; the source disambiguates.
    CREATE TABLE IF NOT EXISTS leave_records (
      user_id       INTEGER      NOT NULL,
      user_source   TEXT         NOT NULL CHECK (user_source IN ('LOCAL','DEMO','SSO')),
      type          TEXT         NOT NULL CHECK (type IN ('ANNUAL','SICK','UNPAID','MATERNITY','PATERNITY','COMPASSIONATE','STUDY')),
      start_date    DATE         NOT NULL,
      end_date      DATE         NOT NULL,
      note          TEXT         NOT NULL DEFAULT '',
      status        TEXT         NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED','CANCELLED')),
      team          TEXT         NOT NULL DEFAULT '',
      display_name  TEXT         NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_source, user_id, start_date, type)
    );
    CREATE INDEX IF NOT EXISTS idx_leave_records_team  ON leave_records (team);
    CREATE INDEX IF NOT EXISTS idx_leave_records_dates ON leave_records (start_date, end_date);

    -- booking_records — same idea. ref (e.g. RB-0017) is the natural
    -- primary key because the FE generates it from a counter at save time
    -- and uses it everywhere as the booking handle.
    CREATE TABLE IF NOT EXISTS booking_records (
      ref                TEXT         PRIMARY KEY,
      room_id            INTEGER      NOT NULL,
      room_name          TEXT         NOT NULL DEFAULT '',
      booked_by_id       INTEGER      NOT NULL,
      booked_by_source   TEXT         NOT NULL CHECK (booked_by_source IN ('LOCAL','DEMO','SSO')),
      booked_by_name     TEXT         NOT NULL,
      booked_by_email    TEXT         NOT NULL DEFAULT '',
      booked_by_team     TEXT         NOT NULL DEFAULT '',
      date               DATE         NOT NULL,
      start_time         TEXT         NOT NULL,
      end_time           TEXT         NOT NULL,
      purpose            TEXT         NOT NULL DEFAULT '',
      status             TEXT         NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','CANCELLED')),
      support_requests   TEXT         NOT NULL DEFAULT '',
      it_support         BOOLEAN      NOT NULL DEFAULT FALSE,
      team               TEXT         NOT NULL DEFAULT '',
      created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_booking_records_date     ON booking_records (date);
    CREATE INDEX IF NOT EXISTS idx_booking_records_team     ON booking_records (team);
    CREATE INDEX IF NOT EXISTS idx_booking_records_booked_by ON booking_records (booked_by_source, booked_by_id);

    -- digest_runs — idempotency log for the scheduler. Each scheduler
    -- tick INSERTs (job_name, run_date) ON CONFLICT DO NOTHING; if the
    -- insert returns 0 rows, the (job, day) was already claimed (e.g.
    -- by a manual-trigger run) and we bail. The row is updated at the
    -- end with finished_at + status + recipients_count.
    CREATE TABLE IF NOT EXISTS digest_runs (
      job_name         TEXT         NOT NULL,
      run_date         DATE         NOT NULL,
      started_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      finished_at      TIMESTAMPTZ,
      status           TEXT         NOT NULL DEFAULT 'STARTED' CHECK (status IN ('STARTED','OK','EMPTY','FAILED')),
      recipients_count INTEGER      NOT NULL DEFAULT 0,
      error            TEXT         NOT NULL DEFAULT '',
      PRIMARY KEY (job_name, run_date)
    );

    -- Id-rebase: keep sso_users.id out of the seed USERS range (1-21) so
    -- the FE's findById lookup can never collide with a seed row by
    -- accident. Idempotent: no-op once every row sits at id >= 10000.
    -- Future inserts get ids from sso_users_id_seq (now RESTARTed past
    -- 10000). Email is still the single source of truth for sign-in
    -- (the sso_session cookie carries email, not id) so existing
    -- cookies keep working through the migration.
    --
    -- Defensive against the on-.105 case where the sso_users table
    -- was created originally without a SERIAL sequence (column was
    -- INTEGER), or where the sequence was dropped afterwards:
    --   1. If the column has a serial sequence and it exists, setval
    --      it to MAX(id)+1.
    --   2. If pg_get_serial_sequence returns a name but the relation
    --      is gone (42P01 undefined_table), create it and bind it.
    --   3. If pg_get_serial_sequence returns NULL (no default on the
    --      column), create sso_users_id_seq from scratch and bind.
    DO $$
    DECLARE
      colliding_count INTEGER;
      next_id         BIGINT;
      seq_name        TEXT;
    BEGIN
      SELECT COUNT(*) INTO colliding_count FROM sso_users WHERE id < 10000;
      IF colliding_count = 0 THEN
        RETURN;
      END IF;
      UPDATE sso_users SET id = id + 10000 WHERE id < 10000;
      SELECT COALESCE(MAX(id), 10000) + 1 INTO next_id FROM sso_users;
      seq_name := pg_get_serial_sequence('sso_users', 'id');
      IF seq_name IS NULL THEN
        -- No default on the id column at all — create the sequence
        -- and bind it so future INSERTs (no explicit id) get fresh
        -- ids from the sso_users_id_seq counter.
        EXECUTE format('CREATE SEQUENCE sso_users_id_seq START WITH %s OWNED BY sso_users.id', next_id);
        EXECUTE 'ALTER TABLE sso_users ALTER COLUMN id SET DEFAULT nextval(''sso_users_id_seq''::regclass)';
        RAISE NOTICE '[db] sso_users: created new sso_users_id_seq starting at %', next_id;
      ELSE
        -- pg_get_serial_sequence can return a name even after the
        -- sequence was dropped (the column's default expression
        -- still references it). setval() raises 42P01 in that case;
        -- catch and recreate.
        BEGIN
          PERFORM setval(seq_name, next_id, false);
        EXCEPTION WHEN undefined_table THEN
          EXECUTE format('CREATE SEQUENCE %I START WITH %s OWNED BY sso_users.id', seq_name, next_id);
          EXECUTE format('ALTER TABLE sso_users ALTER COLUMN id SET DEFAULT nextval(%L::regclass)', seq_name);
          RAISE NOTICE '[db] sso_users: recreated missing sequence % starting at %', seq_name, next_id;
        END;
      END IF;
      RAISE NOTICE '[db] sso_users: rebased % row(s) past collision range (next id = %)', colliding_count, next_id;
    END $$;
  `);
  console.log('[db] schema ensured');
  // Migration event — fires every boot after ensureSchema. Operators
  // reading /admin/system-logs can confirm the server reached the
  // "schema is good" state. Distinguishes "booted but failed before
  // schema" from "booted cleanly". Best-effort: schema/system_logs
  // races on a brand-new DB are impossible (system_logs was just
  // created above), so this should never throw.
  logSystem('INFO', 'db', 'schema ensured',
    `db=${DATABASE} host=${HOST}:${PORT} user=${USER} tables=audit_events,system_logs,holidays,holiday_seed_removed,holiday_imports,sso_config,sso_users`
  ).catch(e => console.error('[syslog] schema-ensured event failed', e));
}

async function seedIfEmpty(): Promise<void> {
  const a = await pool!.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM audit_events');
  if (Number(a.rows[0].count) === 0) {
    console.log(`[db] inserting ${AUDIT_EVENTS.length} seed audit events`);
    for (const e of AUDIT_EVENTS) {
      await pool!.query(
        `INSERT INTO audit_events (id, created_at, actor_username, actor_user_id, action_type, resource_type, resource_id, summary, ip_address, success)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [e.id, e.createdAt, e.actorUsername, e.actorUserId, e.actionType, e.resourceType, e.resourceId, e.summary, e.ipAddress, e.success]
      );
    }
    // Re-sync the sequence past the max seeded id
    await pool!.query(`SELECT setval('audit_events_id_seq', (SELECT MAX(id) FROM audit_events))`);
    logSystem('INFO', 'db', `seeded ${AUDIT_EVENTS.length} audit events`, '').catch(() => {});
  }
  const s = await pool!.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM system_logs');
  if (Number(s.rows[0].count) === 0) {
    console.log(`[db] inserting ${SYSTEM_LOGS.length} seed system logs`);
    for (const l of SYSTEM_LOGS) {
      await pool!.query(
        `INSERT INTO system_logs (id, created_at, level, category, message, detail, resolved)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [l.id, l.createdAt, l.level, l.category, l.message, l.detail, l.resolved]
      );
    }
    await pool!.query(`SELECT setval('system_logs_id_seq', (SELECT MAX(id) FROM system_logs))`);
    logSystem('INFO', 'db', `seeded ${SYSTEM_LOGS.length} system logs`, '').catch(() => {});
  }

  // SSO singleton — seed from env on first boot so the existing .105 deploy
  // works without a manual admin action. After this, admins edit via /admin/sso.
  const ssoCount = await pool!.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM sso_config');
  if (Number(ssoCount.rows[0].count) === 0) {
    const tenant = process.env.AZURE_TENANT_ID || '';
    const client = process.env.AZURE_CLIENT_ID || '';
    const secret = process.env.AZURE_CLIENT_SECRET || '';
    const authority = tenant ? `https://login.microsoftonline.com/${tenant}` : '';
    await pool!.query(
      `INSERT INTO sso_config (id, mode, directory_mode, tenant_id, authority_url, client_id, client_secret)
       VALUES (1, 'MIXED', 'GRAPH', $1, $2, $3, $4)`,
      [tenant, authority, client, secret]
    );
    console.log(`[db] seeded sso_config row from env (tenant=${tenant ? 'set' : 'empty'})`);
    logSystem('INFO', 'db', 'seeded sso_config row from env',
      `tenant=${tenant ? 'set' : 'empty'} clientId=${client ? 'set' : 'empty'} secret=${secret ? 'set' : 'empty'}`
    ).catch(() => {});
  }

  // Bootstrap SSO admin from env. Solves the chicken-and-egg where the
  // admin UI is gated by an sso_session cookie but no sso_users row exists
  // yet for anyone to log in as. Reads SSO_SEED_ADMIN_EMAIL +
  // SSO_SEED_ADMIN_NAME; no-op if either is missing OR a row with that
  // email (case-insensitive) already exists. After bootstrap, admins
  // create the rest of the allowlist via /admin/users.
  const seedEmail = (process.env.SSO_SEED_ADMIN_EMAIL || '').trim();
  const seedName  = (process.env.SSO_SEED_ADMIN_NAME  || '').trim();
  if (seedEmail && seedName) {
    const dupe = await pool!.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sso_users WHERE lower(email) = lower($1)`,
      [seedEmail]
    );
    if (Number(dupe.rows[0].count) === 0) {
      const local = seedEmail.split('@')[0] || 'admin';
      await pool!.query(
        `INSERT INTO sso_users (email, display_name, username, role, team, title, enabled)
         VALUES ($1, $2, $3, 'ADMIN', 'SSO', 'Initial SSO Admin', TRUE)`,
        [seedEmail, seedName, local]
      );
      console.log(`[db] seeded initial SSO admin ${seedEmail} (display="${seedName}")`);
      logSystem('INFO', 'db', `seeded initial SSO admin ${seedEmail}`,
        `displayName="${seedName}" username="${local}" role=ADMIN source=SSO_SEED_ADMIN_EMAIL`
      ).catch(() => {});
    } else {
      console.log(`[db] SSO_SEED_ADMIN_EMAIL ${seedEmail} already exists — skipping seed`);
    }
  }

  // Seed the IT-support email template on first boot so /api/email/it-support
  // has a renderable template even before any admin opens /admin/email.
  // Idempotent — the ON CONFLICT DO UPDATE only overwrites empty body_text
  // (i.e., a row was created but never filled in) and never stomps admin edits
  // made through the UI.
  await pool!.query(
    `INSERT INTO email_templates (code, subject, body_text, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE
       SET subject     = COALESCE(NULLIF(email_templates.subject, ''), EXCLUDED.subject),
           body_text   = COALESCE(NULLIF(email_templates.body_text, ''), EXCLUDED.body_text),
           description = COALESCE(NULLIF(email_templates.description, ''), EXCLUDED.description),
           updated_at  = NOW()`,
    [
      'IT_SUPPORT',
      '[IT support] {{ref}} — {{date}} {{startTime}}–{{endTime}} · {{room}}',
      [
        'A room booking has been flagged for IT support.',
        '',
        'Booking reference : {{ref}}',
        'Date              : {{date}}',
        'Time              : {{startTime}} – {{endTime}}',
        'Room              : {{room}}',
        'Purpose           : {{purpose}}',
        '',
        'Booker',
        '  Name            : {{bookerName}}',
        '  Email           : {{bookerEmail}}',
        '  Team            : {{bookerTeam}}',
        '',
        'Support request',
        '  {{supportRequests}}',
        '',
        'Reply to this email to contact the booker directly.'
      ].join('\n'),
      'Sent to the IT team address when a booking is saved with "Request IT support" ticked. Variables in {{double braces}} are substituted at send time.'
    ]
  );

  // LEAVE_DIGEST — sent to opted-in users each morning at the configured
  // hour summarising TODAY's bookings + leave for THEIR team.
  //
  // Body uses simple `{{var}}` substitution (see emailTemplates.ts#renderTemplate).
  // digest.ts builds the per-row text for {{teamReservations}} and
  // {{teamLeave}} before substitution, so no block-helper engine is
  // required. Empty cases fall back to "(none)" / "(no one on leave
  // today)" in email.ts#sendLeaveDigest.
  await pool!.query(
    `INSERT INTO email_templates (code, subject, body_text, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE
       SET subject     = COALESCE(NULLIF(email_templates.subject, ''), EXCLUDED.subject),
           body_text   = COALESCE(NULLIF(email_templates.body_text, ''), EXCLUDED.body_text),
           description = COALESCE(NULLIF(email_templates.description, ''), EXCLUDED.description),
           updated_at  = NOW()`,
    [
      'LEAVE_DIGEST',
      '[ENGG Intranet] {{team}} digest — {{date}} ({{totalBookings}} bookings, {{totalLeave}} on leave)',
      [
        'Good morning, {{displayName}}.',
        '',
        'Here is your {{team}} team digest for {{date}}.',
        '',
        'Bookings today ({{totalBookings}})',
        '{{teamReservations}}',
        '',
        'Leave today ({{totalLeave}})',
        '{{teamLeave}}',
        '',
        'Reply to this email if anything looks wrong.',
        '— ENGG Intranet'
      ].join('\n'),
      'Daily 08:00 (configurable on /admin/email) — per-team summary of today\'s bookings + leave. Sent to users who enabled the "Morning team digest" toggle in Profile. Falls back to LEAVE_DIGEST_DEFAULT_RECIPIENT when no one is opted in.'
    ]
  );

  // WEEKLY_LEAVE_REPORT — Monday-morning, org-wide forward-looking 14 days.
  // Same `{{var}}`-only contract: {{leaveByDate}} is the pre-formatted
  // multi-line block built by digest.ts#loadWeeklyLeaveData.
  await pool!.query(
    `INSERT INTO email_templates (code, subject, body_text, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE
       SET subject     = COALESCE(NULLIF(email_templates.subject, ''), EXCLUDED.subject),
           body_text   = COALESCE(NULLIF(email_templates.body_text, ''), EXCLUDED.body_text),
           description = COALESCE(NULLIF(email_templates.description, ''), EXCLUDED.description),
           updated_at  = NOW()`,
    [
      'WEEKLY_LEAVE_REPORT',
      '[ENGG Intranet] Next 14 days of leave — {{fromDate}} → {{toDate}} ({{totalLeave}} total)',
      [
        'Good morning, {{displayName}}.',
        '',
        'Forward-looking leave report for the next 14 days',
        '({{fromDate}} → {{toDate}}) across all teams.',
        '',
        '{{leaveByDate}}',
        '',
        'Reply to this email if anything looks wrong.',
        '— ENGG Intranet'
      ].join('\n'),
      'Weekly Monday-morning (configurable on /admin/email) — org-wide forward 14-day leave calendar. Sent to users who enabled the "Monday two-week leave report" toggle in Profile. Falls back to LEAVE_DIGEST_DEFAULT_RECIPIENT when no one is opted in.'
    ]
  );
}

export async function initDb(): Promise<void> {
  await ensureDatabaseExists();
  pool = new PgPool({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: DATABASE, max: 5 });
  await ensureSchema();
  await seedIfEmpty();
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('DB pool not initialised — call initDb() first');
  return pool;
}