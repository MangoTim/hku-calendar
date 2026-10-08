// Admin audit trail — fetch from remote API (proxied to :8092).
import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { AuditEvents } from '../lib/audit';
import type { AuditEvent } from '../lib/types';
import { fmt, escapeHtml } from '../lib/app';

export function AdminAudit() {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [q, setQ] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'ok' | 'fail'>('all');

  const refresh = () => setRev(v => v + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    AuditEvents.all()
      .then(r => { if (!cancelled) { setRows(r); setError(null); } })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rev]);

  const actions = useMemo(() => Array.from(new Set(rows.map(r => r.actionType))).sort(), [rows]);
  const actors = useMemo(() => Array.from(new Set(rows.map(r => r.actorUsername))).sort(), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (actionFilter && r.actionType !== actionFilter) return false;
      if (actorFilter && r.actorUsername !== actorFilter) return false;
      if (outcomeFilter === 'ok' && !r.success) return false;
      if (outcomeFilter === 'fail' && r.success) return false;
      if (!needle) return true;
      return (
        r.actionType.toLowerCase().includes(needle) ||
        r.actorUsername.toLowerCase().includes(needle) ||
        (r.summary || '').toLowerCase().includes(needle) ||
        (r.resourceType || '').toLowerCase().includes(needle) ||
        (r.resourceId || '').toLowerCase().includes(needle)
      );
    });
  }, [rows, q, actionFilter, actorFilter, outcomeFilter]);

  return (
    <AppShell title="Audit trail">
      <div className="page-header">
        <div>
          <h1>Audit trail</h1>
          <div className="page-header__sub">
            {rows.length} events from <code>192.168.147.103/engg_intranet.audit_events</code> · proxied via <code>/api</code>
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/admin">← Back to admin</Link>
          <button className="btn" onClick={refresh}>↻ Refresh</button>
        </div>
      </div>

      {error && (
        <div className="alert alert--danger" role="alert">
          ⚠️ Failed to load audit events: {escapeHtml(error)}. Is the API server running?
        </div>
      )}

      <div className="toolbar">
        <input
          type="search"
          className="form__input"
          placeholder="Search summary / resource…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <select className="form__select" value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All actions ({actions.length})</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="form__select" value={actorFilter} onChange={e => setActorFilter(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">All actors ({actors.length})</option>
          {actors.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="seg">
          {(['all', 'ok', 'fail'] as const).map(o => (
            <button
              key={o}
              className={`btn btn--sm ${outcomeFilter === o ? 'is-active' : ''}`}
              onClick={() => setOutcomeFilter(o)}
            >
              {o === 'all' ? 'All' : o === 'ok' ? '✅ Success' : '⚠️ Failed'}
            </button>
          ))}
        </div>
        <div className="toolbar__sep" />
        <span className="text-muted text-sm">{filtered.length} of {rows.length}</span>
      </div>

      <section className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Audit events">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Summary</th>
                  <th>IP</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td>{fmt.dateTime(r.createdAt)}</td>
                    <td>{escapeHtml(r.actorUsername)}</td>
                    <td><code>{escapeHtml(r.actionType)}</code></td>
                    <td className="text-sm text-muted">
                      {escapeHtml(r.resourceType || '—')}{r.resourceId ? ` #${escapeHtml(r.resourceId)}` : ''}
                    </td>
                    <td>{escapeHtml(r.summary)}</td>
                    <td className="text-sm text-muted">{escapeHtml(r.ipAddress || '—')}</td>
                    <td>
                      {r.success
                        ? <span className="badge badge--success">OK</span>
                        : <span className="badge badge--danger">FAIL</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <div className="empty">No audit events match the current filters.</div>
        )}
      </section>
    </AppShell>
  );
}