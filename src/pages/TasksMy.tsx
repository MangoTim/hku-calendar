// My tasks — partitions current user's tasks into Overdue / Due soon / Later / Completed sections.
// Port of static tasks/mine.html.
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { Tasks } from '../lib/tasks';
import { TASK_SETTINGS } from '../lib/data';
import { fmt, escapeHtml, todayISO, addDaysISO } from '../lib/app';
import type { Task as TaskRec } from '../lib/types';

export function TasksMy() {
  const { user } = useAuth();
  const N = TASK_SETTINGS.taskDeadlineAlertDays;
  const today = todayISO();
  const horizon = addDaysISO(today, N - 1);

  const mine = Tasks.all().filter(t => t.assigneeId === user!.id);
  const overdue = mine.filter(t => t.status !== 'DONE' && t.dueDate && t.dueDate < today);
  const dueSoon = mine.filter(t => t.status !== 'DONE' && t.dueDate && t.dueDate >= today && t.dueDate <= horizon);
  const later   = mine.filter(t => t.status !== 'DONE' && (!t.dueDate || t.dueDate > horizon));
  const done    = mine.filter(t => t.status === 'DONE');

  return (
    <AppShell title="My tasks">
      <div className="page-header">
        <div>
          <h1>My tasks</h1>
          <div className="page-header__sub">
            {mine.length} total · {overdue.length} overdue · {dueSoon.length} due in next {N} days
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/tasks">All tasks →</Link>
        </div>
      </div>

      {section('Overdue', overdue, 'overdue')}
      {section(`Due in next ${N} days`, dueSoon, '')}
      {section('Later', later, '')}
      {section('Completed', done, '')}

      {mine.length === 0 && (
        <div className="card empty">You have no tasks assigned.</div>
      )}
    </AppShell>
  );
}

function section(title: string, list: TaskRec[], extraBadge: string) {
  if (list.length === 0) return null;
  return (
    <section className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <h2>{title} <span className="text-muted text-sm">({list.length})</span></h2>
      <div className="table-wrap">
        <table className="table table--hover">
          <thead>
            <tr><th>Title</th><th>Priority</th><th>Status</th><th>Progress</th><th>Due</th></tr>
          </thead>
          <tbody>
            {list.map(t => <Row key={t.id} t={t} extraBadge={extraBadge} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ t, extraBadge }: { t: TaskRec; extraBadge: string }) {
  const pm = Tasks.priorityMeta(t.priority);
  const sm = Tasks.statusMeta(t.status);
  return (
    <tr>
      <td>
        <Link to={`/tasks/${t.id}`}>{escapeHtml(t.title)}</Link>
        {extraBadge && <> <span className="badge badge--danger">{extraBadge}</span></>}
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
      <td>{t.dueDate ? fmt.dateLong(t.dueDate) : <span className="text-muted">—</span>}</td>
    </tr>
  );
}