// Admin backup — schedule (frequency/hour/day/cron/retention) + Run now / Restore.
// Real wiring (Phase 9): Run now POSTs a snapshot of the browser's localStorage
// override keys to :8092/api/backups. Restore GETs a snapshot, writes every
// captured LS key back, then reloads so all modules re-read from LS.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Settings } from '../lib/settings';
import { Backup, labelForLsKey, BACKUP_LS_KEYS } from '../lib/backup';
import type { BackupMeta, BackupSnapshot } from '../lib/types';
import { fmt, escapeHtml } from '../lib/app';

const FREQUENCIES = [
  { value: 'HOURLY',  label: 'Hourly' },
  { value: 'DAILY',   label: 'Daily' },
  { value: 'WEEKLY',  label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'CUSTOM',  label: 'Custom (cron)' }
];

const WEEKDAY = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' }
];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function AdminBackup() {
  const initial = Settings.backupConfig();
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  // Manual re-render trigger: setRev() bumps state after backup mutations so the
// list re-fetches. The value itself is never read, so we skip-bind to satisfy
// the noUnusedLocals flag under `tsc -b`.
const [, setRev] = useState(0);

  // Live list of backups from the server.
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [backupsErr, setBackupsErr] = useState<string | null>(null);
  const [backupsLoading, setBackupsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshList = async () => {
    setBackupsLoading(true);
    try {
      const list = await Backup.list();
      setBackups(list);
      setBackupsErr(null);
    } catch (e) {
      setBackupsErr((e as Error).message);
    } finally {
      setBackupsLoading(false);
    }
  };

  useEffect(() => { void refreshList(); }, []);

  const onChange = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.frequency === 'WEEKLY' && (form.dayOfWeek < 0 || form.dayOfWeek > 6)) {
      alert('Pick a weekday for weekly backups.'); return;
    }
    if (form.frequency === 'CUSTOM' && !form.customCron.trim()) {
      alert('Custom cron expression is required when frequency is CUSTOM.'); return;
    }
    if (form.hourOfDay < 0 || form.hourOfDay > 23) {
      alert('Hour must be 0–23.'); return;
    }
    Settings.setBackupConfig(form);
    setSaved(true);
    setRev(v => v + 1);
    setTimeout(() => setSaved(false), 1500);
  };

  const onRunNow = async () => {
    const label = window.prompt('Optional label for this backup:', `Backup @ ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`) ?? '';
    if (label === null) return; // user clicked Cancel
    setRunning(true);
    try {
      const snap = Backup.collectSnapshot(label);
      const keyCount = Object.keys(snap.keys).length;
      if (keyCount === 0) {
        if (!confirm('Nothing to back up — localStorage has no `engg_user_*` overrides yet. Save an empty snapshot anyway?')) {
          setRunning(false);
          return;
        }
      }
      const meta = await Backup.save(snap, form.retentionCount || 30);
      Settings.setBackupConfig({
        ...Settings.backupConfig(),
        lastBackupAt: new Date().toISOString(),
        lastBackupResult: `OK (${fmtSize(meta.sizeBytes)} · ${keyCount} keys)`
      });
      setForm(Settings.backupConfig());
      setRev(v => v + 1);
      await refreshList();
    } catch (e) {
      alert(`Backup failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const onRestore = async (meta: BackupMeta) => {
    const proceed = confirm(
      `Restore from "${meta.label}" (${fmt.dateTime(meta.createdAt)})?\n\n` +
      `This will overwrite the current localStorage overrides with the snapshot contents. ` +
      `The page will reload after restore.`
    );
    if (!proceed) return;
    setBusyId(meta.id);
    try {
      const snap: BackupSnapshot = await Backup.load(meta.id);
      const result = Backup.restoreSnapshot(snap);
      alert(
        `Restored ${result.keysRestored} key(s)` +
        (result.keysMissing ? ` · ${result.keysMissing} failed` : '') +
        `.\n\nReloading…`
      );
      window.location.reload();
    } catch (e) {
      alert(`Restore failed: ${(e as Error).message}`);
      setBusyId(null);
    }
  };

  const onDelete = async (meta: BackupMeta) => {
    if (!confirm(`Delete backup "${meta.label}"?\n\nThis only removes the server-side archive — your current localStorage is unchanged.`)) return;
    setBusyId(meta.id);
    try {
      await Backup.remove(meta.id);
      await refreshList();
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const onReset = () => {
    if (!confirm('Reset backup settings back to seed defaults?')) return;
    Settings.resetBackup();
    const fresh = Settings.backupConfig();
    setForm(fresh);
    setRev(v => v + 1);
  };

  // Summary of what a backup will (or did) capture.
  const keyPreview = BACKUP_LS_KEYS.map(k => labelForLsKey(k));

  return (
    <AppShell title="Backup">
      <div className="page-header">
        <div>
          <h1>Backup</h1>
          <div className="page-header__sub">
            Snapshot of browser localStorage overrides · stored as JSON on the API server (:8092)
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/admin">← Back to admin</Link>
        </div>
      </div>

      {form.lastBackupAt && (
        <div
          className={`alert ${form.lastBackupResult.startsWith('OK') ? 'alert--success' : 'alert--warning'}`}
          role="status"
        >
          <strong>Last backup:</strong> {escapeHtml(form.lastBackupResult)} ·{' '}
          <span className="text-muted text-sm">{fmt.dateTime(form.lastBackupAt)}</span>
        </div>
      )}

      <div className="dash-grid dash-grid--2">
        <button
          type="button"
          className="card stat-card"
          onClick={onRunNow}
          disabled={running}
          style={{ textAlign: 'left', cursor: running ? 'wait' : 'pointer' }}
        >
          <div className="text-muted text-sm">Run now</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 6 }}>
            {running ? '⏳ Running…' : '▶ Start backup'}
          </div>
          <div className="text-muted text-sm" style={{ marginTop: 6 }}>
            Captures all <code>engg_user_*</code> LS keys and pushes to :8092
          </div>
        </button>
        <div className="card stat-card" style={{ textAlign: 'left' }}>
          <div className="text-muted text-sm">Archives</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 6 }}>
            {backupsLoading ? '…' : `${backups.length} on server`}
          </div>
          <div className="text-muted text-sm" style={{ marginTop: 6 }}>
            Retention: {form.retentionCount} most recent (older pruned on save)
          </div>
        </div>
      </div>

      {/* ---- Archive list (real data from :8092) ---- */}
      <section className="card" style={{ marginTop: 'var(--space-4)', padding: 0 }} aria-label="Backup archives">
        <div className="card__head" style={{ padding: 'var(--space-3) var(--space-4) 0' }}>
          <h2 style={{ margin: 0 }}>Archives on server</h2>
          <button className="btn btn--sm" onClick={() => void refreshList()} disabled={backupsLoading}>
            ↻ Refresh
          </button>
        </div>

        {backupsErr && (
          <div className="alert alert--danger" role="alert" style={{ margin: 'var(--space-3) var(--space-4) 0' }}>
            ⚠️ Failed to reach the backup API: {escapeHtml(backupsErr)}. Is <code>:8092</code> running?
          </div>
        )}

        <div className="table-wrap" style={{ marginTop: 'var(--space-3)' }}>
          <table className="table" aria-label="Backup archives">
            <thead>
              <tr>
                <th>Created</th>
                <th>Label</th>
                <th>Size</th>
                <th>Captured keys</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!backupsLoading && backups.length === 0 && !backupsErr && (
                <tr><td colSpan={5} className="empty" style={{ border: 'none' }}>
                  No archives yet — hit Run now to create one.
                </td></tr>
              )}
              {backups.map(meta => {
                const nonEmpty = Object.entries(meta.counts).filter(([, n]) => n > 0);
                return (
                  <tr key={meta.id}>
                    <td>
                      <div>{fmt.dateTime(meta.createdAt)}</div>
                      <code className="text-muted text-sm">{escapeHtml(meta.id)}</code>
                    </td>
                    <td>{escapeHtml(meta.label)}</td>
                    <td>{fmtSize(meta.sizeBytes)}</td>
                    <td className="text-sm">
                      {nonEmpty.length === 0
                        ? <span className="text-muted">empty</span>
                        : (
                          <details>
                            <summary>{nonEmpty.length} key{nonEmpty.length === 1 ? '' : 's'}</summary>
                            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                              {nonEmpty.map(([k, n]) => (
                                <li key={k}>
                                  <code>{escapeHtml(labelForLsKey(k))}</code>{' '}
                                  <span className="text-muted">({n})</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                    </td>
                    <td className="actions">
                      <button
                        className="btn btn--primary btn--sm"
                        onClick={() => void onRestore(meta)}
                        disabled={busyId === meta.id}
                        title="Write every captured LS key back, then reload"
                      >
                        {busyId === meta.id ? '⏳' : '↩ Restore'}
                      </button>{' '}
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => void onDelete(meta)}
                        disabled={busyId === meta.id}
                        style={{ color: 'var(--color-danger)' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Schedule form ---- */}
      <form className="form card" onSubmit={onSave} noValidate style={{ marginTop: 'var(--space-4)' }}>
        <div className="form__row form__row--2">
          <div className="form__row">
            <label className="form__label" htmlFor="enabled">Schedule</label>
            <select
              id="enabled"
              className="form__select"
              value={form.enabled ? 'true' : 'false'}
              onChange={e => onChange({ enabled: e.target.value === 'true' })}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>
          <div className="form__row">
            <label className="form__label" htmlFor="frequency">Frequency</label>
            <select
              id="frequency"
              className="form__select"
              value={form.frequency}
              onChange={e => onChange({ frequency: e.target.value })}
            >
              {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>

        <div className="form__row form__row--2">
          <div className="form__row">
            <label className="form__label" htmlFor="hourOfDay">Hour of day (0–23)</label>
            <input
              id="hourOfDay"
              type="number"
              className="form__input"
              min={0}
              max={23}
              value={form.hourOfDay}
              onChange={e => onChange({ hourOfDay: Number(e.target.value) })}
            />
          </div>
          {form.frequency === 'WEEKLY' && (
            <div className="form__row">
              <label className="form__label" htmlFor="dayOfWeek">Day of week</label>
              <select
                id="dayOfWeek"
                className="form__select"
                value={form.dayOfWeek}
                onChange={e => onChange({ dayOfWeek: Number(e.target.value) })}
              >
                {WEEKDAY.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          )}
          {form.frequency === 'CUSTOM' && (
            <div className="form__row">
              <label className="form__label" htmlFor="customCron">Custom cron expression</label>
              <input
                id="customCron"
                type="text"
                className="form__input"
                value={form.customCron}
                maxLength={100}
                placeholder="0 */6 * * *"
                onChange={e => onChange({ customCron: e.target.value })}
              />
            </div>
          )}
        </div>

        <div className="form__row form__row--2">
          <div className="form__row">
            <label className="form__label" htmlFor="retentionCount">Retention count</label>
            <input
              id="retentionCount"
              type="number"
              className="form__input"
              min={1}
              max={365}
              value={form.retentionCount}
              onChange={e => onChange({ retentionCount: Number(e.target.value) })}
            />
            <span className="form__hint text-muted">
              On every save, prune older archives beyond this count. Range 1–365.
            </span>
          </div>
          <div className="form__row">
            <label className="form__label" htmlFor="targetDirectory">Server-side location</label>
            <input
              id="targetDirectory"
              type="text"
              className="form__input"
              value={form.targetDirectory}
              maxLength={200}
              readOnly
              aria-readonly="true"
            />
            <span className="form__hint text-muted">
              <code>server/backups/*.json</code> — each snapshot is its own file, inspectable on disk.
            </span>
          </div>
        </div>

        <div className="form__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onReset}
            style={{ color: 'var(--color-danger)' }}
          >
            Reset to seed
          </button>
          <button type="submit" className="btn btn--primary" disabled={saved}>
            {saved ? '✅ Saved' : 'Save schedule'}
          </button>
        </div>
      </form>

      <section className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Current effective schedule</h2>
        <p>
          Backups run{' '}
          <strong>
            {form.enabled
              ? form.frequency === 'CUSTOM'
                ? `on cron \`${escapeHtml(form.customCron || '')}\``
                : `${form.frequency.toLowerCase()} at ${form.hourOfDay}:00` +
                  (form.frequency === 'WEEKLY'
                    ? ` on ${WEEKDAY.find(d => d.value === form.dayOfWeek)?.label}`
                    : '')
              : 'disabled'}
          </strong>
          , keeping the last <strong>{form.retentionCount}</strong> archives.{' '}
          <span className="text-muted text-sm">
            (Auto-scheduling is UI-only in this demo — Run now + manual restore are wired to <code>:8092/api/backups</code>.)
          </span>
        </p>

        <details style={{ marginTop: 'var(--space-3)' }}>
          <summary><strong>What a backup captures</strong></summary>
          <ul style={{ marginTop: 'var(--space-2)' }}>
            {keyPreview.map(label => <li key={label}><code>{escapeHtml(label)}</code></li>)}
          </ul>
          <p className="text-muted text-sm">
            Audit events + system logs on <code>192.168.147.103/engg_intranet</code> are intentionally
            excluded — they are append-only audit history and would be corrupted by a restore.
          </p>
        </details>
      </section>
    </AppShell>
  );
}
