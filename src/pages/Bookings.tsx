// Bookings — month / week / day calendar with team filter and ICS export.
// Port of static bookings/index.html.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { useUsers } from '../contexts/UsersContext';
import { useHoliday } from '../contexts/HolidayContext';
import { Bookings, localISO } from '../lib/bookings';
import { Rooms } from '../lib/rooms';
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
  const { users } = useUsers();
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
    () => [...new Set(users.map(u => u.team))].sort(),
    [users]
  );

  // Active list filtered by team + status
  const visible = useMemo(() => {
    const all = Bookings.all();
    return all.filter(b => {
      if (b.status === 'CANCELLED') return false;
      if (team !== 'ALL') {
        const booker = users.find(u => u.id === b.bookedById);
        if (!booker || booker.team !== team) return false;
      }
      return true;
    });
  }, [team, users]);

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
        {view === 'month' && <MonthGrid anchor={anchor} bookingsOnDay={bookingsOnDay} currentUserId={user!.id} />}
        {view === 'week' && <WeekGrid anchor={anchor} bookingsOnDay={bookingsOnDay} currentUserId={user!.id} />}
        {view === 'day' && <DayGrid anchor={anchor} bookingsOnDay={bookingsOnDay} currentUserId={user!.id} />}
      </div>
    </AppShell>
  );
}

