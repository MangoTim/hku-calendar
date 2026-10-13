// Audit + System Logs + Backups API server (Bun + Express + pg + fs).
// Listens on $PORT (default 8092). In dev it only serves /api + /health; in
// prod (when the Vite `dist/` is present) it also serves the static React
// bundle with SPA fallback so the whole demo lives on a single port.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { promises as fs } from 'node:fs';
import express from 'express';
import cors from 'cors';
import { initDb, getPool } from './db.ts';
import { listBackups, saveBackup, loadBackup, deleteBackup, pruneOldBackups } from './backups.ts';
import {
  getMergedHolidays,
  listImports,
  addHoliday,
  removeHoliday,
  importHolidays,
  removeImport,
  resetHolidays
} from './holidays.ts';
import {
  listTables,
  listAllTablesWithColumns,
  listForeignKeys,
  sampleRows,
  countRows,
  refreshAllowList,
  isAllowedTable
} from './introspect.ts';
import { initSso } from './sso.ts';
import { getSsoConfig, saveSsoConfig, testSsoConnection } from './ssoConfig.ts';
// Shared secret for sso_session and local_admin cookies. Lives in its own
// module so the default literal is the same in both the signer (sso.ts)
// and the verifier (index.ts) — otherwise an SSO-signed-in admin can
// call /api/auth/session but not /api/sso/users.
import { COOKIE_SECRET } from './cookieSecret.ts';
import {
  listSsoUsers,
  findSsoUserByEmail,
  getSsoUserById,
  createSsoUser,
  updateSsoUser,
  deleteSsoUser,
  SsoUserEmailTakenError
} from './ssoUsers.ts';
import type { HolidayFormat } from '../../src/lib/types.ts';
import * as jose from 'jose';
import { logAudit, logSystem } from './audit.ts';

const PORT = Number(process.env.PORT || 8092);
const HOST = process.env.HOST || '0.0.0.0';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolves /app/dist when this file lives at /app/server/src/index.ts.
const DIST_DIR = resolve(__dirname, '..', '..', 'dist');

await initDb();
const pool = getPool();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ----- SSO (Phase 7b stub — see server/src/sso.ts) -----
initSso(app);

