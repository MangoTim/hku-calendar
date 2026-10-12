// Admin database — live connection view + DB inspector.
//
// Card 1: read-only "Active connection" populated from /api/db/connection.
// The connection is set at container build/run time via process.env.DB_*
// (see server/src/db.ts:19-23). To "switch" the displayed DB, rebuild the
// container with different env vars — no admin action needed here.
//
// Card 2: live inspector against the PostgreSQL DB the Express API is
// connected to. Read-only, public schema only. Fetches on mount via
// /api/db/overview, lets admins expand a table to see columns + first 10
// rows (with "Load 50 more" pagination), and lists foreign-key
// relationships.
//
// Authorization: this page is wrapped in <RequireRole allow=isAdmin> in
// App.tsx — the Sidebar / route guard hides the menu link for non-ADMIN
// users. The /api/db/* endpoints themselves have no API-layer auth (parity
// with audit events + system logs + holidays — the frontend gate is the
// demo's gate).
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { fmt, escapeHtml } from '../lib/app';
import { Db, type ConnectionResult, type TableMeta, type ForeignKey } from '../lib/api/db';

// ---------- Active connection card (read-only, live from /api/db/connection) ----------
export function AdminDatabase() {
  const [conn, setConn] = useState<ConnectionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await Db.connection();
      setConn(r);
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch connection info.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <AppShell title="Database">
      <div className="page-header">
        <div>
          <h1>Database connection</h1>
          <div className="page-header__sub">
            Live view of the PostgreSQL backend the API is connected to. Set at container build time via <code>DB_HOST</code> / <code>DB_PORT</code> / <code>DB_NAME</code> / <code>DB_USER</code> — rebuild to switch.
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/admin">← Back to admin</Link>
        </div>
      </div>

      {error && (
        <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(error)}</div>
      )}

      <section className="card">
        <div className="card__head" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <div>
            <h2 style={{ margin: 0 }}>Active connection</h2>
            <div className="card__sub">
              Source of truth: the Express API server on <code>:8092</code>.
            </div>
          </div>
          <div className="btn-row" style={{ marginLeft: 'auto' }}>
            {conn && (
              <span
                className={`badge ${conn.isReachable ? 'badge--success' : 'badge--danger'}`}
                title={conn.isReachable ? 'Pool responded to SELECT 1' : conn.error || ''}
              >
                {conn.isReachable ? '● Connected' : '● Unreachable'}
              </span>
            )}
            <button
              className="btn btn--sm"
              onClick={refresh}
              disabled={loading}
              title="Re-probe the pool + re-read env-derived config"
            >
              {loading ? 'Probing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {loading && !conn && (
          <div className="alert alert--info" role="status">Probing connection…</div>
        )}

        {conn && (
          <dl
            className="kv-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '180px 1fr',
              rowGap: 'var(--space-2)',
              columnGap: 'var(--space-3)',
              margin: 0
            }}
          >
            <dt className="text-muted text-sm">Type</dt>
            <dd style={{ margin: 0 }}><code>{escapeHtml(conn.dbType)}</code></dd>

            <dt className="text-muted text-sm">Host</dt>
            <dd style={{ margin: 0 }}><code>{escapeHtml(conn.host)}</code></dd>

            <dt className="text-muted text-sm">Port</dt>
            <dd style={{ margin: 0 }}><code>{conn.port}</code></dd>

            <dt className="text-muted text-sm">Database</dt>
            <dd style={{ margin: 0 }}><code>{escapeHtml(conn.databaseName)}</code></dd>

            <dt className="text-muted text-sm">Username</dt>
            <dd style={{ margin: 0 }}><code>{escapeHtml(conn.username)}</code></dd>

            <dt className="text-muted text-sm">Password</dt>
            <dd style={{ margin: 0 }}>
              {conn.passwordSet
                ? <><span className="badge badge--success">● set</span> <span className="text-muted text-sm">(value is never returned by the API)</span></>
                : <><span className="badge badge--muted">● not set</span> <span className="text-muted text-sm">(default empty)</span></>}
            </dd>

            <dt className="text-muted text-sm">SSL mode</dt>
            <dd style={{ margin: 0 }}><code>{escapeHtml(conn.sslMode)}</code></dd>

            <dt className="text-muted text-sm">Reachable</dt>
            <dd style={{ margin: 0 }}>
              {conn.isReachable
                ? <span className="badge badge--success">✓ yes</span>
                : <><span className="badge badge--danger">✗ no</span> <span className="text-muted text-sm">{escapeHtml(conn.error || '—')}</span></>}
            </dd>

            <dt className="text-muted text-sm">API server started</dt>
            <dd style={{ margin: 0 }}>
              <span className="text-sm">{fmt.dateTime(conn.startedAt)}</span>
            </dd>
          </dl>
        )}
      </section>

      {/* ---------- Card 2: live inspector against the connected PostgreSQL DB ---------- */}
      <DbInspector />

    </AppShell>
  );
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
