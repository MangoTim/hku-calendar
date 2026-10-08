// Leave detail — summary + note + calendar overlap + ICS export + cancel.
// Port of static leave/detail.html.
import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { Leave } from '../lib/leave';
import { USERS, holidayName } from '../lib/data';
import { fmt, escapeHtml } from '../lib/app';

export function LeaveDetail() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const { user, ROLE } = useAuth();
  const [, setRev] = useState(0);
  const justCreated = params.get('justCreated') === '1';

  const l = Leave.byId(Number(id));
  if (!l) {
    return (
      <AppShell title="Leave">
        <div className="page-header">
          <h1>Leave not found</h1>
          <Link className="btn" to="/leave">← Back to calendar</Link>
        </div>
      </AppShell>
    );
  }

  const person = USERS.find(u => u.id === l.userId);
  const meta = Leave.typeMeta(l.type);
  const days = Leave.daysCount(l);
  const canEdit = ROLE.isAdmin() || ROLE.isTaskManager() || l.userId === user!.id;
  const canCancel = canEdit && l.status !== 'CANCELLED';

  const overlap = Leave.all().filter(x =>
    x.id !== l.id &&
    x.status !== 'CANCELLED' &&
    x.userId === l.userId &&
    !(x.endDate < l.startDate || x.startDate > l.endDate)
  );

  const onCancel = () => {
    if (confirm('Cancel this leave record? This cannot be reverted.')) {
      Leave.cancel(l.id);
      setRev(v => v + 1);
    }
  };

  const onExport = () => Leave.downloadIcs([l], `leave-${l.id}.ics`);

  return (
    <AppShell title="Leave">
      <div className="page-header">
        <div>
          <h1>{person?.displayName || 'Unknown'} · {meta.label}</h1>
          <div className="page-header__sub">
            {fmt.dateLong(l.startDate)} – {fmt.dateLong(l.endDate)} · {days} day{days === 1 ? '' : 's'}
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/leave">← Back to calendar</Link>
          {canEdit && <Link className="btn" to={`/leave/${l.id}/edit`}>Edit</Link>}
          <button className="btn" onClick={onExport}>⬇ Export ICS</button>
          {canCancel && (
            <button className="btn btn--danger" onClick={onCancel}>Cancel leave</button>
          )}
        </div>
      </div>

      {justCreated && (
        <div className="alert alert--success" role="status">
          ✅ Leave recorded (demo: auto-approved). ICS export ready.
        </div>
      )}

      <div className="dash-grid dash-grid--2">
        <section className="card">
          <h2>Leave summary</h2>
          <table className="table">
            <tbody>
              <tr>
                <th>Status</th>
                <td>
                  <span className={`badge badge--${l.status === 'CANCELLED' ? 'muted' : 'success'}`}>
                    {l.status}
                  </span>
                </td>
              </tr>
              <tr>
                <th>Person</th>
                <td>
                  {person?.displayName || '—'}{' '}
                  <span className="text-muted">({person?.team || ''})</span>
                </td>
              </tr>
              <tr>
                <th>Type</th>
                <td>
                  <span
                    className={`chip chip--leave-${meta.color}`}
                    style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}
                  >
                    {meta.label}
                  </span>
                </td>
              </tr>
              <tr>
                <th>Start</th>
                <td>
                  {fmt.dateLong(l.startDate)}
                  {holidayName(l.startDate) && (
                    <> <span className="badge badge--warning">Holiday: {holidayName(l.startDate)}</span></>
                  )}
                </td>
              </tr>
              <tr>
                <th>End</th>
                <td>
                  {fmt.dateLong(l.endDate)}
                  {holidayName(l.endDate) && (
                    <> <span className="badge badge--warning">Holiday: {holidayName(l.endDate)}</span></>
                  )}
                </td>
              </tr>
              <tr><th>Days</th><td>{days}</td></tr>
              <tr>
                <th>Created at</th>
                <td className="text-muted">
                  {l.createdAt ? fmt.dateTime(l.createdAt) : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Note</h2>
          <p>
            {l.note
              ? escapeHtml(l.note)
              : <span className="text-muted">No note provided.</span>}
          </p>

          <h2 style={{ marginTop: 'var(--space-4)' }}>Calendar overlap</h2>
          {overlap.length === 0 ? (
            <p className="text-muted">No other leave for the same person during this window.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {overlap.map(o => {
                const u = USERS.find(x => x.id === o.userId);
                const om = Leave.typeMeta(o.type);
                return (
                  <li key={o.id}>
                    <Link to={`/leave/${o.id}`}>
                      {om.label} — {fmt.dateLong(o.startDate)} – {fmt.dateLong(o.endDate)}
                    </Link>
                    {u && <> <span className="text-muted">({u.displayName})</span></>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Add to your calendar</h2>
          <p className="text-muted">
            Download an .ics file to add this leave (all-day) to Outlook, iOS Calendar, Google Calendar, etc.
          </p>
          <button className="btn btn--primary btn--block" onClick={onExport}>
            ⬇ Download .ics
          </button>
        </section>
      </div>
    </AppShell>
  );
}