// ----- SSO admin: config GET/PUT + test -----
// /admin/sso is the UI; these are the endpoints it talks to. The secret is
// stored plaintext server-side (rotatable via Azure Portal → Certificates
// & secrets) and masked before being sent to the FE — the FE never holds
// the plaintext secret.
app.get('/api/sso/config', async (_req, res) => {
  try {
    const c = await getSsoConfig();
    const masked = c.clientSecret
      ? '*'.repeat(Math.max(0, c.clientSecret.length - 4)) + c.clientSecret.slice(-4)
      : '';
    res.json({
      mode: c.mode,
      directoryMode: c.directoryMode,
      tenantId: c.tenantId,
      authorityUrl: c.authorityUrl,
      clientId: c.clientId,
      clientSecretMasked: masked,
      lastTestedAt: c.lastTestedAt,
      lastTestResult: c.lastTestResult,
      lastTestSteps: c.lastTestSteps
    });
  } catch (e: any) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.put('/api/sso/config', async (req, res) => {
  const b = req.body ?? {};
  const { mode, directoryMode, tenantId, authorityUrl, clientId, clientSecret } = b;
  if (!['LOCAL', 'MIXED', 'SSO'].includes(mode))          return res.status(400).json({ error: 'invalid mode (must be LOCAL | MIXED | SSO)' });
  if (!['DEMO', 'GRAPH'].includes(directoryMode))        return res.status(400).json({ error: 'invalid directoryMode (must be DEMO | GRAPH)' });
  if (typeof tenantId !== 'string' || !tenantId.trim())  return res.status(400).json({ error: 'tenantId is required' });
  if (typeof authorityUrl !== 'string' || !authorityUrl.trim()) return res.status(400).json({ error: 'authorityUrl is required' });
  if (typeof clientId !== 'string' || !clientId.trim())  return res.status(400).json({ error: 'clientId is required' });
  try {
    await saveSsoConfig(
      {
        mode, directoryMode,
        tenantId: tenantId.trim(),
        authorityUrl: authorityUrl.trim(),
        clientId: clientId.trim(),
        clientSecret: typeof clientSecret === 'string' ? clientSecret : undefined
      },
      null
    );
    await logAudit({
      actorUsername: 'admin',
      actorUserId: null,
      actionType: 'SSO_CONFIG_UPDATE',
      resourceType: 'sso_config',
      summary: `SSO config updated: mode=${mode} directoryMode=${directoryMode} tenant=${tenantId.trim()}`,
      ipAddress: clientIp(req)
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/sso/test', async (_req, res) => {
  try {
    const r = await testSsoConnection();
    await logSystem(r.ok ? 'INFO' : 'WARN', 'sso',
      r.ok ? 'SSO connection test passed' : 'SSO connection test failed',
      r.steps.join(' | '));
    res.json(r);
  } catch (e: any) {
    await logSystem('ERROR', 'sso', 'SSO test endpoint error', (e as Error).message);
    res.status(500).json({ error: (e as Error).message, ok: false, steps: [] });
  }
});

// ----- SSO allowlist (admin-controlled) -----
// /admin/users CRUDs these via /api/sso/users; /api/sso/users/lookup is the
// read endpoint used by the FE bridge to map an Azure ID-token email to a
// local account. The admin gate verifies the sso_session cookie matches an
// enabled sso_users row with role='ADMIN' — same shape as the FE bootstrap.

async function readSsoSessionToken(req: express.Request): Promise<string | null> {
  const cookieHeader = req.headers.cookie || '';
  const token = cookieHeader
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith('sso_session='))
    ?.slice('sso_session='.length);
  return token ? decodeURIComponent(token) : null;
}

/** Client IP for audit logs. Trusts the first hop in X-Forwarded-For if
 *  present (the demo runs behind ngrok / a reverse proxy); otherwise
 *  falls back to the socket remote address. */
function clientIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length > 0) return xff[0];
  return req.socket?.remoteAddress ?? '';
}

async function readLocalAdminToken(req: express.Request): Promise<string | null> {
  const cookieHeader = req.headers.cookie || '';
  const token = cookieHeader
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith('local_admin='))
    ?.slice('local_admin='.length);
  return token ? decodeURIComponent(token) : null;
}

/** "Is there any valid session cookie on this request?" — accepts either
 *  sso_session (SSO sign-in) or local_admin (LOCAL/DEMO sign-in via the
 *  /login picker). No role check. Used by endpoints that should be open to
 *  any signed-in user (e.g. the SSO directory read used to populate people
 *  pickers on the Tasks / Leave / Bookings pages). */
async function requireSignedIn(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Path 1: SSO session.
  const ssoToken = await readSsoSessionToken(req);
  if (ssoToken) {
    try {
      const v = await jose.jwtVerify(ssoToken, COOKIE_SECRET, { algorithms: ['HS256'] });
      const email = String((v.payload as any)?.email || '').toLowerCase();
      if (email) {
        const u = await findSsoUserByEmail(email);
        if (u && u.enabled) {
          (req as any).userId = u.id;
          (req as any).userSource = 'sso';
          return next();
        }
      }
    } catch { /* fall through to local_admin */ }
  }
  // Path 2: local_admin cookie (LOCAL/DEMO sign-in via /login picker).
  const localToken = await readLocalAdminToken(req);
  if (localToken) {
    try {
      const v = await jose.jwtVerify(localToken, COOKIE_SECRET, { algorithms: ['HS256'] });
      const p = v.payload as any;
      const userId = Number(p?.userId);
      if (Number.isFinite(userId)) {
        (req as any).userId = userId;
        (req as any).userSource = String(p?.source || '').toLowerCase() || 'local';
        return next();
      }
    } catch { /* fall through */ }
  }
  return res.status(401).json({ error: 'sign-in required' });
}

/** Two-path admin gate:
 *
 *   1. sso_session cookie (verified + looked up in sso_users, requires role
 *      ADMIN, account enabled).
 *   2. local_admin cookie (verified HS256, claims { userId, role } — the
 *      FE only mints this for LOCAL/DEMO users whose localStorage session
 *      has role=ADMIN and is enabled). Lets admins who signed in via the
 *      /login picker (no Azure identity, no SSO cookie) reach the admin
 *      API too.
 *
 *  Both paths populate `req.adminUserId` so audit-trail handlers can record
 *  the acting principal. */
async function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Path 1: SSO session.
  const ssoToken = await readSsoSessionToken(req);
  if (ssoToken) {
    try {
      const v = await jose.jwtVerify(ssoToken, COOKIE_SECRET, { algorithms: ['HS256'] });
      const email = String((v.payload as any)?.email || '').toLowerCase();
      if (email) {
        const u = await findSsoUserByEmail(email);
        if (u && u.enabled && u.role === 'ADMIN') {
          (req as any).adminUserId = u.id;
          (req as any).adminSource = 'sso';
          (req as any).adminUsername = u.email;
          return next();
        }
      }
    } catch { /* fall through to local_admin */ }
  }
  // Path 2: Local admin cookie (LOCAL/DEMO sign-in via /login picker).
  const localToken = await readLocalAdminToken(req);
  if (localToken) {
    try {
      const v = await jose.jwtVerify(localToken, COOKIE_SECRET, { algorithms: ['HS256'] });
      const p = v.payload as any;
      const userId = Number(p?.userId);
      const role = String(p?.role || '');
      const source = String(p?.source || '');
      if (Number.isFinite(userId) && role === 'ADMIN' && (source === 'LOCAL' || source === 'DEMO') && p?.enabled !== false) {
        (req as any).adminUserId = userId;
        (req as any).adminSource = source.toLowerCase();
        (req as any).adminUsername = `local:${userId}`;
        return next();
      }
    } catch { /* fall through */ }
  }
  // Audit auth failure — note this fires on every admin-API call that
  // lacked a valid SSO or local_admin cookie. Helps catch scanning /
  // misconfigured-client attempts. The summary keeps the source IP and
  // method+path so it survives without an actor identity.
  const ip = clientIp(req);
  await logAudit({
    actorUsername: 'anonymous',
    actorUserId: null,
    actionType: 'ADMIN_AUTH_FAILURE',
    resourceType: req.baseUrl + req.path,
    summary: `${req.method} ${req.originalUrl} from ${ip} (no valid SSO/local_admin cookie)`,
    ipAddress: ip,
    success: false
  });
  return res.status(401).json({ error: 'admin session required (sign in as an ADMIN role via /login or SSO)' });
}

