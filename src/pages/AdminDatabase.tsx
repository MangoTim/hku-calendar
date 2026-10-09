// Admin database — connection settings (local) + DB inspector (live, read-only).
//
// Card 1 (existing): edit / test / save / reset the connection settings that
// get stored in localStorage. Affects the next launch of the *demo backend*,
// not the live `.103/engg_intranet` server the API on `:8092` already speaks
// to. Useful for demoing the "switch to SQL Server / SQLite" flow.
//
// Card 2 (new): live inspector against the .103 PostgreSQL DB the Express API
// is connected to. Read-only, public schema only. Fetches on mount via
// /api/db/overview, lets admins expand a table to see columns + first 10 rows
// (with "Load 50 more" pagination), and lists foreign-key relationships.
//
// Authorization: this page is wrapped in <RequireRole allow=isAdmin> in App.tsx
// — the Sidebar / route guard hides the menu link for non-ADMIN users. The
// /api/db/* endpoints themselves have no API-layer auth (parity with audit
// events + system logs + holidays — the frontend gate is the demo's gate).
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Settings } from '../lib/settings';
import { fmt, escapeHtml } from '../lib/app';
import { Db, type TableMeta, type ForeignKey } from '../lib/api/db';

const DB_TYPES = [
  { value: 'SQLITE',    label: 'SQLite (local file)' },
  { value: 'SQLSERVER', label: 'Microsoft SQL Server' },
  { value: 'POSTGRES',  label: 'PostgreSQL' }
];

// ---------- Settings card (unchanged from before Phase 15) ----------
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

      {/* ---------- Card 2: live inspector against the .103 PostgreSQL DB ---------- */}
      <DbInspector />

    </AppShell>
  );
}

function maskPassword(p: string): string {
  if (!p) return '';
  if (p.length <= 4) return '***';
  return '*'.repeat(Math.max(4, p.length - 4)) + p.slice(-4);
}

// ---------- DB inspector card ----------
interface TableInspectorState {
  // Row preview state — keeps per-table state independent of the tree
  // expand/collapse (a native <details> can't drive loading without rebuilds).
  visible: boolean;          // user clicked "Show rows"
  loading: boolean;
  rows: Record<string, unknown>[];
  cols: { name: string; type: string }[];
  offset: number;            // how many rows already loaded
  error: string | null;
  exactCount: number | null; // populated by /count on first expand
}

