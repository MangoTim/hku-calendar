// app_config — runtime-editable key/value settings. Used today for the
// IT_TEAM_EMAIL address that /api/email/it-support sends to. The row is
// seeded by server/src/db.ts ensureSchema() with an empty value, and the
// resolver in server/src/email.ts falls back to the IT_TEAM_EMAIL env var
// when the row is empty so a fresh deploy doesn't lose the value baked
// into the container's -e flag.
//
// Future keys (e.g. SMTP_FROM, notification toggles) can drop in here
// without a schema migration — just add a new INSERT in db.ts and a
// getter in this file.

import { getPool } from './db.ts';

export type ConfigKey = 'IT_TEAM_EMAIL';

export interface AppConfigEntry {
  key: ConfigKey | string;
  value: string;
  updatedAt: string;
}

export async function getConfigValue(key: string): Promise<string | null> {
  const r = await getPool().query(
    `SELECT value FROM app_config WHERE key = $1 LIMIT 1`,
    [key]
  );
  if (r.rowCount === 0) return null;
  return r.rows[0].value;
}

export async function setConfigValue(
  key: string,
  value: string,
  updatedBy: number | null
): Promise<void> {
  await getPool().query(
    `INSERT INTO app_config (key, value, updated_at, updated_by)
       VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (key) DO UPDATE
       SET value      = EXCLUDED.value,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by`,
    [key, value, updatedBy]
  );
}

export async function listConfig(): Promise<AppConfigEntry[]> {
  const r = await getPool().query(
    `SELECT key, value, updated_at FROM app_config ORDER BY key`
  );
  return r.rows.map(row => ({
    key: row.key,
    value: row.value ?? '',
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at)
  }));
}