/** Issue a `local_admin` cookie for a LOCAL/DEMO admin so they can reach
 *  the SSO-allowlist admin API without an SSO cookie. Token claims:
 *    userId, role, source, enabled, iat, exp.
 *  Signed with the same COOKIE_SECRET as sso_session — verification is
 *  symmetric and constant-time.
 *
 *  The cookie is meaningless without a valid localStorage session on the
 *  client because *minting* it doesn't itself grant power; the request
 *  still passes through requireAdmin. We could harden this further by
 *  binding the cookie to the seed USERS list server-side, but for the
 *  demo scope the signed claim is enough — only admins are authorized
 *  to mint one (role must be ADMIN; the FE only calls this for ADMIN
 *  sessions). */
app.post('/api/sso/local-admin-session', async (req, res) => {
  const b = req.body ?? {};
  const userId = Number(b.userId);
  const role = String(b.role || '');
  const source = String(b.source || '');
  const enabled = b.enabled !== false;
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'valid userId required' });
  if (role !== 'ADMIN')         return res.status(403).json({ error: 'ADMIN role required' });
  if (source !== 'LOCAL' && source !== 'DEMO') return res.status(400).json({ error: 'source must be LOCAL or DEMO' });
  if (!enabled)                 return res.status(403).json({ error: 'account is disabled' });

  try {
    const token = await new jose.SignJWT({ userId, role, source, enabled })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(COOKIE_SECRET);
    const segs = [
      `local_admin=${encodeURIComponent(token)}`,
      'Path=/',
      `Max-Age=${Math.floor((12 * 60 * 60 * 1000) / 1000)}`,
      'HttpOnly',
      'Secure',
      'SameSite=Lax'
    ];
    res.append('Set-Cookie', segs.join('; '));
    await logAudit({
      actorUsername: `local:${userId}`,
      actorUserId: userId,
      actionType: 'LOCAL_ADMIN_LOGIN',
      resourceType: 'local_admin',
      summary: `local_admin cookie minted for userId=${userId} (${source})`,
      ipAddress: clientIp(req)
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/sso/local-admin-logout', (req, res) => {
  res.append('Set-Cookie', 'local_admin=; Path=/; Max-Age=0');
  logAudit({
    actorUsername: 'local',
    actorUserId: null,
    actionType: 'LOGOUT',
    resourceType: 'local_admin',
    summary: 'local_admin cookie cleared',
    ipAddress: clientIp(req)
  }).catch(() => { /* no-op */ });
  res.json({ ok: true });
});

// Public read — used by SsoFinish + AuthContext bootstrap.
app.get('/api/sso/users/lookup', async (req, res) => {
  const email = String(req.query.email || '').trim();
  if (!email) return res.status(400).json({ error: 'email required' });
  try {
    const u = await findSsoUserByEmail(email);
    res.json({ user: u });
  } catch (e: any) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Admin CRUD. Returns 409 on duplicate email so the FE can surface it as a
// friendly toast; 404 for missing update/delete targets.
const isSsoRole = (r: any): r is 'USER' | 'TASK_MANAGER' | 'ADMIN' | 'AUDITOR' =>
  ['USER', 'TASK_MANAGER', 'ADMIN', 'AUDITOR'].includes(r);

app.get('/api/sso/users', requireAdmin, async (_req, res) => {
  try {
    res.json({ users: await listSsoUsers() });
  } catch (e: any) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Read-only directory of all SSO users. Public (no auth required) — the
// FE uses this to populate Assignee / Person / Booker dropdowns in Tasks
// / Leave / Bookings on every page, and gating it behind a session cookie
// was unreliable: a `Secure` cookie set on an HTTPS callback is not sent
// on HTTP-origin FE fetches, and the sso_session can be missing on the
// very first render of /login or /sso-finish before bootstrap completes.
// The directory is a read-only list of names/emails/roles; the same data
// is otherwise accessible via /api/sso/users/lookup (which has always
// been public). Admin CRUD stays gated on /api/sso/users.
app.get('/api/sso/users/directory', async (req, res) => {
  try {
    const users = await listSsoUsers();
    // eslint-disable-next-line no-console
    console.info(`[sso/directory] cookies=${req.headers.cookie ? req.headers.cookie.slice(0, 60) + '...' : 'none'} -> ${users.length} rows`);
    res.json({ users });
  } catch (e: any) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/sso/users', requireAdmin, async (req, res) => {
  const b = req.body ?? {};
  const email = String(b.email || '').trim();
  const displayName = String(b.displayName || '').trim();
  const role = b.role;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'valid email required' });
  if (!displayName) return res.status(400).json({ error: 'displayName required' });
  if (!isSsoRole(role)) return res.status(400).json({ error: 'role must be USER | TASK_MANAGER | ADMIN | AUDITOR' });
  try {
    const u = await createSsoUser(
      {
        email,
        displayName,
        username: b.username || undefined,
        role,
        team: b.team || undefined,
        title: b.title || undefined,
        enabled: b.enabled === false ? false : true
      },
      (req as any).adminUserId
    );
    await logAudit({
      actorUsername: String((req as any).adminUsername || `admin:${(req as any).adminUserId}`),
      actorUserId: (req as any).adminUserId,
      actionType: 'SSO_USER_CREATE',
      resourceType: 'sso_user',
      resourceId: u.id,
      summary: `created SSO user ${u.email} (role=${u.role}, team=${u.team}, enabled=${u.enabled})`,
      ipAddress: clientIp(req)
    });
    res.status(201).json({ user: u });
  } catch (e: any) {
    if (e instanceof SsoUserEmailTakenError) return res.status(409).json({ error: e.message });
    res.status(500).json({ error: (e as Error).message });
  }
});

app.put('/api/sso/users/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const b = req.body ?? {};
  const patch: any = {};
  if (b.email !== undefined) {
    const e = String(b.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: 'valid email required' });
    patch.email = e;
  }
  if (b.displayName !== undefined) patch.displayName = String(b.displayName).trim();
  if (b.username !== undefined)    patch.username    = String(b.username).trim();
  if (b.team !== undefined)        patch.team        = String(b.team).trim();
  if (b.title !== undefined)       patch.title       = String(b.title).trim();
  if (b.role !== undefined) {
    if (!isSsoRole(b.role)) return res.status(400).json({ error: 'role must be USER | TASK_MANAGER | ADMIN | AUDITOR' });
    patch.role = b.role;
  }
  if (b.enabled !== undefined)     patch.enabled     = b.enabled === true;
  try {
    const u = await updateSsoUser(id, patch, (req as any).adminUserId);
    if (!u) return res.status(404).json({ error: 'not found' });
    await logAudit({
      actorUsername: String((req as any).adminUsername || `admin:${(req as any).adminUserId}`),
      actorUserId: (req as any).adminUserId,
      actionType: 'SSO_USER_UPDATE',
      resourceType: 'sso_user',
      resourceId: u.id,
      summary: `updated SSO user ${u.email} (fields=${Object.keys(patch).filter(k => k !== 'updated_at').join(',') || 'none'})`,
      ipAddress: clientIp(req)
    });
    res.json({ user: u });
  } catch (e: any) {
    if (e instanceof SsoUserEmailTakenError) return res.status(409).json({ error: e.message });
    res.status(500).json({ error: (e as Error).message });
  }
});

app.delete('/api/sso/users/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    // Capture identifying info BEFORE the row is gone so the audit
    // record survives the delete. Failure here shouldn't block the
    // user-facing action, so swallow + log.
    const before = await getSsoUserById(id);
    const ok = await deleteSsoUser(id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    await logAudit({
      actorUsername: String((req as any).adminUsername || `admin:${(req as any).adminUserId}`),
      actorUserId: (req as any).adminUserId,
      actionType: 'SSO_USER_DELETE',
      resourceType: 'sso_user',
      resourceId: id,
      summary: `deleted SSO user ${before?.email ?? id} (role=${before?.role ?? 'unknown'})`,
      ipAddress: clientIp(req)
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ----- Health -----
app.get('/health', (_req, res) => res.json({ status: 'ok', db: 'ok' }));

// ----- Audit events -----
app.get('/api/audit-events', async (_req, res) => {
  const r = await pool.query(
    `SELECT id, created_at, actor_username, actor_user_id, action_type,
            resource_type, resource_id, summary, ip_address, success
     FROM audit_events
     ORDER BY created_at DESC, id ASC`
  );
  res.json(r.rows.map(rowToAudit));
});

app.post('/api/audit-events', async (req, res) => {
  const b = req.body ?? {};
  const r = await pool.query(
    `INSERT INTO audit_events (actor_username, actor_user_id, action_type, resource_type, resource_id, summary, ip_address, success)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, created_at, actor_username, actor_user_id, action_type,
               resource_type, resource_id, summary, ip_address, success`,
    [b.actorUsername ?? 'unknown', b.actorUserId ?? null, b.actionType ?? 'UNKNOWN',
     b.resourceType ?? '', b.resourceId ?? '', b.summary ?? '',
     b.ipAddress ?? '', b.success !== false]
  );
  res.status(201).json(rowToAudit(r.rows[0]));
});

function rowToAudit(r: any) {
  return {
    id: r.id,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    actorUsername: r.actor_username,
    actorUserId: r.actor_user_id,
    actionType: r.action_type,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    summary: r.summary,
    ipAddress: r.ip_address,
    success: r.success
  };
}

// ----- System logs -----
app.get('/api/system-logs', async (_req, res) => {
  const r = await pool.query(
    `SELECT id, created_at, level, category, message, detail, resolved
     FROM system_logs
     ORDER BY created_at DESC, id ASC`
  );
  res.json(r.rows.map(rowToLog));
});

app.post('/api/system-logs', async (req, res) => {
  const b = req.body ?? {};
  const r = await pool.query(
    `INSERT INTO system_logs (level, category, message, detail, resolved)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, created_at, level, category, message, detail, resolved`,
    [b.level ?? 'INFO', b.category ?? 'GENERAL', b.message ?? '',
     b.detail ?? '', b.resolved === true]
  );
  res.status(201).json(rowToLog(r.rows[0]));
});

app.patch('/api/system-logs/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  const r = await pool.query(
    `UPDATE system_logs SET resolved = $2 WHERE id = $1
     RETURNING id, created_at, level, category, message, detail, resolved`,
    [id, b.resolved !== false]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json(rowToLog(r.rows[0]));
});

function rowToLog(r: any) {
  return {
    id: r.id,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    level: r.level,
    category: r.category,
    message: r.message,
    detail: r.detail,
    resolved: r.resolved
  };
}

// ----- Holidays -----
// Demo: no auth at the API layer. The frontend gates the UI on
// ROLE.isAdmin() (see src/contexts/HolidayContext.tsx). Production would
// enforce ADMIN from a server-side user table or a signed token.
app.get('/api/holidays', async (_req, res) => {
  try {
    const list = await getMergedHolidays();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/holidays', async (req, res) => {
  const b = req.body ?? {};
  const userId = Number.isFinite(b.userId) ? Number(b.userId) : null;
  try {
    const r = await addHoliday(String(b.date || ''), String(b.name || ''), userId);
    if (!r.ok) return res.status(409).json({ error: r.error });
    await logAudit({
      actorUsername: b.userId ? `user:${b.userId}` : 'unknown',
      actorUserId: userId,
      actionType: 'HOLIDAY_ADD',
      resourceType: 'holiday',
      resourceId: r.holiday?.date ?? String(b.date || ''),
      summary: `added holiday ${r.holiday?.date ?? b.date} "${r.holiday?.name ?? b.name}"`,
      ipAddress: clientIp(req)
    });
    res.status(201).json(r.holiday);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.delete('/api/holidays/:date', async (req, res) => {
  const body = req.body ?? {};
  const userId = Number.isFinite(body.userId) ? Number(body.userId) : null;
  try {
    const r = await removeHoliday(req.params.date, userId);
    await logAudit({
      actorUsername: body.userId ? `user:${body.userId}` : 'unknown',
      actorUserId: userId,
      actionType: 'HOLIDAY_REMOVE',
      resourceType: 'holiday',
      resourceId: req.params.date,
      summary: `removed holiday ${req.params.date} (source=${r.source})`,
      ipAddress: clientIp(req)
    });
    res.json({ ok: true, source: r.source });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/holidays/reset', async (req, res) => {
  const body = req.body ?? {};
  const userId = Number.isFinite(body.userId) ? Number(body.userId) : null;
  try {
    await resetHolidays();
    await logAudit({
      actorUsername: body.userId ? `user:${body.userId}` : 'unknown',
      actorUserId: userId,
      actionType: 'HOLIDAY_RESET',
      resourceType: 'holiday',
      summary: 'reset holidays to seed (cleared user-added + import rows)',
      ipAddress: clientIp(req)
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ----- Holiday imports -----
app.get('/api/holiday-imports', async (_req, res) => {
  try {
    res.json(await listImports());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/holiday-imports', async (req, res) => {
  const b = req.body ?? {};
  const userId = Number.isFinite(b.userId) ? Number(b.userId) : null;
  const items = Array.isArray(b.items) ? b.items : [];
  const filename = String(b.filename || 'unknown');
  const format = String(b.format || 'json') as HolidayFormat;
  const importId = String(b.importId || '');
  if (!importId) return res.status(400).json({ error: 'importId is required' });
  if (items.length === 0) return res.status(400).json({ error: 'items is required' });
  try {
    const r = await importHolidays(items, { filename, format, importId }, userId);
    await logAudit({
      actorUsername: b.userId ? `user:${b.userId}` : 'unknown',
      actorUserId: userId,
      actionType: 'HOLIDAY_IMPORT',
      resourceType: 'holiday_import',
      resourceId: importId,
      summary: `imported ${r.added?.length ?? items.length} holiday(s) from "${filename}" (format=${format}, id=${importId}, replaced=${r.replaced ?? 0}, skipped=${r.skipped?.length ?? 0})`,
      ipAddress: clientIp(req)
    });
    res.status(201).json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.delete('/api/holiday-imports/:importId', async (req, res) => {
  const body = req.body ?? {};
  const userId = Number.isFinite(body.userId) ? Number(body.userId) : null;
  try {
    const n = await removeImport(req.params.importId);
    await logAudit({
      actorUsername: body.userId ? `user:${body.userId}` : 'unknown',
      actorUserId: userId,
      actionType: 'HOLIDAY_IMPORT_REMOVE',
      resourceType: 'holiday_import',
      resourceId: req.params.importId,
      summary: `removed holiday import ${req.params.importId} (cleared ${n} row(s))`,
      ipAddress: clientIp(req)
    });
    res.json({ removed: n });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ----- DB inspector (read-only) -----
// Demo: no auth at the API layer. The frontend gates /admin/database on
// ROLE.isAdmin() via <RequireRole>. Production would enforce ADMIN from a
// server-side user table. SQL-injection safety comes from the allow-list
// cache: every /api/db/tables/:table/* request must hit a name that was
// returned by the most recent /api/db/overview.
app.get('/api/db/overview', async (_req, res) => {
  try {
    await refreshAllowList();
    const [tables, fkEdges] = await Promise.all([
      listAllTablesWithColumns('public'),
      listForeignKeys('public')
    ]);
    res.json({ tables, fkEdges, schema: 'public', allowListSize: tables.length });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/db/tables/:table/sample', async (req, res) => {
  const table = req.params.table;
  if (!isAllowedTable(table)) {
    return res.status(400).json({ error: `unknown table: ${table}` });
  }
  const limit = Number(req.query.limit ?? 10);
  const offset = Number(req.query.offset ?? 0);
  try {
    const r = await sampleRows(table, limit, offset);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/db/tables/:table/count', async (req, res) => {
  const table = req.params.table;
  if (!isAllowedTable(table)) {
    return res.status(400).json({ error: `unknown table: ${table}` });
  }
  try {
    const n = await countRows(table);
    res.json({ count: n });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ----- Active DB connection (live, from env) -----
// Returns the env-derived config the server is actually using + a SELECT 1
// reachability probe. Never returns the password — even masked — because the
// old form's passwordMasked field could be mistaken for the live credential.
// Returns 200 with isReachable:false on probe failure so the FE can still
// show "tried to reach X, here's why" instead of a generic error page.
// PG connect errors include host/port but never the password string (auth
// errors read "password authentication failed for user X" — no leak).
const SERVER_STARTED_AT = new Date().toISOString();
app.get('/api/db/connection', async (_req, res) => {
  const host = process.env.DB_HOST || '192.168.147.103';
  const port = Number(process.env.DB_PORT || 5432);
  const databaseName = process.env.DB_NAME || 'engg_intranet';
  const username = process.env.DB_USER || 'postgres';
  let isReachable = false;
  let error: string | null = null;
  try {
    await pool.query('SELECT 1');
    isReachable = true;
  } catch (e: any) {
    error = (e as Error)?.message || 'unknown error';
  }
  res.json({
    dbType: 'POSTGRES',
    host, port, databaseName, username,
    sslMode: 'prefer',
    passwordSet: Boolean(process.env.DB_PASSWORD),
    isReachable,
    error,
    startedAt: SERVER_STARTED_AT
  });
});

// ----- Backups -----
app.get('/api/backups', async (_req, res) => {
  try {
    const list = await listBackups();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/backups', async (req, res) => {
  const b = req.body ?? {};
  const label = typeof b.label === 'string' && b.label.trim() ? b.label : '';
  const keys = b.keys && typeof b.keys === 'object' ? b.keys : null;
  const retention = Number.isFinite(b.retention) && b.retention > 0 ? b.retention : 30;
  if (!keys) return res.status(400).json({ error: 'body.keys (object) is required' });
  try {
    const meta = await saveBackup(label, keys);
    const pruned = await pruneOldBackups(retention);
    if (pruned > 0) console.log(`[api] pruned ${pruned} old backup(s) to enforce retention=${retention}`);
    res.status(201).json(meta);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/backups/:id', async (req, res) => {
  try {
    const snap = await loadBackup(req.params.id);
    res.json(snap);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
    res.status(500).json({ error: (e as Error).message });
  }
});

app.delete('/api/backups/:id', async (req, res) => {
  try {
    const ok = await deleteBackup(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ----- Static + SPA fallback (only when a Vite `dist/` is present) -----
const distExists = await fs.stat(DIST_DIR).then(s => s.isDirectory()).catch(() => false);
if (distExists) {
  // 1) Serve real files in dist/ (assets, favicon, etc.)
  app.use(express.static(DIST_DIR, { maxAge: '1h' }));
  // 2) Catch-all for any other GET — serves the React app so client-side
  //    routes (/bookings, /leave/3, /tasks/5/edit, etc.) work after refresh.
  //    path-to-regexp v8 (Express 5) requires a named param for wildcards.
  app.get('{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') return next();
    res.sendFile(join(DIST_DIR, 'index.html'));
  });
  console.log(`[api] serving React bundle from ${DIST_DIR}`);
}

// JSON manifest only when running API-only (no dist).
// We can't use app.get('/', ...) here because '*' already covers it.

app.listen(PORT, HOST, () => {
  console.log(`[api] listening on http://${HOST === '0.0.0.0' ? '*' : HOST}:${PORT}`);
  if (!distExists) {
    console.log(`[api] (dev mode — no dist/ found, only API + health served)`);
  }
  // Boot event — fires once at startup. Surfaces in /admin/system-logs so
  // operators can correlate "I see an error" with "did the API even boot
  // in the last hour?". Best-effort: if the table isn't there yet, this
  // throws and we log to console only.
  logSystem('INFO', 'api', `server started on ${HOST}:${PORT}`,
    `distExists=${distExists} db=${process.env.DB_HOST || '192.168.147.103'} node=${process.version}`
  ).catch(e => console.error('[syslog] boot event failed', e));
});