function DbInspector() {
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [fkEdges, setFkEdges] = useState<ForeignKey[]>([]);
  const [schema, setSchema] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perTable, setPerTable] = useState<Record<string, TableInspectorState>>({});

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await Db.overview();
      setTables(r.tables);
      setFkEdges(r.fkEdges);
      setSchema(r.schema);
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch DB overview.');
    } finally {
      setLoading(false);
    }
  };

  // Initial mount + when a hidden tab becomes visible again
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateTable = (name: string, patch: Partial<TableInspectorState>) => {
    setPerTable(prev => {
      const cur = prev[name] || {
        visible: false, loading: false, rows: [], cols: [],
        offset: 0, error: null, exactCount: null
      };
      return { ...prev, [name]: { ...cur, ...patch } };
    });
  };

  const onToggleRows = async (table: TableMeta) => {
    const cur = perTable[table.name];
    if (!cur || !cur.visible) {
      // Showing rows for the first time — fetch the first 10
      updateTable(table.name, { visible: true, loading: true, error: null });
      try {
        const r = await Db.sampleRows(table.name, { limit: 10, offset: 0 });
        updateTable(table.name, {
          rows: r.rows,
          cols: r.columns,
          offset: r.rows.length,
          loading: false
        });
      } catch (e: any) {
        updateTable(table.name, { loading: false, error: e?.message || 'Could not load rows.' });
      }
    } else {
      // Hiding
      updateTable(table.name, { visible: false });
    }
  };

  const onLoadMore = async (table: TableMeta) => {
    const cur = perTable[table.name];
    if (!cur) return;
    updateTable(table.name, { loading: true, error: null });
    try {
      const r = await Db.sampleRows(table.name, { limit: 50, offset: cur.offset });
      updateTable(table.name, {
        rows: [...cur.rows, ...r.rows],
        cols: r.columns,
        offset: cur.offset + r.rows.length,
        loading: false
      });
    } catch (e: any) {
      updateTable(table.name, { loading: false, error: e?.message || 'Could not load more rows.' });
    }
  };

  const holidayTables = tables.filter(t => t.name.startsWith('holiday')).length;

  return (
    <section className="card" style={{ marginTop: 'var(--space-4)' }}>
      <div className="card__head" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div>
          <h2 style={{ margin: 0 }}>Database inspector</h2>
          <div className="card__sub">
            Read-only view of the <code>public</code> schema in the live PostgreSQL backend
            (Express on <code>:8092</code>).
          </div>
        </div>
        <div className="btn-row" style={{ marginLeft: 'auto' }}>
          <button
            className="btn btn--sm"
            onClick={refresh}
            disabled={loading}
            title="Re-scan schema + re-resolve the SQL allow-list"
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {loading && tables.length === 0 && (
        <div className="alert alert--info" role="status">Loading schema from .103…</div>
      )}
      {error && (
        <div className="alert alert--danger" role="alert">
          ⚠️ Inspector unavailable: {escapeHtml(error)}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="text-muted text-sm" style={{ marginBottom: 'var(--space-2)' }}>
            Schema <code>{escapeHtml(schema)}</code> ·{' '}
            {tables.length} table{tables.length === 1 ? '' : 's'}
            {holidayTables > 0 ? ` · ${holidayTables} holiday-related` : ''} ·{' '}
            {fkEdges.length} FK relationship{fkEdges.length === 1 ? '' : 's'}
          </div>

          {/* ---------- Tree per table ---------- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {tables.map(t => (
              <TableNode
                key={t.name}
                table={t}
                state={perTable[t.name]}
                onToggleRows={() => onToggleRows(t)}
                onLoadMore={() => onLoadMore(t)}
              />
            ))}
            {tables.length === 0 && (
              <p className="text-muted">
                No tables found in the public schema.
              </p>
            )}
          </div>

          {/* ---------- FK relationships ---------- */}
          <h3 style={{ marginTop: 'var(--space-4)' }}>
            Foreign-key relationships
            {' '}<span className="text-muted text-sm">({fkEdges.length})</span>
          </h3>
          {fkEdges.length === 0 ? (
            <p className="text-muted">
              No foreign-key constraints declared in the public schema.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>From</th>
                  <th>→</th>
                  <th>To</th>
                  <th>On delete / update</th>
                  <th>Constraint</th>
                </tr>
              </thead>
              <tbody>
                {fkEdges.map(e => (
                  <tr key={e.constraintName}>
                    <td>
                      <code>{escapeHtml(e.fromTable)}.{escapeHtml(e.fromColumns.join(', '))}</code>
                    </td>
                    <td className="text-muted">→</td>
                    <td>
                      <code>{escapeHtml(e.toTable)}.{escapeHtml(e.toColumns.join(', '))}</code>
                    </td>
                    <td className="text-muted text-sm">
                      ON DELETE {e.onDelete} · ON UPDATE {e.onUpdate}
                    </td>
                    <td className="text-muted text-sm">
                      <code>{escapeHtml(e.constraintName)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

// ---------- Per-table tree node ----------
function TableNode({
  table, state, onToggleRows, onLoadMore
}: {
  table: TableMeta;
  state?: TableInspectorState;
  onToggleRows: () => void;
  onLoadMore: () => void;
}) {
  const visible = state?.visible ?? false;
  // rowCount comes from COUNT(*) in listAllTablesWithColumns — exact, not
  // an estimate. -1 (or null) is the "unavailable" signal (e.g. count
  // failed mid-overview). Render as "?" rather than "0" so users don't
  // think the table is actually empty.
  const rcReliable = (table.rowCount ?? -1) >= 0;
  const rowCountLabel = rcReliable
    ? `${Number(table.rowCount).toLocaleString()} row${Number(table.rowCount) === 1 ? '' : 's'}`
    : '? rows (count unavailable — click "Show rows" for actual data)';
  return (
    <details
      className="card"
      style={{
        background: 'var(--color-surface-muted, #f8fafc)',
        border: '1px solid var(--color-border, #e2e8f0)',
        borderRadius: 6,
        padding: 'var(--space-2) var(--space-3)'
      }}
    >
      <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-block', width: 12, textAlign: 'center' }} aria-hidden="true">▸</span>
          <strong>{escapeHtml(table.name)}</strong>
          <span className="badge badge--muted">{table.kind}</span>
          <span className="text-muted text-sm">{rowCountLabel}</span>
          <span className="text-muted text-sm">
            · {table.columns.length} column{table.columns.length === 1 ? '' : 's'}
          </span>
        </div>
      </summary>

      {/* Columns table + "Show rows" button — visible only when details is open */}
      <div style={{ marginTop: 'var(--space-3)' }}>
        <h4 style={{ margin: '0 0 var(--space-2) 0' }}>Columns</h4>
        {table.columns.length === 0 ? (
          <p className="text-muted">No columns found.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Nullable</th><th>Default</th><th>Key</th></tr>
            </thead>
            <tbody>
              {table.columns.map(c => (
                <tr key={c.name}>
                  <td><code>{escapeHtml(c.name)}</code></td>
                  <td className="text-muted text-sm">{escapeHtml(c.type)}</td>
                  <td>{c.nullable ? <span className="text-muted text-sm">YES</span> : <span className="text-muted text-sm">NO</span>}</td>
                  <td className="text-muted text-sm">
                    {c.default ? <code>{escapeHtml(c.default)}</code> : <span className="text-muted">—</span>}
                  </td>
                  <td>{c.isPrimaryKey ? <span className="badge badge--success">PK</span> : <span className="text-muted text-sm">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* The "Show rows" / "Hide rows" button sits HERE (in the details body),
            not inside the <summary>. Clicking it must NOT bubble up to the
            summary click handler — otherwise state.visible flips AND <details>
            toggles closed on the same click, hiding the rows the user just
            asked for. With the button outside <summary>, the two interactions
            are independent: open details to see the button, click button to
            load row preview. */}
        <div className="btn-row" style={{ marginTop: 'var(--space-3)' }}>
          <button
            className="btn btn--ghost btn--sm"
            onClick={onToggleRows}
            disabled={state?.loading}
          >
            {state?.loading ? 'Loading rows…' : visible ? 'Hide rows' : 'Show first 10 rows'}
          </button>
          {visible && state && (
            <span className="text-muted text-sm">
              showing {state.rows.length} row{state.rows.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {/* Row preview */}
      {visible && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <h4 style={{ margin: '0 0 var(--space-2) 0' }}>
            Sample rows{' '}
            <span className="text-muted text-sm">
              ({state?.rows.length ?? 0} loaded{state && state.rows.length > 0 ? ' so far' : ''})
            </span>
          </h4>
          {state?.error && (
            <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(state.error)}</div>
          )}
          {!state?.error && state?.rows.length === 0 && !state?.loading && (
            <p className="text-muted">No rows in this table.</p>
          )}
          {state?.rows.length !== undefined && state.rows.length > 0 && state.cols.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    {state.cols.map(c => (
                      <th key={c.name}><code>{escapeHtml(c.name)}</code> <span className="text-muted text-sm">{escapeHtml(c.type)}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((row, ri) => (
                    <tr key={ri}>
                      {state.cols.map(c => (
                        <td key={c.name} className="text-sm">
                          <CellValue value={row[c.name]} type={c.type} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="btn-row" style={{ marginTop: 'var(--space-2)' }}>
            {state && state.offset < state.rows.length + 50 && state.rows.length >= 10 && (
              <button
                className="btn btn--sm"
                onClick={onLoadMore}
                disabled={state?.loading}
              >
                {state?.loading ? 'Loading…' : 'Load 50 more'}
              </button>
            )}
            <span className="text-muted text-sm">
              (row counts are estimates from <code>pg_class.reltuples</code>; click for live data)
            </span>
          </div>
        </div>
      )}
    </details>
  );
}

// Render a single cell value, handling nulls, dates, JSON, long strings.
function CellValue({ value, type }: { value: unknown; type: string }) {
  if (value == null) return <span className="text-muted">NULL</span>;
  if (typeof value === 'string') {
    // Dates come from the API as ISO strings (we marshal Date objects in the server).
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && type.includes('timestamp')) {
      return <span>{fmt.dateTime(value)}</span>;
    }
    if (value.length > 80) return <code title={value}>{escapeHtml(value.slice(0, 80))}…</code>;
    return <span>{escapeHtml(value)}</span>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>;
  }
  // Object (rare): JSON-ish
  try {
    const s = JSON.stringify(value);
    return <code>{escapeHtml(s.length > 80 ? s.slice(0, 80) + '…' : s)}</code>;
  } catch {
    return <span>[unserialisable]</span>;
  }
}
