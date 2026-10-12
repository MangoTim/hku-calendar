// sso_users — admin-controlled SSO allowlist.
//
// The /api/sso/callback handler signs a user in ONLY if their ID-token email
// (case-insensitive) matches an enabled row here. Rows are created by admins
// through /admin/users; the table is empty at boot by design.
//
// Email lookup is the single source of truth — `findSsoUserByEmail` is used
// by both /api/sso/callback (during login) and /api/sso/users/lookup (FE
// bridge). `recordSsoOidByEmail` is a fire-and-forget side-effect of every
// successful login so admins can see which Azure OID last used a row.

import { getPool } from './db.ts';

export type SsoRole = 'USER' | 'TASK_MANAGER' | 'ADMIN' | 'AUDITOR';

export interface SsoDbUser {
  id: number;
  email: string;
  displayName: string;
  username: string;
  oid: string | null;
  role: SsoRole;
  team: string;
  title: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SsoUserInput {
  email: string;
  displayName: string;
  username?: string;
  role: SsoRole;
  team?: string;
  title?: string;
  enabled?: boolean;
}

export class SsoUserEmailTakenError extends Error {
  constructor(email: string) { super(`email already registered: ${email}`); }
}

const SELECT_COLS = `id, email, display_name, username, oid, role, team, title, enabled, created_at, updated_at`;

export async function listSsoUsers(): Promise<SsoDbUser[]> {
  const r = await getPool().query(`SELECT ${SELECT_COLS} FROM sso_users ORDER BY lower(email)`);
  return r.rows.map(rowToUser);
}

export async function findSsoUserByEmail(email: string): Promise<SsoDbUser | null> {
  if (!email) return null;
  const r = await getPool().query(
    `SELECT ${SELECT_COLS} FROM sso_users WHERE lower(email) = lower($1) LIMIT 1`,
    [email]
  );
  if (r.rowCount === 0) return null;
  return rowToUser(r.rows[0]);
}

export async function getSsoUserById(id: number): Promise<SsoDbUser | null> {
  const r = await getPool().query(
    `SELECT ${SELECT_COLS} FROM sso_users WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (r.rowCount === 0) return null;
  return rowToUser(r.rows[0]);
}

export async function createSsoUser(
  input: SsoUserInput,
  createdBy: number | null
): Promise<SsoDbUser> {
  const username = (input.username || input.email.split('@')[0] || 'sso').slice(0, 64);
  const team = input.team ?? 'SSO';
  const title = input.title ?? '';
  const enabled = input.enabled !== false;
  try {
    const r = await getPool().query(
      `INSERT INTO sso_users (email, display_name, username, role, team, title, enabled, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING ${SELECT_COLS}`,
      [input.email, input.displayName, username, input.role, team, title, enabled, createdBy]
    );
    return rowToUser(r.rows[0]);
  } catch (e: any) {
    if (e && e.code === '23505') throw new SsoUserEmailTakenError(input.email);
    throw e;
  }
}

export async function updateSsoUser(
  id: number,
  input: Partial<SsoUserInput>,
  updatedBy: number | null
): Promise<SsoDbUser | null> {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (input.email !== undefined)        { sets.push(`email = $${i++}`);        vals.push(input.email); }
  if (input.displayName !== undefined)  { sets.push(`display_name = $${i++}`); vals.push(input.displayName); }
  if (input.username !== undefined)     { sets.push(`username = $${i++}`);     vals.push(input.username); }
  if (input.role !== undefined)         { sets.push(`role = $${i++}`);         vals.push(input.role); }
  if (input.team !== undefined)         { sets.push(`team = $${i++}`);         vals.push(input.team); }
  if (input.title !== undefined)        { sets.push(`title = $${i++}`);        vals.push(input.title); }
  if (input.enabled !== undefined)      { sets.push(`enabled = $${i++}`);      vals.push(input.enabled); }
  sets.push(`updated_at = NOW()`);
  sets.push(`updated_by = $${i++}`);
  vals.push(updatedBy);
  vals.push(id);
  try {
    const r = await getPool().query(
      `UPDATE sso_users SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${SELECT_COLS}`,
      vals
    );
    if (r.rowCount === 0) return null;
    return rowToUser(r.rows[0]);
  } catch (e: any) {
    if (e && e.code === '23505') throw new SsoUserEmailTakenError(String(input.email ?? ''));
    throw e;
  }
}

export async function deleteSsoUser(id: number): Promise<boolean> {
  const r = await getPool().query('DELETE FROM sso_users WHERE id = $1', [id]);
  return (r.rowCount ?? 0) > 0;
}

/** Fire-and-forget. /api/sso/callback writes the last-seen Azure OID so admins
 *  can audit which directory identity used each row. */
export async function recordSsoOidByEmail(email: string, oid: string): Promise<void> {
  if (!email || !oid) return;
  await getPool().query(
    `UPDATE sso_users SET oid = $1, updated_at = NOW()
     WHERE lower(email) = lower($2)`,
    [oid, email]
  );
}

// ---------- helpers ----------
function rowToUser(r: any): SsoDbUser {
  const ts = (v: any): string => v instanceof Date ? v.toISOString() : (v ?? null);
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    username: r.username,
    oid: r.oid ?? null,
    role: r.role,
    team: r.team,
    title: r.title,
    enabled: r.enabled,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at)
  };
}