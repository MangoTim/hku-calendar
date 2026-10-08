// Task form — handles both new and edit modes (mode prop).
// Port of static tasks/new.html + tasks/edit.html.
import { useState } from 'react';
import { useNavigate, useSearchParams, useParams, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { Tasks } from '../lib/tasks';
import { USERS, TASK_SETTINGS, holidayName } from '../lib/data';
import { escapeHtml, todayISO, addDaysISO } from '../lib/app';
import type { TaskStatus, TaskPriority } from '../lib/types';

export function TaskNew() {
  return <TaskForm mode="new" />;
}

export function TaskEdit() {
  return <TaskForm mode="edit" />;
}

interface FormState {
  title: string;
  description: string;
  assigneeId: number;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string;
  progressPercent: number;
}

function TaskForm({ mode }: { mode: 'new' | 'edit' }) {
  const { user, ROLE } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const pathParams = useParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);

  // Role gate for new
  if (mode === 'new' && !ROLE.canAssignTasks()) {
    return (
      <AppShell title="Assign task">
        <div className="alert alert--danger" role="alert">
          ⚠️ Only Task Manager / Administrator can assign new tasks.
        </div>
        <Link className="btn" to="/tasks">← Back to tasks</Link>
      </AppShell>
    );
  }

  const editingId = mode === 'edit' ? Number(pathParams.id) : null;
  const editing = editingId != null ? Tasks.byId(editingId) ?? null : null;

  // Role gate for edit
  if (mode === 'edit' && editing) {
    const canEdit = ROLE.isAdmin() || ROLE.isTaskManager() || editing.assigneeId === user!.id;
    if (!canEdit) {
      return (
        <AppShell title="Edit task">
          <div className="alert alert--danger" role="alert">
            ⚠️ You don't have permission to edit this task.
          </div>
          <Link className="btn" to={`/tasks/${editing.id}`}>← Back to detail</Link>
        </AppShell>
    );
    }
  }

  if (mode === 'edit' && !editing) {
    return (
      <AppShell title="Edit task">
        <div className="page-header">
          <h1>Task not found</h1>
          <Link className="btn" to="/tasks">← Back</Link>
        </div>
      </AppShell>
    );
  }

  const prefAssignee = mode === 'edit'
    ? (editing?.assigneeId ?? user!.id)
    : (Number(params.get('assigneeId')) || user!.id);
  const prefDue = mode === 'edit'
    ? (editing?.dueDate || addDaysISO(todayISO(), 7))
    : (params.get('due') || addDaysISO(todayISO(), 7));

  const [form, setForm] = useState<FormState>(() => editing
    ? {
        title: editing.title,
        description: editing.description || '',
        assigneeId: editing.assigneeId,
        priority: editing.priority,
        status: editing.status,
        dueDate: editing.dueDate,
        progressPercent: editing.progressPercent
      }
    : {
        title: '',
        description: '',
        assigneeId: prefAssignee,
        priority: 'NORMAL',
        status: 'OPEN',
        dueDate: prefDue,
        progressPercent: 0
      }
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const input = {
      title: form.title.trim(),
      description: form.description.trim(),
      assigneeId: form.assigneeId,
      priority: form.priority,
      status: form.status,
      dueDate: form.dueDate,
      progressPercent: Number(form.progressPercent) || 0,
      assignedById: mode === 'edit' ? editing!.assignedById : user!.id
    };

    // Keep status and progress consistent: derive status from progress.
    input.status = Tasks.statusFromProgress(input.progressPercent);

    const v = Tasks.validate(input, editingId ?? undefined);
    if (!v.ok) {
      setError(v.error);
      return;
    }

    if (mode === 'new') {
      // Create at 0% first, then advance via recordProgress so a 0→X history row is logged.
      // (recordProgress early-returns when to === from.)
      const t = Tasks.create({ ...input, progressPercent: 0 });
      if (input.progressPercent > 0) {
        Tasks.recordProgress(t.id, {
          progressPercent: input.progressPercent,
          updatedById: user!.id,
          note: 'Initial progress on assignment'
        });
      }
      nav(`/tasks/${t.id}?justCreated=1`, { replace: true });
    } else {
      Tasks.update(editingId!, input);
      nav(`/tasks/${editingId}`, { replace: true });
    }
  };

  const backHref = mode === 'new' ? '/tasks' : `/tasks/${editingId}`;
  const startHol = editing && holidayName(editing.dueDate);

  return (
    <AppShell title={mode === 'new' ? 'Assign task' : 'Edit task'}>
      <div className="page-header">
        <div>
          <h1>{mode === 'new' ? 'Assign task' : `Edit task #${editing!.id}`}</h1>
          <div className="page-header__sub">
            {mode === 'new'
              ? 'Assigns immediately · status auto-derives from progress · history row is logged'
              : `${escapeHtml(editing!.title)} · (demo: any signed-in user with edit rights can edit; production would restrict to TASK_MANAGER/ADMIN)`}
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to={backHref}>← Back</Link>
        </div>
      </div>

      {error && (
        <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(error)}</div>
      )}

      <form className="form form--2col card" onSubmit={onSubmit} noValidate>
        <div className="form__row form__row--full">
          <label className="form__label" htmlFor="title">Title</label>
          <input
            id="title"
            type="text"
            className="form__input"
            required
            maxLength={200}
            placeholder="Migrate intranet DB host to SQL Server"
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
          />
        </div>

        <div className="form__row form__row--full">
          <label className="form__label" htmlFor="description">Description</label>
          <textarea
            id="description"
            className="form__textarea"
            maxLength={1000}
            placeholder="Plan, steps, constraints…"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
          />
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="assigneeId">Assignee</label>
          <select
            id="assigneeId"
            className="form__select"
            value={form.assigneeId}
            onChange={e => setForm({ ...form, assigneeId: Number(e.target.value) })}
            required
          >
            {USERS.map(u => (
              <option key={u.id} value={u.id}>{u.displayName} ({u.team})</option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="priority">Priority</label>
          <select
            id="priority"
            className="form__select"
            value={form.priority}
            onChange={e => setForm({ ...form, priority: e.target.value as TaskPriority })}
            required
          >
            {Tasks.prioritiesAll().map(p => (
              <option key={p.code} value={p.code}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="status">Status</label>
          <select
            id="status"
            className="form__select"
            value={form.status}
            onChange={e => setForm({ ...form, status: e.target.value as TaskStatus })}
            required
          >
            {Tasks.statusesAll().map(s => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="dueDate">Due date</label>
          <input
            id="dueDate"
            type="date"
            className="form__input"
            value={form.dueDate}
            onChange={e => setForm({ ...form, dueDate: e.target.value })}
            required
          />
          <span className="form__hint text-muted">
            Future date recommended · system notifies assignee when due within{' '}
            <span id="hintN">{TASK_SETTINGS.taskDeadlineAlertDays || 14}</span> days
          </span>
          {startHol && (
            <span className="form__hint text-muted">
              Currently due on a HK public holiday ({startHol}).
            </span>
          )}
        </div>

        <div className="form__row form__row--full">
          <label className="form__label" htmlFor="progressPercent">
            {mode === 'new' ? 'Initial progress' : 'Progress'} (0–100, steps of 10)
          </label>
          <input
            id="progressPercent"
            type="number"
            className="form__input"
            min={0} max={100} step={10}
            value={form.progressPercent}
            onChange={e => setForm({ ...form, progressPercent: Number(e.target.value) })}
          />
          <span className="form__hint text-muted">
            Status auto-adjusts: 0% → OPEN, 1–99% → IN_PROGRESS, 100% → DONE.
            {mode === 'edit' && ' For monotonic history, use "Update progress" on the detail page.'}
          </span>
        </div>

        <div className="form__actions form__row--full" style={{ gridColumn: '1 / -1' }}>
          <Link className="btn" to={backHref}>Cancel</Link>
          <button type="submit" className="btn btn--primary">
            {mode === 'new' ? 'Assign task' : 'Save changes'}
          </button>
        </div>
      </form>
    </AppShell>
  );
}