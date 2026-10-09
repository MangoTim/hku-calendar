// Leave — month / week / day calendar with MINE/TEAM/ALL scope + team filter + ICS export.
// Port of static leave/index.html.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { useHoliday } from '../contexts/HolidayContext';
import { Leave } from '../lib/leave';
import { localISO } from '../lib/app';
import { Bookings } from '../lib/bookings';
import { USERS } from '../lib/data';
import { fmt, escapeHtml, todayISO } from '../lib/app';
import type { Leave as LeaveRec } from '../lib/types';

type View = 'day' | 'week' | 'month';
type Scope = 'MINE' | 'TEAM' | 'ALL';

const VIEW_KEY = 'engg_intranet_pref_view_leave';

function getPrefView(): View | null {
  const v = localStorage.getItem(VIEW_KEY);
  return v === 'day' || v === 'week' || v === 'month' ? v : null;
}

export function LeavePage() {
  const { user, ROLE } = useAuth();
  const [params, setParams] = useSearchParams();

  const initialView = (params.get('view') as View) || getPrefView() || 'month';
  const initialDate = params.get('date') || todayISO();
  const initialScope = (params.get('scope') as Scope) || (ROLE.isUpper() ? 'TEAM' : 'MINE');
  const initialTeam = params.get('team') || (ROLE.isUpper() ? 'ALL' : user!.team);

  const [view, setView] = useState<View>(initialView);
  const [anchor, setAnchor] = useState<string>(initialDate);
  const [scope, setScope] = useState<Scope>(initialScope);
  const [team, setTeam] = useState<string>(initialTeam);
  const [defaultView, setDefaultView] = useState<View | null>(getPrefView());
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setParams({ view, date: anchor, scope, team }, { replace: true });
  }, [view, anchor, scope, team, setParams]);

  const allTeams = useMemo(
    () => [...new Set(USERS.map(u => u.team))].sort(),
    []
  );

  const visible = useMemo(() => {
    return Leave.all().filter(l => {
      if (l.status === 'CANCELLED') return false;
      const u = USERS.find(x => x.id === l.userId);
      if (!u) return false;
      if (scope === 'MINE') return l.userId === user!.id;
      if (scope === 'TEAM') return team === 'ALL' ? true : u.team === team;
      return true; // ALL
    });
  }, [scope, team, user]);

  const leaveOnDay = (iso: string) =>
    visible.filter(l => iso >= l.startDate && iso <= l.endDate);

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
    const scopeLabel = scope === 'MINE'
      ? 'mine'
      : team === 'ALL' ? 'all-teams' : team.replace(/\s+/g, '_');
    Leave.downloadIcs(visible, `hku-ENGG-leave-${scopeLabel}.ics`);
  };

  const activeTotal = Leave.all().filter(l => l.status !== 'CANCELLED').length;

  return (
    <AppShell title="Leave">
      <div className="page-header">
        <div>
          <h1>Leave</h1>
          <div className="page-header__sub">
            Team availability · all-day ICS export · {activeTotal} active record{activeTotal === 1 ? '' : 's'}
          </div>
        </div>
        <div className="page-header__actions">
          <button className="btn" onClick={exportIcs}>⬇ Export ICS</button>
          <Link className="btn btn--primary" to="/leave/new">+ New leave</Link>
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
        <span className="text-muted text-sm">Scope</span>
        <select
          className="form__select"
          style={{ width: 'auto' }}
          value={scope}
          onChange={e => setScope(e.target.value as Scope)}
        >
          <option value="MINE">My leave</option>
          <option value="TEAM">My team</option>
          {ROLE.isUpper() && <option value="ALL">All teams</option>}
        </select>
        {scope === 'TEAM' && (
          <>
            <span className="text-muted text-sm">· Team</span>
            <select
              className="form__select"
              style={{ width: 'auto', display: 'inline-block' }}
              value={team}
              onChange={e => setTeam(e.target.value)}
            >
              {ROLE.isUpper() && <option value="ALL">All teams</option>}
              {allTeams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </>
        )}
        <div className="toolbar__sep"></div>
        <span className="text-muted text-sm">{rangeLabel()}</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {view === 'month' && <MonthGrid anchor={anchor} leaveOnDay={leaveOnDay} />}
        {view === 'week' && <WeekGrid anchor={anchor} leaveOnDay={leaveOnDay} />}
        {view === 'day' && <DayGrid anchor={anchor} leaveOnDay={leaveOnDay} />}
      </div>

      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Legend</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          {Leave.typesAll().map(t => (
            <span key={t.code}>
              <span
                className={`chip chip--leave-${t.color}`}
                style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}
              >
                {t.label}
              </span>
            </span>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

// ---------------- Month view ----------------
function MonthGrid({ anchor, leaveOnDay }: {
  anchor: string;
  leaveOnDay: (iso: string) => LeaveRec[];
}) {
  const { holidayName } = useHoliday();
  const d = new Date(anchor + 'T00:00:00');
  const { cells } = Leave.buildMonthGrid(d);
  const month = d.getMonth();
  const head = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const rows: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <table className="cal">
      <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((day, j) => {
              if (!day) return <td key={j}></td>;
              const iso = localISO(day);
              const isMuted = day.getMonth() !== month;
              const isToday = iso === todayISO();
              const hname = holidayName(iso);
              const dayLeaves = leaveOnDay(iso);
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
                  {dayLeaves.slice(0, 3).map(l => <LeaveChip key={l.id} l={l} />)}
                  {dayLeaves.length > 3 && (
                    <div className="text-muted text-sm">+{dayLeaves.length - 3} more</div>
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
function WeekGrid({ anchor, leaveOnDay }: {
  anchor: string;
  leaveOnDay: (iso: string) => LeaveRec[];
}) {
  const { holidayName } = useHoliday();
  const d = new Date(anchor + 'T00:00:00');
  const { cells } = Leave.buildWeekGrid(d);

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
            const dayLeaves = leaveOnDay(iso).sort((a, b) => a.userId - b.userId);
            const cls = [isToday ? 'is-today' : '', hname ? 'is-holiday' : ''].filter(Boolean).join(' ');
            return (
              <td key={j} className={cls}>
                <div className="day-num">{day.getDate()}</div>
                {dayLeaves.length > 0
                  ? dayLeaves.map(l => <LeaveChip key={l.id} l={l} />)
                  : hname
                    ? <div className="text-muted text-sm">Holiday: {hname}</div>
                    : <div className="text-muted text-sm">—</div>}
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

// ---------------- Day view ----------------
function DayGrid({ anchor, leaveOnDay }: {
  anchor: string;
  leaveOnDay: (iso: string) => LeaveRec[];
}) {
  const { holidayName } = useHoliday();
  const d = new Date(anchor + 'T00:00:00');
  const iso = localISO(d);
  const isToday = iso === todayISO();
  const hname = holidayName(iso);
  const dayLeaves = leaveOnDay(iso);

  return (
    <>
      <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border)' }}>
        <strong>{fmt.dateLong(iso)}</strong>
        {hname && <> <span className="badge badge--warning">Holiday: {hname}</span></>}
        {isToday && <> <span className="badge badge--primary">Today</span></>}
        <span className="right text-muted text-sm" style={{ float: 'right' }}>
          {dayLeaves.length} on leave
        </span>
      </div>
      <div style={{ padding: 'var(--space-4)' }}>
        {dayLeaves.length === 0 ? (
          <p className="text-muted">No leave on this day.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Person</th><th>Team</th><th>Type</th><th>Span</th><th>Note</th></tr>
            </thead>
            <tbody>
              {dayLeaves.map(l => {
                const u = USERS.find(x => x.id === l.userId);
                const meta = Leave.typeMeta(l.type);
                return (
                  <tr key={l.id}>
                    <td><Link to={`/leave/${l.id}`}>{u?.displayName || '—'}</Link></td>
                    <td>{u?.team || ''}</td>
                    <td>
                      <span
                        className={`chip chip--leave-${meta.color}`}
                        style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="text-sm text-muted">
                      {fmt.dateLong(l.startDate)} – {fmt.dateLong(l.endDate)}
                    </td>
                    <td>{escapeHtml(l.note || '')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ---------------- Shared chip ----------------
function LeaveChip({ l }: { l: LeaveRec }) {
  const u = USERS.find(x => x.id === l.userId);
  const meta = Leave.typeMeta(l.type);
  return (
    <Link
      to={`/leave/${l.id}`}
      className={`chip chip--leave-${meta.color}`}
      title={l.note || meta.label}
    >
      {u?.displayName || '—'}
    </Link>
  );
}