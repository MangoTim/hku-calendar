// Admin system logs — fetch from remote API (proxied to :8092). Toggle resolved state.
import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { SystemLogs } from '../lib/audit';
import type { SystemLog } from '../lib/types';
import { fmt, escapeHtml } from '../lib/app';

const LEVELS: SystemLog['level'][] = ['INFO', 'WARN', 'ERROR', 'CRITICAL'];

export function AdminSystemLogs() {
  const [rows, setRows] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [q, setQ] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [resolvedFilter, setResolvedFilter] = useState<'all' | 'open' | 'resolved'>('open');

  const refresh = () => setRev(v => v + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    SystemLogs.all()
      .then(r => { if (!cancelled) { setRows(r); setError(null); } })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rev]);

  const categories = useMemo(() => Array.from(new Set(rows.map(r => r.category))).sort(), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (levelFilter && r.level !== levelFilter) return false;
      if (categoryFilter && r.category !== categoryFilter) return false;
      if (resolvedFilter === 'open' && r.resolved) return false;
      if (resolvedFilter === 'resolved' && !r.resolved) return false;
      if (!needle) return true;
      return (
        r.message.toLowerCase().includes(needle) ||
        r.category.toLowerCase().includes(needle) ||
        (r.detail || '').toLowerCase().includes(needle)
      );
    });
  }, [rows, q, levelFilter, categoryFilter, resolvedFilter]);

  const onToggleResolved = async (r: SystemLog) => {
    try {
      await SystemLogs.setResolved(r.id, !r.resolved);
      refresh();
    } catch (e) {
      alert(`Failed to update: ${(e as Error).message}`);
    }
  };

  const levelBadge = (level: SystemLog['level']) => {
    const cls = level === 'CRITICAL' ? 'badge--danger'
      : level === 'ERROR'   ? 'badge--danger'
      : level === 'WARN'    ? 'badge--warning'
      : 'badge--info';
    return <span className={`badge ${cls}`}>{level}</span>;
  };

  return (
    <AppShell title="System logs">
      <div className="page-header">
        <div>
          <h1>System logs</h1>
          <div className="page-header__sub">
            {rows.length} entries from <code>192.168.147.103/engg_intranet.system_logs</code>
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/admin">← Back to admin</Link>
          <button className="btn" onClick={refresh}>↻ Refresh</button>
        </div>
      </div>

      {error && (
        <div className="alert alert--danger" role="alert">
          ⚠️ Failed to load system logs: {escapeHtml(error)}. Is the API server running?
        </div>
      )}

      <div className="toolbar">
        <input
          type="search"
          className="form__input"
          placeholder="Search message / detail…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <select className="form__select" value={levelFilter} onChange={e => setLevelFilter(e.target.value)} style={{ maxWidth: 160 }}>
          <option value="">All levels</option>
          {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className="form__select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">All categories ({categories.length})</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="seg">
          {(['all', 'open', 'resolved'] as const).map(o => (
            <button
              key={o}
              className={`btn btn--sm ${resolvedFilter === o ? 'is-active' : ''}`}
              onClick={() => setResolvedFilter(o)}
            >
              {o === 'all' ? 'All' : o === 'open' ? '🟢 Open' : '✅ Resolved'}
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
            <table className="table" aria-label="System logs">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Level</th>
                  <th>Category</th>
                  <th>Message</th>
                  <th>Detail</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td>{fmt.dateTime(r.createdAt)}</td>
                    <td>{levelBadge(r.level)}</td>
                    <td><code>{escapeHtml(r.category)}</code></td>
                    <td>{escapeHtml(r.message)}</td>
                    <td className="text-sm text-muted">{escapeHtml(r.detail || '—')}</td>
                    <td className="actions">
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => onToggleResolved(r)}
                      >
                        {r.resolved ? '↩ Reopen' : '✓ Resolve'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <div className="empty">No system log entries match the current filters.</div>
        )}
      </section>
    </AppShell>
  );
}