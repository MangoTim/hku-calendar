// Backup helper — snapshot the React app's `engg_user_*` localStorage keys
// into a JSON payload, push to the server (:8092) on the user's behalf, and
// restore from a previously-saved snapshot by writing the same keys back.
//
// The server stores each snapshot as its own .json file under server/backups/
// so a backup is just a file: copyable, diffable, restorable from outside the
// demo if needed.
//
// What we capture:
//   All `engg_user_*` keys (rooms, bookings, leave, tasks, task_progress,
//   announcements, notification_state, user_overrides, settings, holidays,
//   holidays_removed, database_config, backup_config, sso_config, etc).
// What we DELIBERATELY do NOT capture:
//   - The auth session (held in module state + LS, but we don't want a
//     restore to log the user out as a side effect)
//   - Anything outside the `engg_user_*` namespace
//
// What we DO NOT capture by design (intentionally out of scope):
//   - PostgreSQL audit_events / system_logs on .103 — those are append-only
//     audit history and would be corrupted by a restore; if you wipe the
//     browser's data you don't want to also wipe the audit trail.

import type { BackupMeta, BackupSnapshot } from './types';

// Order matters for human-readable dump; the server is order-agnostic.
export const BACKUP_LS_KEYS: readonly string[] = [
  'engg_user_rooms',
  'engg_user_bookings',
  'engg_user_leave',
  'engg_user_tasks',
  'engg_user_task_progress',
  'engg_user_announcements',
  'engg_user_notification_state',
  'engg_user_user_overrides',
  'engg_user_settings',
  'engg_user_holidays',
  'engg_user_holidays_removed',
  'engg_user_database_config',
  'engg_user_backup_config',
  'engg_user_sso_config'
];

const SESSION_KEYS_TO_PRESERVE = new Set<string>([
  'engg_intranet_session_v1'
]);

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  if (!r.ok) {
    let msg = `${init?.method || 'GET'} ${path} → ${r.status}`;
    try { const j = await r.json(); if (j?.error) msg += ` — ${j.error}`; } catch { /* ignore */ }
    throw new Error(msg);
  }
  // 204 has no body
  if (r.status === 204) return undefined as unknown as T;
  return r.json();
}

export const Backup = {
  /** Read every `engg_user_*` key, parse JSON where possible, skip the session. */
  collectSnapshot(label?: string): BackupSnapshot {
    const keys: Record<string, unknown> = {};
    const seenAt = new Date().toISOString();
    for (const k of BACKUP_LS_KEYS) {
      if (SESSION_KEYS_TO_PRESERVE.has(k)) continue;
      const raw = localStorage.getItem(k);
      if (raw == null) continue;
      try {
        keys[k] = JSON.parse(raw);
      } catch {
        // Store as plain string if the value isn't valid JSON.
        keys[k] = raw;
      }
    }
    return {
      version: 1,
      app: 'hk-engg-intranet',
      createdAt: seenAt,
      label: label?.trim() || `Backup @ ${seenAt.slice(0, 16).replace('T', ' ')}`,
      keys
    };
  },

  /** Write every key in a snapshot back into localStorage. */
  restoreSnapshot(snap: BackupSnapshot): { keysRestored: number; keysMissing: number } {
    let keysRestored = 0;
    let keysMissing = 0;
    for (const [key, value] of Object.entries(snap.keys)) {
      try {
        const serialised = typeof value === 'string' ? value : JSON.stringify(value);
        localStorage.setItem(key, serialised);
        keysRestored++;
      } catch (e) {
        console.warn(`[backup] failed to restore ${key}:`, e);
        keysMissing++;
      }
    }
    return { keysRestored, keysMissing };
  },

  // ----- REST client (proxied via Vite to :8092) -----

  /** List available backups, newest first. */
  list(): Promise<BackupMeta[]> {
    return jsonFetch<BackupMeta[]>('/api/backups');
  },

  /** Push a snapshot to the server. The optional retention count prunes old copies. */
  save(snap: BackupSnapshot, retention = 30): Promise<BackupMeta> {
    return jsonFetch<BackupMeta>('/api/backups', {
      method: 'POST',
      body: JSON.stringify({
        label: snap.label,
        keys: snap.keys,
        retention
      })
    });
  },

  /** Fetch a single snapshot's full key payload. */
  load(id: string): Promise<BackupSnapshot> {
    return jsonFetch<BackupSnapshot>(`/api/backups/${encodeURIComponent(id)}`);
  },

  /** Delete one backup from the server. */
  remove(id: string): Promise<void> {
    return jsonFetch<void>(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
};

// Human-readable key name for the Backup list rendering.
const KEY_LABELS: Record<string, string> = {
  'engg_user_rooms': 'Rooms',
  'engg_user_bookings': 'Bookings',
  'engg_user_leave': 'Leave',
  'engg_user_tasks': 'Tasks',
  'engg_user_task_progress': 'Task progress',
  'engg_user_announcements': 'Announcements',
  'engg_user_notification_state': 'Notification state',
  'engg_user_user_overrides': 'User overrides',
  'engg_user_settings': 'Task settings',
  'engg_user_holidays': 'Holidays (added)',
  'engg_user_holidays_removed': 'Holidays (removed)',
  'engg_user_database_config': 'Database config',
  'engg_user_backup_config': 'Backup config',
  'engg_user_sso_config': 'SSO config'
};
export function labelForLsKey(key: string): string {
  return KEY_LABELS[key] || key.replace(/^engg_user_/, '').replace(/_/g, ' ');
}