// ---------------- Month view ----------------
function MonthGrid({ anchor, bookingsOnDay, currentUserId }: {
  anchor: string;
  bookingsOnDay: (iso: string) => Booking[];
  currentUserId: number;
}) {
  const { holidayName } = useHoliday();
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
                  {dayBookings.slice(0, 3).map(b => <BookingChip key={b.id} b={b} currentUserId={currentUserId} />)}
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
function WeekGrid({ anchor, bookingsOnDay, currentUserId }: {
  anchor: string;
  bookingsOnDay: (iso: string) => Booking[];
  currentUserId: number;
}) {
  const { holidayName } = useHoliday();
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
                  ? dayBookings.map(b => <BookingChip key={b.id} b={b} currentUserId={currentUserId} />)
                  : hname && <div className="text-muted text-sm">Holiday: {hname}</div>}
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

// ---------------- Day view (timetable grid) ----------------
// 30-min slots from 08:00 → 18:30 (22 rows). Rooms are columns; chunks of
// up to 3 rooms per chunk (so 3 rooms = 1 row, 6 rooms = 2 rows of 3).
// "(add)" cells open the quick-create modal; booking blocks are grid-row
// spans that overlay their covered slots. Bookings that start before
// 08:00 or end after 18:30 are clamped to the visible range.
const DAY_START_MIN = 8 * 60;       // 08:00
const DAY_END_MIN   = 19 * 60 - 30; // last slot STARTS at 18:30
const SLOT_MIN      = 30;

function slotLabel(min: number): string {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' +
         String(min % 60).padStart(2, '0');
}

function DayGrid({ anchor, bookingsOnDay, currentUserId }: {
  anchor: string;
  bookingsOnDay: (iso: string) => Booking[];
  currentUserId: number;
}) {
  const { holidayName } = useHoliday();
  const { findById } = useUsers();

  const d = new Date(anchor + 'T00:00:00');
  const iso = localISO(d);
  const isToday = iso === todayISO();
  const hname = holidayName(iso);
  const dayBookings = bookingsOnDay(iso);

  // 30-min slot list
  const slots: string[] = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += SLOT_MIN) slots.push(slotLabel(m));

  const activeRooms = Rooms.active();

  // Chunk rooms into groups of 3 (per the HKU intranet screenshot).
  const chunks: typeof activeRooms[] = [];
  for (let i = 0; i < activeRooms.length; i += 3) {
    chunks.push(activeRooms.slice(i, i + 3));
  }

  // Quick-create modal state — null = closed.
  const [modal, setModal] = useState<
    { roomId: number; date: string; startTime: string } | null
  >(null);

  return (
    <>
      <div className="day-header">
        <strong>{fmt.dateLong(iso)}</strong>
        {hname && <span className="badge badge--warning">Holiday: {hname}</span>}
        {isToday && <span className="badge badge--primary">Today</span>}
        <span className="right text-muted text-sm">
          {dayBookings.length} booking{dayBookings.length === 1 ? '' : 's'}
        </span>
      </div>

      {chunks.map((chunk, ci) => (
        <div
          key={ci}
          className="day-grid"
          style={{ ['--day-rooms' as never]: chunk.length } as React.CSSProperties}
        >
          {/* header row (row 1) */}
          <div className="day-grid__corner" aria-hidden="true"
               style={{ gridColumn: 1, gridRow: 1 }}></div>
          {chunk.map((r, j) => (
            <div key={r.id} className="day-grid__room"
                 style={{ gridColumn: j + 2, gridRow: 1 }}>{r.name}</div>
          ))}

          {/* Time + (add) cells. Every cell gets an EXPLICIT grid position —
              booking blocks below occupy the same cells, and CSS grid
              sparse auto-placement would shift everything after the first
              collision. */}
          {slots.map((slot, i) => (
            <Fragment key={slot}>
              <div className="day-grid__time"
                   style={{ gridColumn: 1, gridRow: i + 2 }}>{slot}</div>
              {chunk.map((r, j) => {
                const cell = {
                  gridColumn: j + 2,
                  gridRow: i + 2,
                } as React.CSSProperties;
                // Don't show (add) if a booking already covers this slot.
                const covered = dayBookings.some(b => {
                  if (b.roomId !== r.id) return false;
                  return b.startTime <= slot && b.endTime > slot;
                });
                if (covered) {
                  return <div key={r.id} className="day-grid__add" aria-hidden="true"
                              style={cell}></div>;
                }
                return (
                  <button
                    key={r.id}
                    type="button"
                    className="day-grid__add"
                    style={cell}
                    onClick={() =>
                      setModal({ roomId: r.id, date: iso, startTime: slot })
                    }
                    // prevent the button stealing focus before the modal opens
                    onMouseDown={e => e.preventDefault()}
                    title={`Book ${r.name} at ${slot}`}
                  >
                    (add)
                  </button>
                );
              })}
            </Fragment>
          ))}

          {/* booking blocks overlaid on the same grid */}
          {dayBookings
            .filter(b => chunk.some(r => r.id === b.roomId))
            .map(b => {
              const rIdx = chunk.findIndex(r => r.id === b.roomId);
              const [sh, sm] = b.startTime.split(':').map(Number);
              const [eh, em] = b.endTime.split(':').map(Number);
              const startMin = sh * 60 + sm;
              const endMin   = eh * 60 + em;

              // Clamp bookings that fall outside the visible window.
              const visStart = Math.max(startMin, DAY_START_MIN);
              const visEnd   = Math.min(endMin,   DAY_END_MIN + SLOT_MIN);
              if (visEnd <= visStart) return null;

              // Row 1 = header row; rows 2+ = slots. startMin == 08:00 → row 2.
              const startRow = Math.floor((visStart - DAY_START_MIN) / SLOT_MIN) + 2;
              const endRow   = Math.floor((visEnd   - DAY_START_MIN) / SLOT_MIN) + 2;

              const booker = findById(b.bookedById);
              const isMine = b.bookedById === currentUserId;
              const cls = `day-grid__booking${isMine ? ' day-grid__booking--mine' : ''}`;
              return (
                <Link
                  key={b.id}
                  to={`/bookings/${b.id}`}
                  className={cls}
                  style={{
                    gridColumn: rIdx + 2, // +1 (1-indexed) +1 (skip time col)
                    gridRow: `${startRow} / ${endRow}`,
                  }}
                  title={`${b.startTime}–${b.endTime} · ${escapeHtml(b.purpose)}`}
                >
                  <span className="day-grid__booking-title">
                    {b.purpose || '(no purpose)'}
                  </span>
                  <span className="day-grid__booking-sub">
                    {booker?.displayName || ''}
                    {b.startTime !== slotLabel(visStart) || b.endTime !== slotLabel(visEnd)
                      ? ` · ${b.startTime}–${b.endTime}`
                      : ''}
                  </span>
                </Link>
              );
            })}
        </div>
      ))}

      {modal && (
        <BookingQuickModal
          roomId={modal.roomId}
          date={modal.date}
          startTime={modal.startTime}
          bookerId={currentUserId}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

// ---------------- Quick-create modal (opened from "(add)" cell) ----------------
function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' +
         String(total % 60).padStart(2, '0');
}

function BookingQuickModal({
  roomId, date, startTime, bookerId, onClose,
}: {
  roomId: number;
  date: string;
  startTime: string;
  bookerId: number;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const [room, setRoom]     = useState<number>(roomId);
  const [d, setD]           = useState<string>(date);
  const [start, setStart]   = useState<string>(startTime);
  const [end, setEnd]       = useState<string>(addMinutes(startTime, 30));
  const [purpose, setPurpose] = useState<string>('');
  const [error, setError]   = useState<string | null>(null);

  // Keep "end" ≥ "start" when user edits the start time.
  const onStartChange = (v: string) => {
    setStart(v);
    if (v >= end) setEnd(addMinutes(v, 30));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!purpose.trim()) { setError('Subject is required.'); return; }
    if (start >= end)    { setError('End time must be after start time.'); return; }
    const created = Bookings.create({
      roomId: room,
      date: d,
      startTime: start,
      endTime: end,
      purpose: purpose.trim(),
      bookedById: bookerId,
      cupsOfTea: 0,
      warmWater: 0,
      coolWater: 0,
      iPads: 0,
      itSupport: false,
      supportRequests: '',
    });
    onClose();
    nav(`/bookings/${created.id}`);
  };

  const onBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const activeRooms = Rooms.active();

  return (
    <div className="modal-backdrop" onClick={onBackdrop} role="dialog" aria-modal="true">
      <div className="modal">
        <header className="modal__head">
          <h2>New booking</h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <form onSubmit={submit} className="modal__body">
          <label>
            Venue
            <select
              className="form__select"
              value={room}
              onChange={e => setRoom(Number(e.target.value))}
            >
              {activeRooms.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              className="form__input"
              value={d}
              onChange={e => setD(e.target.value)}
              required
            />
          </label>
          <div className="modal__row">
            <label>
              From
              <input
                type="time"
                className="form__input"
                value={start}
                step={1800}
                onChange={e => onStartChange(e.target.value)}
                required
              />
            </label>
            <label>
              To
              <input
                type="time"
                className="form__input"
                value={end}
                step={1800}
                min={start}
                onChange={e => setEnd(e.target.value)}
                required
              />
            </label>
          </div>
          <label>
            Subject
            <input
              type="text"
              className="form__input"
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              placeholder="e.g. Sprint planning"
              required
            />
          </label>
          {error && (
            <div className="alert alert--danger" role="alert">{error}</div>
          )}
          <footer className="modal__foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary">
              Book room
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

// ---------------- Shared chip ----------------
function BookingChip({ b, currentUserId }: { b: Booking; currentUserId: number }) {
  const room = Rooms.byId(b.roomId);
  const isMine = b.bookedById === currentUserId;
  const cls = `chip${b.itSupport ? ' chip--it' : ''}${isMine ? ' chip--mine' : ''}`;
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