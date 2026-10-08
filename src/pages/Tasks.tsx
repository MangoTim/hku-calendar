// Tasks list — scope / status / priority / team filters + List | Cards view.
// URL state + per-user "⭐ Set as default" preference persisted to localStorage.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { Tasks } from '../lib/tasks';
import { USERS } from '../lib/data';
import { fmt, escapeHtml, todayISO } from '../lib/app';
import type { Task as TaskRec, TaskStatus, TaskPriority } from '../lib/types';

type Scope = 'MINE' | 'TEAM' | 'ALL';
type View = 'list' | 'cards';

const PREF_KEY = 'engg_intranet_pref_task_filters';
const VIEW_KEY = 'engg_intranet_pref_view_tasks';

interface Filters {
  scope: Scope;
  status: TaskStatus | 'ALL';
  priority: TaskPriority | 'ALL';
  team: string;
  assigneeId: number | null;
  view: View;
}

function loadDefaults(): Partial<Filters> {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
}

export function TasksPage() {
  const { user, ROLE } = useAuth();
  const [params, setParams] = useSearchParams();
  const saved = useMemo(loadDefaults, []);

  const initial: Filters = {
    scope:    (params.get('scope') as Scope) || saved.scope    || (ROLE.isUpper() ? 'TEAM' : 'MINE'),
    status:   (params.get('status') as TaskStatus | 'ALL') || saved.status    || 'OPEN',
    priority: (params.get('priority') as TaskPriority | 'ALL') || saved.priority || 'ALL',
    team:     params.get('team') || saved.team || (ROLE.isUpper() ? 'ALL' : user!.team),
    assigneeId: params.get('assigneeId') ? Number(params.get('assigneeId')) : (saved.assigneeId ?? null),
    view:     (params.get('view') as View) || saved.view || 'list'
  };

  const [filters, setFilters] = useState<Filters>(initial);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    const next: Record<string, string> = {
      scope: filters.scope,
      status: filters.status,
      priority: filters.priority,
      team: filters.team,
      view: filters.view
    };
    if (filters.assigneeId) next.assigneeId = String(filters.assigneeId);
    setParams(next, { replace: true });
    // Persist view separately too (legacy key, kept for parity with static)
    localStorage.setItem(VIEW_KEY, filters.view);
  }, [filters, setParams]);

  const allTasks = Tasks.all();
  const filtered = useMemo(() => applyFilters(allTasks, filters, user!.id), [allTasks, filters, user]);
  const counts = useMemo(() => countByStatus(allTasks), [allTasks]);
  const dueSoonCount = useMemo(
    () => Tasks.dueSoon({ userId: filters.scope === 'MINE' ? user!.id : null }).length,
    [filters.scope, user]
  );

  const onSetDefault = () => {
    const def: Partial<Filters> = { ...filters };
    if (filters.assigneeId) def.assigneeId = filters.assigneeId;
    localStorage.setItem(PREF_KEY, JSON.stringify(def));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  const canAssign = ROLE.canAssignTasks();
  const allTeams = useMemo(() => [...new Set(USERS.map(u => u.team))].sort(), []);

  return (
    <AppShell title="Tasks">
      <div className="page-header">
        <div>
          <h1>Tasks</h1>
          <div className="page-header__sub">
            {allTasks.length} total · {counts.overdue} overdue · {dueSoonCount} due soon
          </div>
        </div>
        <div className="page-header__actions">
          {canAssign && <Link className="btn btn--primary" to="/tasks/new">+ Assign task</Link>}
        </div>
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist">
          <button
            type="button"
            className={`btn ${filters.view === 'list' ? 'is-active' : ''}`}
            onClick={() => setFilters({ ...filters, view: 'list' })}
          >
            ☰ List
          </button>
          <button
            type="button"
            className={`btn ${filters.view === 'cards' ? 'is-active' : ''}`}
            onClick={() => setFilters({ ...filters, view: 'cards' })}
          >
            ▦ Cards
          </button>
        </div>
        <div className="toolbar__sep"></div>

        <span className="text-muted text-sm">Scope</span>
        <select
          className="form__select"
          style={{ width: 'auto' }}
          value={filters.scope}
          onChange={e => setFilters({ ...filters, scope: e.target.value as Scope })}
        >
          <option value="MINE">My tasks</option>
          <option value="TEAM">My team</option>
          {ROLE.isUpper() && <option value="ALL">All teams</option>}
        </select>
        {filters.scope === 'TEAM' && (
          <select
            className="form__select"
            style={{ width: 'auto', display: 'inline-block' }}
            value={filters.team}
            onChange={e => setFilters({ ...filters, team: e.target.value })}
          >
            {ROLE.isUpper() && <option value="ALL">All teams</option>}
            {allTeams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}

        <span className="toolbar__sep"></span>

        <span className="text-muted text-sm">Status</span>
        <select
          className="form__select"
          style={{ width: 'auto' }}
          value={filters.status}
          onChange={e => setFilters({ ...filters, status: e.target.value as TaskStatus | 'ALL' })}
        >
          <option value="OPEN">Open ({counts.open})</option>
          <option value="IN_PROGRESS">In progress ({counts.inProgress})</option>
          <option value="DONE">Done ({counts.done})</option>
          <option value="ALL">All ({counts.all})</option>
        </select>

        <span className="text-muted text-sm">Priority</span>
        <select
          className="form__select"
          style={{ width: 'auto' }}
          value={filters.priority}
          onChange={e => setFilters({ ...filters, priority: e.target.value as TaskPriority | 'ALL' })}
        >
          <option value="ALL">Any</option>
          {Tasks.prioritiesAll().map(p => (
            <option key={p.code} value={p.code}>{p.label}</option>
          ))}
        </select>

        <button
          className="btn btn--sm"
          onClick={onSetDefault}
          disabled={savedFlash}
          title="Save the current scope, status, priority, team, and view as your default for next visit"
        >
          {savedFlash ? '✅ Saved' : '⭐ Set as default'}
        </button>
        <span className="toolbar__sep"></span>
        <Link className="btn btn--sm" to="/tasks/mine">My tasks</Link>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">No tasks match your filters.</div>
      ) : filters.view === 'cards' ? (
        <div className="dash-grid dash-grid--3">
          {filtered.map(t => <TaskCard key={t.id} t={t} />)}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table table--hover">
              <thead>
                <tr>
                  <th>Title</th><th>Assignee</th><th>Priority</th>
                  <th>Status</th><th>Progress</th><th>Due</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => <TaskRow key={t.id} t={t} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// ---------------- Filter / sort ----------------
function applyFilters(all: TaskRec[], f: Filters, myUserId: number): TaskRec[] {
  const list = all.filter(t => {
    if (f.status === 'OPEN'        && t.status !== 'OPEN') return false;
    if (f.status === 'IN_PROGRESS' && t.status !== 'IN_PROGRESS') return false;
    if (f.status === 'DONE'        && t.status !== 'DONE') return false;
    if (f.priority !== 'ALL' && t.priority !== f.priority) return false;
    if (f.scope === 'MINE' && t.assigneeId !== myUserId) return false;
    if (f.scope === 'TEAM') {
      const u = USERS.find(x => x.id === t.assigneeId);
      if (!u) return false;
      if (f.team !== 'ALL' && u.team !== f.team) return false;
    }
    if (f.assigneeId && t.assigneeId !== f.assigneeId) return false;
    return true;
  });
  return sortTasks(list);
}

function sortTasks(list: TaskRec[]): TaskRec[] {
  const today = todayISO();
  return [...list].sort((a, b) => {
    const ad = a.dueDate || '9999-99-99';
    const bd = b.dueDate || '9999-99-99';
    const aOver = a.status !== 'DONE' && ad < today;
    const bOver = b.status !== 'DONE' && bd < today;
    if (aOver !== bOver) return aOver ? -1 : 1;
    if (a.status === 'DONE' && b.status !== 'DONE') return 1;
    if (b.status === 'DONE' && a.status !== 'DONE') return -1;
    return ad.localeCompare(bd);
  });
}

function countByStatus(all: TaskRec[]) {
  const today = todayISO();
  return {
    all: all.length,
    open: all.filter(t => t.status === 'OPEN').length,
    inProgress: all.filter(t => t.status === 'IN_PROGRESS').length,
    done: all.filter(t => t.status === 'DONE').length,
    overdue: all.filter(t => t.status !== 'DONE' && t.dueDate && t.dueDate < today).length
  };
}

// ---------------- Row + Card ----------------
function TaskRow({ t }: { t: TaskRec }) {
  const u = USERS.find(x => x.id === t.assigneeId);
  const pm = Tasks.priorityMeta(t.priority);
  const sm = Tasks.statusMeta(t.status);
  const today = todayISO();
  const isOverdue = t.status !== 'DONE' && t.dueDate && t.dueDate < today;
  const dueTxt = t.dueDate ? fmt.dateLong(t.dueDate) : '—';
  return (
    <tr>
      <td>
        <Link to={`/tasks/${t.id}`}>{escapeHtml(t.title)}</Link>
        {isOverdue && <> <span className="badge badge--danger">overdue</span></>}
      </td>
      <td>
        {escapeHtml(u?.displayName || '—')}{' '}
        <span className="text-muted text-sm">({escapeHtml(u?.team || '')})</span>
      </td>
      <td><span className={`badge badge--${pm.color}`}>{pm.label}</span></td>
      <td><span className={`badge badge--${sm.color}`}>{sm.label}</span></td>
      <td>
        <div className="progress" style={{ width: 120 }}>
          <div
            className="progress__bar"
            style={{ width: `${t.progressPercent}%`, background: `var(--color-${sm.color})` }}
          />
        </div>
        <span className="text-muted text-sm">{t.progressPercent}%</span>
      </td>
      <td className={isOverdue ? 'text-danger' : ''}>{dueTxt}</td>
    </tr>
  );
}

function TaskCard({ t }: { t: TaskRec }) {
  const u = USERS.find(x => x.id === t.assigneeId);
  const pm = Tasks.priorityMeta(t.priority);
  const sm = Tasks.statusMeta(t.status);
  const today = todayISO();
  const isOverdue = t.status !== 'DONE' && t.dueDate && t.dueDate < today;
  return (
    <article className="card task-card">
      <header className="task-card__head">
        <Link className="task-card__title" to={`/tasks/${t.id}`}>{escapeHtml(t.title)}</Link>
        <span className={`badge badge--${pm.color}`}>{pm.label}</span>
      </header>
      <p className="task-card__desc text-muted">
        {escapeHtml((t.description || '').slice(0, 120))}
        {t.description && t.description.length > 120 ? '…' : ''}
      </p>
      <div className="progress" style={{ margin: 'var(--space-3) 0' }}>
        <div
          className="progress__bar"
          style={{ width: `${t.progressPercent}%`, background: `var(--color-${sm.color})` }}
        />
      </div>
      <div className="task-card__meta">
        <span><span className={`badge badge--${sm.color}`}>{sm.label}</span> {t.progressPercent}%</span>
        <span className="text-muted">@ {escapeHtml(u?.displayName || '—')}</span>
        <span className={isOverdue ? 'text-danger' : 'text-muted'}>
          {t.dueDate ? `Due ${fmt.dateLong(t.dueDate)}` : ''}{isOverdue ? ' ⚠' : ''}
        </span>
      </div>
    </article>
  );
}