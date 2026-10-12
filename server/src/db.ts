// DB module — connection pool, schema bootstrap, seed migration.
import pg from 'pg';
import { AUDIT_EVENTS, SYSTEM_LOGS } from '../../src/lib/data.ts';

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
  `);
  console.log('[db] schema ensured');
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
  }
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