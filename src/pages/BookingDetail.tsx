// Booking detail — summary + refreshments + support + ICS export + cancel.
// Port of static bookings/detail.html.
import { useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { useHoliday } from '../contexts/HolidayContext';
import { Bookings } from '../lib/bookings';
import { ROOMS, USERS } from '../lib/data';
import { fmt, escapeHtml } from '../lib/app';

export function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user, ROLE } = useAuth();
  const { holidayName } = useHoliday();
  const [, setRev] = useState(0); // force re-render after cancel
  const justCreated = params.get('justCreated') === '1';

  const b = Bookings.byId(Number(id));
  if (!b) {
    return (
      <AppShell title="Booking">
        <div className="page-header">
          <h1>Booking not found</h1>
          <Link className="btn" to="/bookings">← Back to calendar</Link>
        </div>
      </AppShell>
    );
  }

  const room = ROOMS.find(r => r.id === b.roomId);
  const booker = USERS.find(u => u.id === b.bookedById);
  const canEdit = user!.id === b.bookedById || ROLE.isAdmin();
  const canCancel = canEdit && b.status !== 'CANCELLED';

  const onCancel = () => {
    if (confirm(`Cancel booking ${b.ref}? This cannot be reverted.`)) {
      Bookings.cancel(b.id);
      setRev((v) => v + 1);
      // refresh
      setTimeout(() => nav(`/bookings/${b.id}`, { replace: true }), 0);
    }
  };

  const onExport = () => Bookings.downloadIcs([b], `${b.ref}.ics`);

  return (
    <AppShell title="Booking">
      <div className="page-header">
        <div>
          <h1>{b.ref} · {room?.name || 'Room'}</h1>
          <div className="page-header__sub">
            {fmt.dateLong(b.date)} · {b.startTime}–{b.endTime}
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/bookings">← Back to calendar</Link>
          {canEdit && <Link className="btn" to={`/bookings/${b.id}/edit`}>Edit</Link>}
          <button className="btn" onClick={onExport}>⬇ Export ICS</button>
          {canCancel && (
            <button className="btn btn--danger" onClick={onCancel}>Cancel booking</button>
          )}
        </div>
      </div>

      {justCreated && (
        <div className="alert alert--success" role="status">
          ✅ Booking <strong>{escapeHtml(b.ref)}</strong> confirmed (FCFS — status set immediately).
        </div>
      )}

      <div className="dash-grid dash-grid--2">
        <section className="card">
          <h2>Booking summary</h2>
          <table className="table">
            <tbody>
              <tr>
                <th>Status</th>
                <td>
                  <span className={`badge badge--${b.status === 'CONFIRMED' ? 'success' : 'muted'}`}>
                    {b.status}
                  </span>
                </td>
              </tr>
              <tr>
                <th>Date</th>
                <td>
                  {(() => {
                    const hname = holidayName(b.date);
                    return (
                      <>
                        {fmt.dateLong(b.date)}
                        {hname && <> <span className="badge badge--warning">Holiday: {hname}</span></>}
                      </>
                    );
                  })()}
                </td>
              </tr>
              <tr><th>Time</th><td>{b.startTime} – {b.endTime}</td></tr>
              <tr>
                <th>Room</th>
                <td>
                  {room?.name || '—'}{' '}
                  <span className="text-muted">({room?.building || ''}, max {room?.maxSeats || 0} seats)</span>
                </td>
              </tr>
              <tr><th>Purpose</th><td>{escapeHtml(b.purpose)}</td></tr>
              <tr>
                <th>Booked by</th>
                <td>
                  {booker?.displayName || '—'}{' '}
                  <span className="text-muted">({booker?.team || ''})</span>
                </td>
              </tr>
              <tr>
                <th>Created at</th>
                <td className="text-muted">{fmt.dateTime(b.createdAt || '')}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Refreshments & devices</h2>
          <table className="table">
            <tbody>
              <tr><th>Cups of tea</th><td>{b.cupsOfTea || 0}</td></tr>
              <tr><th>Warm water cups</th><td>{b.warmWater || 0}</td></tr>
              <tr><th>Cool water cups</th><td>{b.coolWater || 0}</td></tr>
              <tr><th>iPads</th><td>{b.iPads || 0}</td></tr>
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Support requests</h2>
          <p>
            {b.supportRequests
              ? escapeHtml(b.supportRequests)
              : <span className="text-muted">No other support requests.</span>}
          </p>
          <p>
            {b.itSupport
              ? <span className="badge badge--warning">⚠ IT technical support requested</span>
              : <span className="text-muted">No IT support requested.</span>}
            {b.itSupport && <> <span className="text-muted">ADMINs notified.</span></>}
          </p>
        </section>

        <section className="card">
          <h2>Add to your calendar</h2>
          <p className="text-muted">
            Download an .ics file to add this booking to Outlook, iOS Calendar, Google Calendar, etc.
          </p>
          <button className="btn btn--primary btn--block" onClick={onExport}>
            ⬇ Download .ics
          </button>
        </section>
      </div>
    </AppShell>
  );
}