// Admin database — view + edit SQL Server / SQLite connection settings + test probe.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Settings } from '../lib/settings';
import { fmt, escapeHtml } from '../lib/app';

const DB_TYPES = [
  { value: 'SQLITE',    label: 'SQLite (local file)' },
  { value: 'SQLSERVER', label: 'Microsoft SQL Server' },
  { value: 'POSTGRES',  label: 'PostgreSQL' }
];

export function AdminDatabase() {
  const initial = Settings.databaseConfig();
  const [form, setForm] = useState(initial);
  const [password, setPassword] = useState(initial.passwordMasked ? '' : '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, setRev] = useState(0);

  const onChange = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.dbType !== 'SQLITE') {
      if (!form.host.trim()) { setError('Host is required for SQL Server / PostgreSQL.'); return; }
      if (!form.databaseName.trim()) { setError('Database name is required.'); return; }
      if (!Number.isFinite(form.port) || form.port < 1 || form.port > 65535) {
        setError('Port must be between 1 and 65535.');
        return;
      }
    }
    const next = {
      ...form,
      // Only update the masked password if the user typed something new.
      passwordMasked: password ? maskPassword(password) : form.passwordMasked
    };
    Settings.setDatabaseConfig(next);
    setForm(next);
    setPassword('');
    setSaved(true);
    setRev(v => v + 1);
    setTimeout(() => setSaved(false), 1500);
  };

  const onTest = () => {
    setError(null);
    const tested = Settings.testDatabaseConnection({
      ...form,
      passwordMasked: password ? maskPassword(password) : form.passwordMasked
    });
    setForm(tested);
    setPassword('');
    setRev(v => v + 1);
  };

  const onReset = () => {
    if (!confirm('Reset database settings back to seed defaults?')) return;
    Settings.resetDatabase();
    const fresh = Settings.databaseConfig();
    setForm(fresh);
    setPassword('');
    setRev(v => v + 1);
  };

  const isSqlite = form.dbType === 'SQLITE';

  return (
    <AppShell title="Database">
      <div className="page-header">
        <div>
          <h1>Database connection</h1>
          <div className="page-header__sub">
            Read/write settings for the intranet data store. Changes are saved to localStorage.
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/admin">← Back to admin</Link>
        </div>
      </div>

      {error && (
        <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(error)}</div>
      )}

      {form.lastTestedAt && (
        <div
          className={`alert ${form.lastTestResult.startsWith('GOOD') ? 'alert--success' : form.lastTestResult.startsWith('FAIL') ? 'alert--danger' : 'alert--warning'}`}
          role="status"
        >
          <strong>Last test:</strong> {escapeHtml(form.lastTestResult)} ·{' '}
          <span className="text-muted text-sm">{fmt.dateTime(form.lastTestedAt)}</span>
        </div>
      )}

      <form className="form card" onSubmit={onSave} noValidate>
        <div className="form__row form__row--2">
          <div className="form__row">
            <label className="form__label" htmlFor="dbType">Database type</label>
            <select
              id="dbType"
              className="form__select"
              value={form.dbType}
              onChange={e => onChange({ dbType: e.target.value })}
            >
              {DB_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="form__row">
            <label className="form__label" htmlFor="port">Port</label>
            <input
              id="port"
              type="number"
              className="form__input"
              min={1}
              max={65535}
              value={form.port}
              disabled={isSqlite}
              onChange={e => onChange({ port: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="form__row form__row--2">
          <div className="form__row">
            <label className="form__label" htmlFor="host">Host</label>
            <input
              id="host"
              type="text"
              className="form__input"
              value={form.host}
              disabled={isSqlite}
              maxLength={200}
              placeholder={isSqlite ? '(not used for SQLite)' : 'sqlserver.engg.hku.hk'}
              onChange={e => onChange({ host: e.target.value })}
            />
          </div>
          <div className="form__row">
            <label className="form__label" htmlFor="databaseName">Database name</label>
            <input
              id="databaseName"
              type="text"
              className="form__input"
              value={form.databaseName}
              disabled={isSqlite}
              maxLength={100}
              placeholder={isSqlite ? '(not used for SQLite)' : 'EnggIntranetDB'}
              onChange={e => onChange({ databaseName: e.target.value })}
            />
          </div>
        </div>

        <div className="form__row form__row--2">
          <div className="form__row">
            <label className="form__label" htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              className="form__input"
              value={form.username}
              disabled={isSqlite}
              maxLength={100}
              onChange={e => onChange({ username: e.target.value })}
            />
          </div>
          <div className="form__row">
            <label className="form__label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="form__input"
              value={password}
              disabled={isSqlite}
              placeholder={form.passwordMasked ? '(unchanged)' : ''}
              maxLength={200}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <span className="form__hint text-muted">
              Stored value: <code>{escapeHtml(form.passwordMasked || '(empty)')}</code>. Type a new password to replace it.
            </span>
          </div>
        </div>

        <div className="form__row form__row--2">
          <div className="form__row">
            <label className="form__label" htmlFor="encrypt">Encrypt connection</label>
            <select
              id="encrypt"
              className="form__select"
              value={form.encrypt ? 'true' : 'false'}
              disabled={isSqlite}
              onChange={e => onChange({ encrypt: e.target.value === 'true' })}
            >
              <option value="true">Yes (TLS)</option>
              <option value="false">No</option>
            </select>
          </div>
          <div className="form__row">
            <label className="form__label" htmlFor="trustServerCertificate">Trust server cert</label>
            <select
              id="trustServerCertificate"
              className="form__select"
              value={form.trustServerCertificate ? 'true' : 'false'}
              disabled={isSqlite}
              onChange={e => onChange({ trustServerCertificate: e.target.value === 'true' })}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>

        <div className="form__actions">
          <button type="button" className="btn" onClick={onTest}>🔌 Test connection</button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onReset}
            style={{ color: 'var(--color-danger)' }}
          >
            Reset to seed
          </button>
          <button type="submit" className="btn btn--primary" disabled={saved}>
            {saved ? '✅ Saved' : 'Save settings'}
          </button>
        </div>
      </form>

      <section className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Current effective settings</h2>
        <table className="table">
          <tbody>
            <tr><th>Type</th><td>{escapeHtml(form.dbType)}</td></tr>
            <tr><th>Host</th><td>{escapeHtml(form.host) || '—'}</td></tr>
            <tr><th>Database</th><td>{escapeHtml(form.databaseName) || '—'}</td></tr>
            <tr><th>Port</th><td>{form.port}</td></tr>
            <tr><th>Username</th><td>{escapeHtml(form.username) || '—'}</td></tr>
            <tr><th>Password</th><td><code>{escapeHtml(form.passwordMasked || '(empty)')}</code></td></tr>
            <tr><th>Encrypt</th><td>{form.encrypt ? 'Yes (TLS)' : 'No'}</td></tr>
            <tr><th>Trust cert</th><td>{form.trustServerCertificate ? 'Yes' : 'No'}</td></tr>
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}

function maskPassword(p: string): string {
  if (!p) return '';
  if (p.length <= 4) return '***';
  return '*'.repeat(Math.max(4, p.length - 4)) + p.slice(-4);
}