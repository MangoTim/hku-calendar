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
});