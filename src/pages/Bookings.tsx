// Bookings — month / week / day calendar with team filter and ICS export.
// Port of static bookings/index.html.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { Bookings, localISO } from '../lib/bookings';
import { ROOMS, USERS, holidayName } from '../lib/data';
import { fmt, escapeHtml, todayISO } from '../lib/app';
import type { Booking } from '../lib/types';

type View = 'day' | 'week' | 'month';
const VIEW_KEY = 'engg_intranet_pref_view_calendar';

function getPrefView(): View | null {
  const v = localStorage.getItem(VIEW_KEY);
  return v === 'day' || v === 'week' || v === 'month' ? v : null;
}

export function BookingsPage() {
  const { user, ROLE } = useAuth();
  const [params, setParams] = useSearchParams();

  const initialView = (params.get('view') as View) || getPrefView() || 'month';
  const initialDate = params.get('date') || todayISO();
  const initialTeam = params.get('team') || (ROLE.isUpper() ? 'ALL' : user!.team);

  const [view, setView] = useState<View>(initialView);
  const [anchor, setAnchor] = useState<string>(initialDate);
  const [team, setTeam] = useState<string>(initialTeam);
  const [defaultView, setDefaultView] = useState<View | null>(getPrefView());
  const [savedFlash, setSavedFlash] = useState(false);

  // Sync URL whenever state changes
  useEffect(() => {
    setParams({ view, date: anchor, team }, { replace: true });
  }, [view, anchor, team, setParams]);

  const allTeams = useMemo(
    () => [...new Set(USERS.map(u => u.team))].sort(),
    []
  );

  // Active list filtered by team + status
  const visible = useMemo(() => {
    const all = Bookings.all();
    return all.filter(b => {
      if (b.status === 'CANCELLED') return false;
      if (team !== 'ALL') {
        const booker = USERS.find(u => u.id === b.bookedById);
        if (!booker || booker.team !== team) return false;
      }
      return true;
    });
  }, [team]);

  const bookingsOnDay = (iso: string) =>
    visible.filter(b => b.date === iso)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const shift = (delta: number) => {
    const d = new Date(anchor + 'T00:00:00');
    if (view === 'day')   d.setDate(d.getDate() + delta);
    if (view === 'week')  d.setDate(d.getDate() + 7 * delta);
    if (view === 'month') d.setMonth(d.getMonth() + delta);
    setAnchor(localISO(d));
  };

  const rangeLabel = () => {
    const d = new Date(anchor + 'T00:00:00');
    if (view === 'day') return fmt.dateLong(localISO(d));
    if (view === 'week') {
      const g = Bookings.buildWeekGrid(d);
      return `${fmt.dateLong(localISO(g.cells[0]))} – ${fmt.dateLong(localISO(g.cells[6]))}`;
    }
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  };

  const onSetDefault = () => {
    localStorage.setItem(VIEW_KEY, view);
    setDefaultView(view);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const exportIcs = () => {
    Bookings.downloadIcs(
      visible,
      `hku-ENGG-bookings-${team === 'ALL' ? 'all' : team.replace(/\s+/g, '_')}.ics`
    );
  };

  return (
    <AppShell title="Bookings">
      <div className="page-header">
        <div>
          <h1>Bookings</h1>
          <div className="page-header__sub">Conference rooms · FCFS · ICS export</div>
        </div>
        <div className="page-header__actions">
          <button className="btn" onClick={exportIcs}>⬇ Export ICS</button>
          <Link className="btn btn--primary" to="/bookings/new">+ New booking</Link>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist">
          {(['day','week','month'] as View[]).map(v => (
            <button
              key={v}
              type="button"
              className={`btn ${view === v ? 'is-active' : ''}`}
              onClick={() => setView(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <button
          className="btn btn--sm"
          onClick={onSetDefault}
          disabled={savedFlash}
          title="Save current view as my default"
        >
          {savedFlash ? '✓ Saved' : defaultView === view ? '⭐ My default' : '⭐ Set as default'}
        </button>
        <div className="btn-row">
          <button className="btn" onClick={() => shift(-1)}>← Prev</button>
          <button className="btn" onClick={() => setAnchor(todayISO())}>Today</button>
          <button className="btn" onClick={() => shift(+1)}>Next →</button>
        </div>
        <div className="toolbar__sep"></div>
        <span className="text-muted text-sm">Team</span>
        <select
          className="form__select"
          style={{ width: 'auto' }}
          value={team}
          onChange={e => setTeam(e.target.value)}
        >
          {ROLE.isUpper() && <option value="ALL">All teams</option>}
          {allTeams.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <div className="toolbar__sep"></div>
        <span className="text-muted text-sm">{rangeLabel()}</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {view === 'month' && <MonthGrid anchor={anchor} bookingsOnDay={bookingsOnDay} />}
        {view === 'week' && <WeekGrid anchor={anchor} bookingsOnDay={bookingsOnDay} />}
        {view === 'day' && <DayGrid anchor={anchor} bookingsOnDay={bookingsOnDay} />}
      </div>
    </AppShell>
  );
}

// ---------------- Month view ----------------
function MonthGrid({ anchor, bookingsOnDay }: {
  anchor: string;
  bookingsOnDay: (iso: string) => Booking[];
}) {
  const d = new Date(anchor + 'T00:00:00');
  const { cells } = Bookings.buildMonthGrid(d);
  const month = d.getMonth();
  const head = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  // Group cells into 7-day rows
  const rows: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <table className="cal">
      <thead>
        <tr>{head.map(h => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((day, j) => {
              if (!day) return <td key={j}></td>;
              const iso = localISO(day);
              const isMuted = day.getMonth() !== month;
              const isToday = iso === todayISO();
              const hname = holidayName(iso);
              const dayBookings = bookingsOnDay(iso);
              const cls = [
                isMuted ? 'is-muted' : '',
                isToday ? 'is-today' : '',
                hname ? 'is-holiday' : ''
              ].filter(Boolean).join(' ');
              return (
                <td key={j} className={cls}>
                  <div className={`day-num ${isMuted ? 'is-muted' : ''}`}>{day.getDate()}</div>
                  {hname && (
                    <div className="text-muted text-sm" style={{ marginTop: 2 }}>
                      Holiday: {hname}
                    </div>
                  )}
                  {dayBookings.slice(0, 3).map(b => <BookingChip key={b.id} b={b} />)}
                  {dayBookings.length > 3 && (
                    <div className="text-muted text-sm">+{dayBookings.length - 3} more</div>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------- Week view ----------------
function WeekGrid({ anchor, bookingsOnDay }: {
  anchor: string;
  bookingsOnDay: (iso: string) => Booking[];
}) {
  const d = new Date(anchor + 'T00:00:00');
  const { cells } = Bookings.buildWeekGrid(d);

  return (
    <table className="cal">
      <thead>
        <tr>
          {cells.map((c, i) => {
            const iso = localISO(c);
            const hname = holidayName(iso);
            return (
              <th key={i}>
                {c.toLocaleDateString('en-GB', { weekday: 'short' })}
                <br />
                <span className="text-muted">{c.getDate()}</span>
                {hname && (
                  <>
                    <br />
                    <span className="badge badge--warning" style={{ fontSize: 9 }}>
                      {hname}
                    </span>
                  </>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        <tr>
          {cells.map((day, j) => {
            const iso = localISO(day);
            const isToday = iso === todayISO();
            const hname = holidayName(iso);
            const dayBookings = bookingsOnDay(iso);
            const cls = [isToday ? 'is-today' : '', hname ? 'is-holiday' : ''].filter(Boolean).join(' ');
            return (
              <td key={j} className={cls}>
                <div className="day-num">{day.getDate()}</div>
                {dayBookings.length > 0
                  ? dayBookings.map(b => <BookingChip key={b.id} b={b} />)
                  : hname && <div className="text-muted text-sm">Holiday: {hname}</div>}
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

// ---------------- Day view ----------------
function DayGrid({ anchor, bookingsOnDay }: {
  anchor: string;
  bookingsOnDay: (iso: string) => Booking[];
}) {
  const d = new Date(anchor + 'T00:00:00');
  const iso = localISO(d);
  const isToday = iso === todayISO();
  const hname = holidayName(iso);
  const dayBookings = bookingsOnDay(iso);
  const hours = Array.from({ length: 11 }, (_, i) => 8 + i); // 08:00 - 18:00

  return (
    <>
      <div style={{
        padding: 'var(--space-4)',
        borderBottom: '1px solid var(--border)'
      }}>
        <strong>{fmt.dateLong(iso)}</strong>
        {hname && <> <span className="badge badge--warning">Holiday: {hname}</span></>}
        {isToday && <> <span className="badge badge--primary">Today</span></>}
        <span className="right text-muted text-sm" style={{ float: 'right' }}>
          {dayBookings.length} booking{dayBookings.length === 1 ? '' : 's'}
        </span>
      </div>
      <table className="cal">
        <tbody>
          {hours.map(h => {
            const hh = String(h).padStart(2, '0') + ':00';
            const slot = dayBookings.filter(b => b.startTime <= hh && b.endTime > hh);
            return (
              <tr key={h}>
                <td style={{ width: 80, textAlign: 'right', padding: 8 }} className="text-muted">
                  {hh}
                </td>
                <td style={{ padding: 8 }}>
                  {slot.map(b => {
                    const room = ROOMS.find(r => r.id === b.roomId);
                    return (
                      <Link
                        key={b.id}
                        to={`/bookings/${b.id}`}
                        className={`chip ${b.itSupport ? 'chip--it' : ''}`}
                        style={{ display: 'block', marginBottom: 4 }}
                      >
                        <strong>{b.startTime}–{b.endTime}</strong> · {room?.name || '—'}
                        <div className="text-muted">{escapeHtml(b.purpose)}</div>
                      </Link>
                    );
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// ---------------- Shared chip ----------------
function BookingChip({ b }: { b: Booking }) {
  const room = ROOMS.find(r => r.id === b.roomId);
  const cls = `chip${b.itSupport ? ' chip--it' : ''}`;
  return (
    <Link
      to={`/bookings/${b.id}`}
      className={cls}
      title={b.purpose}
    >
      {b.startTime}–{b.endTime} · {room?.name || '—'}
    </Link>
  );
}