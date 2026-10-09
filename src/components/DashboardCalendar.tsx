// DashboardCalendar — unified month-view summary of bookings, leave, and task
// deadlines for the Dashboard. Reuses the .cal table styles + Booking/Leave chip
// variants from Bookings.tsx / Leave.tsx, plus a new .chip--task family for
// task deadlines. Two scopes:
//   - "All Teams"  → every booking / leave / task (whole-org, like before)
//   - "My Calendar" → only items the signed-in user owns (bookedById / userId /
//                     assigneeId). Useful on phones where the org-wide list
//                     is too noisy.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookings, localISO } from '../lib/bookings';
import { Leave } from '../lib/leave';
import { Tasks } from '../lib/tasks';
import { ROOMS, USERS } from '../lib/data';
import { todayISO, escapeHtml } from '../lib/app';
import { useAuth } from '../contexts/AuthContext';
import { useHoliday } from '../contexts/HolidayContext';
import type { Booking, Leave as LeaveRecord, Task as TaskRecord } from '../lib/types';

interface DayEntry {
  bookings: Booking[];
  leave: LeaveRecord[];
  tasks: TaskRecord[];
}

type Scope = 'all' | 'my';
const HEAD: ReadonlyArray<string> = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function DashboardCalendar() {
  const { session } = useAuth();
  const { holidayName } = useHoliday();
  const today = todayISO();
  const [anchor, setAnchor] = useState<string>(today);
  const [scope, setScope] = useState<Scope>('all');
  const myUserId = session?.userId ?? -1;

  const shift = (delta: number) => {
    const d = new Date(anchor + 'T00:00:00');
    d.setMonth(d.getMonth() + delta);
    setAnchor(localISO(d));
  };

  // Bucket every entry by ISO date. Leave spans are expanded across days so a
  // multi-day leave entry shows on every day in its range. Tasks show only on
  // their dueDate (and only if not already DONE). When scope === 'my' we also
  // filter each source down to the items the signed-in user owns.
  const byDate = useMemo<Record<string, DayEntry>>(() => {
    const out: Record<string, DayEntry> = {};
    const bump = (iso: string, source: keyof DayEntry, item: any) => {
      const slot = (out[iso] ??= { bookings: [], leave: [], tasks: [] });
      (slot[source] as any[]).push(item);
    };

    for (const b of Bookings.all()) {
      if (b.status === 'CANCELLED' || !b.date) continue;
      if (scope === 'my' && b.bookedById !== myUserId) continue;
      bump(b.date, 'bookings', b);
    }
    for (const l of Leave.all()) {
      if (l.status === 'CANCELLED' || !l.startDate || !l.endDate) continue;
      if (scope === 'my' && l.userId !== myUserId) continue;
      const start = new Date(l.startDate + 'T00:00:00');
      const end = new Date(l.endDate + 'T00:00:00');
      const cursor = new Date(start);
      // Defensive cap — a 365-day leave should not freeze the page
      let days = 0;
      while (cursor <= end && days < 400) {
        bump(localISO(cursor), 'leave', l);
        cursor.setDate(cursor.getDate() + 1);
        days++;
      }
    }
    for (const t of Tasks.all()) {
      if (t.status === 'DONE' || !t.dueDate) continue;
      if (scope === 'my' && t.assigneeId !== myUserId) continue;
      bump(t.dueDate, 'tasks', t);
    }
    return out;
  }, [scope, myUserId]);

  const d = new Date(anchor + 'T00:00:00');
  const { cells } = Bookings.buildMonthGrid(d);
  const month = d.getMonth();
  const shiftLabel = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Pre-compute cell rows so we can map 7 cells at a time.
  const rows: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  // Open the Bookings page anchored to the same month-view + date.
  const openFullHref = `/bookings?view=month&date=${anchor}`;

  // Per-day counts across the visible grid (for the legend line)
  let visibleBookings = 0;
  let visibleLeave = 0;
  let visibleTasks = 0;
  for (const day of cells) {
    if (!day || day.getMonth() !== month) continue;
    const entry = byDate[localISO(day)];
    if (!entry) continue;
    visibleBookings += entry.bookings.length;
    visibleLeave += entry.leave.length;
    visibleTasks += entry.tasks.length;
  }

  return (
    <section
      className="card"
      style={{ marginTop: 'var(--space-4)', padding: 0 }}
      aria-labelledby="dashCalTitle"
    >
      <div
        className="card__head"
        style={{ padding: 'var(--space-3) var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}
      >
        <div>
          <div className="card__title" id="dashCalTitle">Schedule overview</div>
          <div className="card__sub">
            {shiftLabel} ·{' '}
            <span className="text-muted">
              {visibleBookings} booking{visibleBookings === 1 ? '' : 's'} ·
              {' '}{visibleLeave} leave day{visibleLeave === 1 ? '' : 's'} ·
              {' '}{visibleTasks} task due{visibleTasks === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div
          className="segmented"
          role="tablist"
          aria-label="Calendar scope"
          style={{ marginLeft: 'auto' }}
        >
          <button
            className={`segmented__btn ${scope === 'my' ? 'is-on' : ''}`}
            onClick={() => setScope('my')}
            role="tab"
            aria-selected={scope === 'my'}
            title="Only show my bookings, leave, and task deadlines"
          >
            My Calendar
          </button>
          <button
            className={`segmented__btn ${scope === 'all' ? 'is-on' : ''}`}
            onClick={() => setScope('all')}
            role="tab"
            aria-selected={scope === 'all'}
            title="Show every team's bookings, leave, and task deadlines"
          >
            All Teams
          </button>
        </div>
        <div className="btn-row">
          <button className="btn btn--sm" onClick={() => shift(-1)} aria-label="Previous month">← Prev</button>
          <button className="btn btn--sm" onClick={() => setAnchor(today)}>Today</button>
          <button className="btn btn--sm" onClick={() => shift(+1)} aria-label="Next month">Next →</button>
          <Link className="btn btn--ghost btn--sm" to={openFullHref}>Open calendar →</Link>
        </div>
      </div>

      <div className="dash-cal-legend" aria-hidden="true">
        <span className="legend-dot legend-dot--booking" /> Booking
        <span className="legend-dot legend-dot--leave" /> Leave
        <span className="legend-dot legend-dot--task" /> Task deadline
      </div>

      <div className="table-wrap">
        <table
          className="cal dash-cal"
          aria-label={`Schedule overview for ${shiftLabel}`}
          style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
        >
          <thead>
            <tr>{HEAD.map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((day, j) => {
                  if (!day) return <td key={j} />;
                  const iso = localISO(day);
                  const isMuted = day.getMonth() !== month;
                  const isToday = iso === today;
                  const hname = holidayName(iso);
                  const entry = byDate[iso] ?? { bookings: [], leave: [], tasks: [] };
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
                          {hname}
                        </div>
                      )}
                      {entry.bookings.map(b => (
                        <DashBookingChip key={`b${b.id}`} b={b} />
                      ))}
                      {entry.leave.map(l => (
                        <DashLeaveChip key={`l${l.id}-${iso}`} l={l} />
                      ))}
                      {entry.tasks.map(t => (
                        <DashTaskChip key={`t${t.id}`} t={t} />
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------- Chip variants ----------------
// Summary cards use ONE color per source (blue=booking, red=leave, green=task)
// via `.cal.dash-cal .chip.chip--src-*` so the legend reads at a glance.
// The per-type colors (IT-support, leave-type, task-priority) live on the
// Bookings / Leave / Tasks detail pages — those `.cal` tables are NOT
// `.dash-cal`, so this summary view never competes with them.

function DashBookingChip({ b }: { b: Booking }) {
  const room = ROOMS.find(r => r.id === b.roomId);
  return (
    <Link to={`/bookings/${b.id}`} className="chip chip--src-booking" title={`${b.purpose} · ${room?.name || ''}`}>
      <strong className="chip__time">{b.startTime}</strong>
      <span className="chip__name">{room?.name || 'Room'}</span>
    </Link>
  );
}

function DashLeaveChip({ l }: { l: LeaveRecord }) {
  const u = USERS.find(x => x.id === l.userId);
  const name = u?.displayName || '—';
  const typeLabel = l.type.charAt(0) + l.type.slice(1).toLowerCase().replace('_', ' ');
  return (
    <Link
      to={`/leave/${l.id}`}
      className="chip chip--src-leave"
      title={`${u?.displayName || '—'} · ${typeLabel}${l.note ? ` · ${l.note}` : ''}`}
    >
      <strong className="chip__time" aria-hidden="true">🏖</strong>
      <span className="chip__name">{escapeHtml(name)} · {escapeHtml(typeLabel)}</span>
    </Link>
  );
}

function DashTaskChip({ t }: { t: TaskRecord }) {
  return (
    <Link
      to={`/tasks/${t.id}`}
      className="chip chip--src-task"
      title={`${t.title} · ${t.priority} · ${t.progressPercent}%`}
    >
      <strong className="chip__time" aria-hidden="true">✓</strong>
      <span className="chip__name">{escapeHtml(t.title)}</span>
    </Link>
  );
}
