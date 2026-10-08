// Backups — JSON snapshots of the React app's localStorage override keys.
// Each backup is a single JSON file in ./backups/. Backups are intentionally
// file-based (not in PostgreSQL) so they can be inspected, copied, and edited
// outside the demo with zero infra.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const BACKUPS_DIR = path.resolve(process.cwd(), 'backups');

export interface BackupSnapshot {
  version: 1;
  app: 'hk-engg-intranet';
  createdAt: string;
  label: string;
  keys: Record<string, unknown>;
}

export interface BackupMeta {
  id: string;             // filename without .json, e.g. "2026-10-08T14-30-45-123Z"
  createdAt: string;
  label: string;
  sizeBytes: number;
  counts: Record<string, number>;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
}

// Sanitize a label so it can be used inside a filename. Anything not in the
// allow-list becomes '_' and consecutive runs are collapsed.
function sanitizeForFilename(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || 'backup';
}

function nowId(): string {
  // Filename-safe ISO with colons swapped for dashes.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function summarise(snap: BackupSnapshot): { sizeBytes: number; counts: Record<string, number> } {
  // Approximate on-disk size: length of the canonical JSON serialisation.
  const json = JSON.stringify(snap, null, 2);
  const sizeBytes = Buffer.byteLength(json, 'utf8');
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(snap.keys)) {
    if (Array.isArray(value)) counts[key] = value.length;
    else if (value && typeof value === 'object') counts[key] = Object.keys(value).length;
    else counts[key] = 1;
  }
  return { sizeBytes, counts };
}

export async function listBackups(): Promise<BackupMeta[]> {
  await ensureDir();
  const entries = await fs.readdir(BACKUPS_DIR);
  const metas: BackupMeta[] = [];
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(BACKUPS_DIR, file);
    try {
      const raw = await fs.readFile(full, 'utf8');
      const snap = JSON.parse(raw) as BackupSnapshot;
      const stat = await fs.stat(full);
      const { sizeBytes, counts } = summarise(snap);
      metas.push({
        id: file.replace(/\.json$/, ''),
        createdAt: snap.createdAt,
        label: snap.label || '(unlabeled)',
        sizeBytes,
        counts
      });
    } catch (e) {
      // Corrupt file — skip but keep the others listable.
      console.warn(`[backups] skipping ${file}: ${(e as Error).message}`);
    }
  }
  // Newest first by createdAt descending.
  metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return metas;
}

export async function saveBackup(label: string, keys: Record<string, unknown>): Promise<BackupMeta> {
  await ensureDir();
  const baseId = nowId();
  const safeLabel = sanitizeForFilename(label);
  const id = `${baseId}__${safeLabel}`;
  const snap: BackupSnapshot = {
    version: 1,
    app: 'hk-engg-intranet',
    createdAt: new Date().toISOString(),
    label: label.trim().slice(0, 120) || `Manual @ ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    keys
  };
  const file = path.join(BACKUPS_DIR, `${id}.json`);
  await fs.writeFile(file, JSON.stringify(snap, null, 2), 'utf8');
  const { sizeBytes, counts } = summarise(snap);
  return { id, createdAt: snap.createdAt, label: snap.label, sizeBytes, counts };
}

export async function loadBackup(id: string): Promise<BackupSnapshot> {
  // Allow path-traversal-safe lookup by re-anchoring to BACKUPS_DIR.
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '_');
  const file = path.join(BACKUPS_DIR, `${safe}.json`);
  const raw = await fs.readFile(file, 'utf8');
  const snap = JSON.parse(raw) as BackupSnapshot;
  if (snap.version !== 1 || snap.app !== 'hk-engg-intranet') {
    throw new Error(`Unsupported backup version (${snap.version})`);
  }
  return snap;
}

export async function deleteBackup(id: string): Promise<boolean> {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '_');
  const file = path.join(BACKUPS_DIR, `${safe}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return false;
    throw e;
  }
}

/**
 * Keep only the newest `retention` snapshots. Called after every save with the
 * caller-configured retention count.
 */
export async function pruneOldBackups(retention: number): Promise<number> {
  await ensureDir();
  const keep = Math.max(1, retention);
  const entries = (await fs.readdir(BACKUPS_DIR))
    .filter(f => f.endsWith('.json'))
    .map(f => ({ file: f, full: path.join(BACKUPS_DIR, f) }));
  // Read mtime for each and keep newest `keep`, delete the rest.
  const stats = await Promise.all(entries.map(async e => {
    const s = await fs.stat(e.full);
    return { ...e, mtime: s.mtimeMs };
  }));
  stats.sort((a, b) => b.mtime - a.mtime);
  const toDelete = stats.slice(keep);
  for (const e of toDelete) {
    try { await fs.unlink(e.full); } catch { /* swallow */ }
  }
  return toDelete.length;
}
