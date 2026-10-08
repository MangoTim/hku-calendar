// Announcements list — newest-first with optional search.
// TASK_MANAGER/ADMIN can post a new one.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { Announcements } from '../lib/announcements';
import { USERS } from '../lib/data';
import { fmt, escapeHtml } from '../lib/app';

export function AnnouncementsPage() {
  const { ROLE } = useAuth();
  const [query, setQuery] = useState('');
  const list = useMemo(() => Announcements.search(query), [query]);
  const canPost = ROLE.canAssignTasks();

  return (
    <AppShell title="Announcements">
      <div className="page-header">
        <div>
          <h1>Announcements</h1>
          <div className="page-header__sub">{list.length} visible</div>
        </div>
        <div className="page-header__actions">
          {canPost && <Link className="btn btn--primary" to="/announcements/new">+ New announcement</Link>}
        </div>
      </div>

      <div className="toolbar">
        <input
          className="form__input"
          style={{ maxWidth: 320 }}
          placeholder="🔎 Search announcements"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {query && (
          <button className="btn btn--ghost btn--sm" onClick={() => setQuery('')}>Clear</button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="card empty">No announcements match your search.</div>
      ) : (
        <div className="dash-grid dash-grid--2">
          {list.map(a => <AnnouncementCard key={a.id} a={a} />)}
        </div>
      )}
    </AppShell>
  );
}

function AnnouncementCard({ a }: { a: ReturnType<typeof Announcements.all>[number] }) {
  const poster = USERS.find(u => u.id === a.postedById);
  return (
    <article className="card">
      <div className="flex" style={{ alignItems: 'baseline', gap: 'var(--space-2)' }}>
        <Link className="card__title" to={`/announcements/${a.id}`}>{escapeHtml(a.title)}</Link>
        <span className="right text-muted text-sm">{fmt.dateLong(a.createdAt)}</span>
      </div>
      <p className="text-sm" style={{ marginTop: 'var(--space-2)' }}>
        {escapeHtml(a.body.length > 220 ? a.body.slice(0, 220) + '…' : a.body)}
      </p>
      {a.fileUrl && (
        <div className="text-sm" style={{ marginTop: 'var(--space-2)' }}>
          📎 <a href={a.fileUrl} target="_blank" rel="noopener noreferrer">
            {escapeHtml(a.fileLabel || a.fileUrl)}
          </a>
        </div>
      )}
      <div className="text-muted text-sm" style={{ marginTop: 'var(--space-2)' }}>
        Posted by {escapeHtml(poster?.displayName || '—')} ({escapeHtml(poster?.team || '')})
        {' · '}
        <Link to={`/announcements/${a.id}`}>Open →</Link>
      </div>
    </article>
  );
}