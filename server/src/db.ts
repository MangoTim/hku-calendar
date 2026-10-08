// DB module — connection pool, schema bootstrap, seed migration.
import pg from 'pg';
import { AUDIT_EVENTS, SYSTEM_LOGS } from '../../src/lib/data.ts';

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