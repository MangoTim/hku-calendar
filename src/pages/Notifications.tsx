// Notifications — list for current user, mark-as-read, channel filter.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { Notifications } from '../lib/notifications';
import { fmt, escapeHtml } from '../lib/app';
import type { Notification } from '../lib/types';

type ChannelFilter = 'ALL' | 'IN_APP' | 'EMAIL';
type ReadFilter = 'ALL' | 'UNREAD' | 'READ';

export function NotificationsPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [channel, setChannel] = useState<ChannelFilter>('ALL');
  const [readFilter, setReadFilter] = useState<ReadFilter>('ALL');
  const [rev, setRev] = useState(0);

  const list = useMemo(() => {
    let l = Notifications.forUser(user!.id);
    if (channel !== 'ALL') l = l.filter(n => n.channel === channel);
    if (readFilter === 'UNREAD') l = l.filter(n => !n.read);
    if (readFilter === 'READ')   l = l.filter(n => n.read);
    return Notifications.sorted(l);
  }, [user, channel, readFilter, rev]);

  const counts = useMemo(() => {
    const all = Notifications.forUser(user!.id);
    return {
      total: all.length,
      unread: all.filter(n => !n.read).length,
      inApp: all.filter(n => n.channel === 'IN_APP').length,
      email: all.filter(n => n.channel === 'EMAIL').length
    };
  }, [user, rev]);

  const onClick = (n: Notification) => {
    Notifications.markRead(n.id);
    setRev(v => v + 1);
    // Resolve legacy static URL → React path. Seed data uses old `.html` paths
    // (e.g. `/bookings/detail.html?id=3`, `/tasks/mine.html`, `/admin/audit.html`).
    let raw = n.link;
    const queryStart = raw.indexOf('?');
    const query = queryStart >= 0 ? raw.slice(queryStart) : '';
    raw = queryStart >= 0 ? raw.slice(0, queryStart) : raw;
    raw = raw.replace(/\.html$/, '');

    // Convert /<thing>/index → /<thing>
    if (/^\/(bookings|leave|tasks|admin|notifications|announcements)\/index$/.test(raw)) {
      raw = raw.replace(/\/index$/, '');
    }
    // Convert /<thing>/detail?id=N → /<thing>/N
    const detailMatch = raw.match(/^\/(bookings|tasks|leave|announcements|admin)\/detail$/);
    if (detailMatch) {
      const params = new URLSearchParams(query);
      const id = params.get('id');
      if (id) raw = `/${detailMatch[1]}/${id}`;
    }
    // Convert /<thing>/edit?id=N → /<thing>/N/edit (for any future seeded links)
    const editMatch = raw.match(/^\/(bookings|tasks|leave|announcements|admin)\/edit$/);
    if (editMatch) {
      const params = new URLSearchParams(query);
      const id = params.get('id');
      if (id) raw = `/${editMatch[1]}/${id}/edit`;
    }
    nav(raw || '/dashboard');
  };

  const onMarkAll = () => {
    Notifications.markAllRead(user!.id);
    setRev(v => v + 1);
  };

  return (
    <AppShell title="Notifications">
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <div className="page-header__sub">
            {list.length} visible · {counts.unread} unread
          </div>
        </div>
        <div className="page-header__actions">
          {counts.unread > 0 && (
            <button className="btn" onClick={onMarkAll}>✓ Mark all as read</button>
          )}
        </div>
      </div>

      <div className="toolbar">
        <span className="text-muted text-sm">Channel</span>
        <select
          className="form__select"
          style={{ width: 'auto' }}
          value={channel}
          onChange={e => setChannel(e.target.value as ChannelFilter)}
        >
          <option value="ALL">All ({counts.total})</option>
          <option value="IN_APP">In-app ({counts.inApp})</option>
          <option value="EMAIL">Email ({counts.email})</option>
        </select>

        <span className="toolbar__sep"></span>

        <span className="text-muted text-sm">Status</span>
        <select
          className="form__select"
          style={{ width: 'auto' }}
          value={readFilter}
          onChange={e => setReadFilter(e.target.value as ReadFilter)}
        >
          <option value="ALL">All</option>
          <option value="UNREAD">Unread ({counts.unread})</option>
          <option value="READ">Read</option>
        </select>
      </div>

      {list.length === 0 ? (
        <div className="card empty">No notifications match your filters.</div>
      ) : (
        <div className="dash-grid">
          {list.map(n => (
            <NotificationItem
              key={n.id}
              n={n}
              onOpen={() => onClick(n)}
              onToggleRead={() => {
                if (n.read) Notifications.markUnread(n.id);
                else Notifications.markRead(n.id);
                setRev(v => v + 1);
              }}
            />
          ))}
        </div>
      )}

      <p className="text-muted text-sm" style={{ marginTop: 'var(--space-4)' }}>
        Tip: <Link to="/profile">Profile preferences</Link> control which digests get delivered.
      </p>
    </AppShell>
  );
}

function NotificationItem({ n, onOpen, onToggleRead }: { n: Notification; onOpen: () => void; onToggleRead: () => void }) {
  const channelClass = n.channel === 'EMAIL' ? 'badge--warning' : 'badge--info';
  return (
    <article
      className="card"
      style={{
        borderLeft: n.read ? undefined : '3px solid var(--color-primary)',
        opacity: n.read ? 0.85 : 1
      }}
    >
      <div className="flex" style={{ alignItems: 'baseline', gap: 'var(--space-2)' }}>
        {!n.read && <span className="badge badge--primary">NEW</span>}
        <strong>{escapeHtml(n.subject)}</strong>
        <span className={`badge ${channelClass}`}>{escapeHtml(n.channel)}</span>
        <span className="right text-muted text-sm">{fmt.dateTime(n.createdAt)}</span>
      </div>
      <p className="text-sm" style={{ marginTop: 'var(--space-2)' }}>{escapeHtml(n.message)}</p>
      <div className="text-sm" style={{ marginTop: 'var(--space-2)', display: 'flex', gap: 'var(--space-3)' }}>
        <button className="btn btn--ghost btn--sm" onClick={onOpen}>Open →</button>
        <button className="btn btn--ghost btn--sm" onClick={onToggleRead}>
          {n.read ? 'Mark unread' : 'Mark read'}
        </button>
      </div>
    </article>
  );
}