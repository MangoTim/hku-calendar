// Dashboard — welcome, upcoming bookings / leave / due-soon tasks / unread / announcements / quick links.
// Port of static dashboard.html using the same data shapes.
import { useAuth } from '../contexts/AuthContext';
import { AppShell } from '../components/AppShell';
import {
  ROOMS, USERS,
  TASK_SETTINGS, holidayName
} from '../lib/data';
import { Tasks } from '../lib/tasks';
import { Bookings } from '../lib/bookings';
import { Leave } from '../lib/leave';
import { Announcements } from '../lib/announcements';
import { Notifications } from '../lib/notifications';
import { fmt, escapeHtml, todayISO, addDaysISO } from '../lib/app';
import { DashboardCalendar } from '../components/DashboardCalendar';

const userById = (id: number) => USERS.find(u => u.id === id) || null;
const roomById = (id: number) => ROOMS.find(r => r.id === id) || null;

export function Dashboard() {
  const { session, user, ROLE } = useAuth();
  if (!session || !user) return null;

  const today = todayISO();
  const N = TASK_SETTINGS.taskDeadlineAlertDays;
  const todayHol = holidayName(today);

  // Upcoming bookings (made by me, from today onward) — read via Bookings.all() so user-cancelled/created bookings reflect
  const myUpcomingBookings = Bookings.all()
    .filter(b => b.bookedById === user.id && b.status === 'CONFIRMED' && b.date >= today)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
    .slice(0, 4);

  // Upcoming leave (mine, not cancelled, ends today or later) — via Leave.all()
  const myUpcomingLeave = Leave.all()
    .filter(l => l.userId === user.id && l.status !== 'CANCELLED' && l.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 4);

  // My tasks (assigned to me, not DONE) — read from Tasks.all() so user-edited progress/status reflect
  const myTasks = Tasks.all().filter(t => t.assigneeId === user.id && t.status !== 'DONE');

  // Due-soon
  const dueSoon = myTasks.filter(
    t => t.dueDate && t.dueDate >= today && t.dueDate <= addDaysISO(today, N - 1)
  );

  // Unread notifications (respects per-user read state from localStorage)
  const unread = Notifications.forUser(user.id).filter(n => !n.read);

  // Recent announcements — via Announcements.all() so user-posted ones show
  const recent = Announcements.all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);

  const lastName = user.displayName.split(' ').slice(-1)[0] || user.displayName;
  const leaveTypeColor: Record<string, string> = {
    ANNUAL: 'primary', SICK: 'danger', UNPAID: 'muted',
    MATERNITY: 'purple', PATERNITY: 'info',
    COMPASSIONATE: 'warning', STUDY: 'success'
  };
  const taskStatusColor: Record<string, string> = {
    OPEN: 'muted', IN_PROGRESS: 'primary', DONE: 'success'
  };
  const taskPriorityColor: Record<string, string> = {
    HIGH: 'danger', NORMAL: 'muted', LOW: 'info'
  };

  return (
    <AppShell title="Dashboard">
      <div className="page-header">
        <div>
          <h1>Welcome, {escapeHtml(lastName)} 👋</h1>
          <div className="page-header__sub">{escapeHtml(user.team)} · {fmt.role(user.role)}</div>
        </div>
        <div className="page-header__actions">
          <a className="btn" href="/bookings/new">+ New booking</a>
          <a className="btn" href="/leave/new">+ Mark leave</a>
          {ROLE.canAssignTasks() && <a className="btn btn--primary" href="/tasks/new">+ New task</a>}
        </div>
      </div>

      {todayHol && (
        <div className="alert alert--muted" role="status">
          📅 Today is a Hong Kong public holiday: <strong>{escapeHtml(todayHol)}</strong>.
          New bookings, leave, and task due dates are blocked on holidays.
        </div>
      )}

      <div className="dash-grid">
        {/* Upcoming bookings */}
        <section className="card" aria-labelledby="bookingsCard">
          <div className="card__head">
            <div>
              <div className="card__title" id="bookingsCard">My upcoming bookings</div>
              <div className="card__sub">Next {myUpcomingBookings.length} confirmed</div>
            </div>
            <a className="btn btn--ghost btn--sm" href="/bookings">View all →</a>
          </div>
          {myUpcomingBookings.length === 0 ? (
            <div className="empty">No upcoming bookings.</div>
          ) : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Date</th><th>Time</th><th>Room</th><th>Purpose</th></tr></thead>
              <tbody>
                {myUpcomingBookings.map(b => {
                  const room = roomById(b.roomId);
                  return (
                    <tr key={b.id}>
                      <td>{fmt.dateLong(b.date)}</td>
                      <td>{fmt.timeRange(b.startTime, b.endTime)}</td>
                      <td>{room?.name || '—'} <span className="text-muted">({room?.building || ''})</span></td>
                      <td>{escapeHtml(b.purpose)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </section>

        {/* Upcoming leave */}
        <section className="card" aria-labelledby="leaveCard">
          <div className="card__head">
            <div>
              <div className="card__title" id="leaveCard">My upcoming leave</div>
              <div className="card__sub">From today onward</div>
            </div>
            <a className="btn btn--ghost btn--sm" href="/leave">View all →</a>
          </div>
          {myUpcomingLeave.length === 0 ? (
            <div className="empty">No upcoming leave.</div>
          ) : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Dates</th><th>Type</th><th>Note</th></tr></thead>
              <tbody>
                {myUpcomingLeave.map(l => (
                  <tr key={l.id}>
                    <td><a href={`/leave/${l.id}`}>{fmt.dateLong(l.startDate)} – {fmt.dateLong(l.endDate)}</a></td>
                    <td>
                      <span className={`chip chip--leave-${leaveTypeColor[l.type] || 'muted'}`}
                            style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                        {l.type.charAt(0) + l.type.slice(1).toLowerCase().replace('_', ' ')}
                      </span>
                    </td>
                    <td className="text-muted">{escapeHtml(l.note || '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>

        {/* Due-soon tasks */}
        <section className="card" aria-labelledby="dueCard">
          <div className="card__head">
            <div>
              <div className="card__title" id="dueCard">Tasks due within {N} days</div>
              <div className="card__sub">Assignee: you</div>
            </div>
            <a className="btn btn--ghost btn--sm" href="/tasks/mine">My tasks →</a>
          </div>
          {dueSoon.length === 0 ? (
            <div className="empty">Nothing due within {N} days.</div>
          ) : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Title</th><th>Due</th><th>Progress</th><th></th></tr></thead>
              <tbody>
                {dueSoon.map(t => {
                  const sm = taskStatusColor[t.status] || 'muted';
                  return (
                    <tr key={t.id}>
                      <td>
                        <a href={`/tasks/${t.id}`}>{escapeHtml(t.title)}</a>{' '}
                        <span className={`badge badge--${taskPriorityColor[t.priority] || 'muted'}`}>
                          {t.priority.charAt(0) + t.priority.slice(1).toLowerCase()}
                        </span>
                      </td>
                      <td>{fmt.dateLong(t.dueDate)}</td>
                      <td>
                        <div className="progress" style={{ width: 120 }}>
                          <div className="progress__bar" style={{ width: `${t.progressPercent}%`, background: `var(--color-${sm})` }} />
                        </div>
                        <span className="text-muted text-sm">{t.progressPercent}%</span>
                      </td>
                      <td className="actions">
                        <a className="btn btn--ghost btn--sm" href={`/tasks/${t.id}`}>Open</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </section>

        {/* Unread notifications */}
        <section className="card" aria-labelledby="notiCard">
          <div className="card__head">
            <div>
              <div className="card__title" id="notiCard">Unread notifications</div>
              <div className="card__sub">{unread.length} unread</div>
            </div>
            <a className="btn btn--ghost btn--sm" href="/notifications">View all →</a>
          </div>
          {unread.length === 0 ? (
            <div className="empty">No unread notifications.</div>
          ) : (
            unread.slice(0, 5).map(n => (
              <div key={n.id} className="card" style={{ marginTop: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)' }}>
                <div className="flex">
                  <strong>{escapeHtml(n.subject)}</strong>
                  <span className="badge badge--info">{escapeHtml(n.channel)}</span>
                  <span className="right text-muted text-sm">{fmt.dateTime(n.createdAt)}</span>
                </div>
                <div className="text-muted text-sm">{escapeHtml(n.message)}</div>
                <div className="text-sm" style={{ marginTop: 'var(--space-2)' }}>
                  <a href={`/notifications`}>Open in inbox →</a>
                </div>
              </div>
            ))
          )}
        </section>

        {/* Recent announcements */}
        <section className="card" aria-labelledby="annCard">
          <div className="card__head">
            <div>
              <div className="card__title" id="annCard">Recent announcements</div>
              <div className="card__sub">From admin</div>
            </div>
            <a className="btn btn--ghost btn--sm" href="/announcements">View all →</a>
          </div>
          {recent.map(a => {
            const poster = userById(a.postedById);
            return (
              <div key={a.id} className="card" style={{ marginTop: 'var(--space-2)', padding: 'var(--space-3)' }}>
                <div className="flex">
                  <strong>{escapeHtml(a.title)}</strong>
                  <span className="right text-muted text-sm">{fmt.dateLong(a.createdAt)}</span>
                </div>
                <div className="text-sm">{escapeHtml(a.body)}</div>
                {a.fileUrl && (
                  <div className="text-sm" style={{ marginTop: 4 }}>
                    📎 <a href={a.fileUrl} target="_blank" rel="noopener">
                      {escapeHtml(a.fileLabel || a.fileUrl)}
                    </a>
                  </div>
                )}
                <div className="text-muted text-sm">Posted by {escapeHtml(poster?.displayName || '—')}</div>
              </div>
            );
          })}
        </section>

        {/* Quick links */}
        <section className="card" aria-labelledby="quickCard">
          <div className="card__head">
            <div className="card__title" id="quickCard">Quick links</div>
          </div>
          <div className="btn-row">
            <a className="btn" href="/bookings">📅 Open calendar</a>
            <a className="btn" href="/tasks/mine">✅ My tasks</a>
            <a className="btn" href="/leave">🏖️ Leave calendar</a>
            <a className="btn" href="/announcements/new">📣 New announcement</a>
            <a className="btn" href="/notifications">🔔 Notifications</a>
            <a className="btn" href="/profile">👤 Profile</a>
            {ROLE.isAdmin() && <a className="btn btn--primary" href="/admin">🛠️ Admin console</a>}
            {ROLE.canSeeAudit() && <a className="btn" href="/admin/audit">📜 Audit trail</a>}
          </div>
        </section>
      </div>

      {/* Unified schedule overview — bookings, leave, task deadlines in one month grid. */}
      <DashboardCalendar />
    </AppShell>
  );
}
