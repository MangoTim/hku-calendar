// Task detail — summary + progress timeline + collapsible log-progress form.
// Port of static tasks/detail.html.
import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { Tasks } from '../lib/tasks';
import { USERS, holidayName } from '../lib/data';
import { fmt, escapeHtml, todayISO } from '../lib/app';
import type { TaskProgress as TaskProgressRec } from '../lib/types';

interface Flash {
  kind: 'logged' | 'noted' | 'nochange';
  to?: number;
  from?: number;
  taskTitle: string;
}

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const { user, ROLE } = useAuth();
  const [, setRev] = useState(0);
  const [flash, setFlash] = useState<Flash | null>(() => {
    try { return JSON.parse(sessionStorage.getItem('detailFlash') || 'null'); }
    catch { return null; }
  });

  useEffect(() => {
    if (flash) {
      sessionStorage.removeItem('detailFlash');
      // clear after a moment so it doesn't re-appear on re-mount
      setTimeout(() => setFlash(null), 4000);
    }
  }, [flash]);

  const t = Tasks.byId(Number(id));
  if (!t) {
    return (
      <AppShell title="Task">
        <div className="page-header">
          <h1>Task not found</h1>
          <Link className="btn" to="/tasks">← Back</Link>
        </div>
      </AppShell>
    );
  }

  const assignee = USERS.find(u => u.id === t.assigneeId);
  const assigner = USERS.find(u => u.id === t.assignedById);
  const pm = Tasks.priorityMeta(t.priority);
  const sm = Tasks.statusMeta(t.status);
  const justCreated = params.get('justCreated') === '1';
  const today = todayISO();
  const isOverdue = t.status !== 'DONE' && t.dueDate && t.dueDate < today;

  const canEdit    = ROLE.isAdmin() || ROLE.isTaskManager() || t.assigneeId === user!.id;
  const canUpdateP = t.assigneeId === user!.id || ROLE.isAdmin() || ROLE.isTaskManager();
  const history = Tasks.progressFor(t.id);

  return (
    <AppShell title="Task">
      <div className="page-header">
        <div>
          <h1>{escapeHtml(t.title)}</h1>
          <div className="page-header__sub">
            #{t.id} · assigned by {escapeHtml(assigner?.displayName || '—')} to {escapeHtml(assignee?.displayName || '—')}
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/tasks">← Back</Link>
          {canEdit && <Link className="btn" to={`/tasks/${t.id}/edit`}>Edit</Link>}
          {canUpdateP && t.status !== 'DONE' && (
            <button
              className="btn btn--primary"
              id="updateProgBtn"
              onClick={toggleProgressForm}
            >
              Update progress
            </button>
          )}
        </div>
      </div>

      {justCreated && (
        <div className="alert alert--success" role="status">
          ✅ Task assigned to <strong>{escapeHtml(assignee?.displayName || '—')}</strong>.
        </div>
      )}
      {flash && (
        <div className="alert alert--success" role="status">
          {flash.kind === 'logged' && (
            <>Progress updated to <strong>{flash.to}%</strong> — new timeline entry added.</>
          )}
          {flash.kind === 'noted' && <>📝 Note updated on the latest progress entry.</>}
        </div>
      )}
      <div id="progFlash"></div>

      <div className="dash-grid dash-grid--2">
        <section className="card">
          <h2>Summary</h2>
          <table className="table">
            <tbody>
              <tr><th>Status</th><td><span className={`badge badge--${sm.color}`}>{sm.label}</span></td></tr>
              <tr><th>Priority</th><td><span className={`badge badge--${pm.color}`}>{pm.label}</span></td></tr>
              <tr>
                <th>Assignee</th>
                <td>
                  {escapeHtml(assignee?.displayName || '—')}{' '}
                  <span className="text-muted">({escapeHtml(assignee?.team || '')})</span>
                </td>
              </tr>
              <tr>
                <th>Assigned by</th>
                <td>
                  {escapeHtml(assigner?.displayName || '—')}{' '}
                  <span className="text-muted">({escapeHtml(assigner?.team || '')})</span>
                </td>
              </tr>
              <tr>
                <th>Due</th>
                <td>
                  {t.dueDate ? fmt.dateLong(t.dueDate) : <span className="text-muted">—</span>}
                  {t.dueDate && holidayName(t.dueDate) && (
                    <> <span className="badge badge--warning">Holiday: {holidayName(t.dueDate)}</span></>
                  )}
                  {isOverdue && <> <span className="badge badge--danger">Overdue</span></>}
                </td>
              </tr>
              <tr>
                <th>Progress</th>
                <td>
                  <div className="progress" style={{ width: 160 }}>
                    <div
                      className="progress__bar"
                      style={{ width: `${t.progressPercent}%`, background: `var(--color-${sm.color})` }}
                    />
                  </div>{' '}
                  <span className="text-muted">{t.progressPercent}%</span>
                </td>
              </tr>
              <tr>
                <th>Description</th>
                <td>{t.description ? escapeHtml(t.description) : <span className="text-muted">—</span>}</td>
              </tr>
              {t.completionNote && (
                <tr><th>Completion note</th><td>{escapeHtml(t.completionNote)}</td></tr>
              )}
              {t.completedAt && (
                <tr><th>Completed at</th><td className="text-muted">{fmt.dateTime(t.completedAt)}</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Progress timeline</h2>
          {history.length === 0 ? (
            <p className="text-muted">
              No progress entries yet.
              {canUpdateP && t.status !== 'DONE' && ' Click "Update progress" to log the first one.'}
            </p>
          ) : (
            <ol className="timeline">
              {history.map((h: TaskProgressRec) => (
                <TimelineItem key={h.id} h={h} />
              ))}
            </ol>
          )}
        </section>

        <section className="card" id="progCard" style={{ gridColumn: '1 / -1' }}>
          <h2>Update progress</h2>
          <div id="progCardBody" style={{ display: 'none' }}>
            {canUpdateP && t.status !== 'DONE' ? (
              <UpdateProgressForm
                taskId={t.id}
                currentPercent={t.progressPercent}
                currentNote={t.completionNote || ''}
                onLogged={(to) => {
                  sessionStorage.setItem('detailFlash', JSON.stringify({
                    kind: 'logged', to, taskTitle: t.title
                  }));
                  setRev(v => v + 1);
                  window.location.reload();
                }}
                onNoted={() => {
                  sessionStorage.setItem('detailFlash', JSON.stringify({
                    kind: 'noted', from: t.progressPercent, taskTitle: t.title
                  }));
                  setRev(v => v + 1);
                  window.location.reload();
                }}
              />
            ) : (
              <p className="text-muted">
                {t.status === 'DONE'
                  ? `This task is done. Status: ${sm.label}.`
                  : "You don't have permission to update progress on this task."}
              </p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

// ---------------- Timeline item ----------------
function TimelineItem({ h }: { h: TaskProgressRec }) {
  const u = USERS.find(x => x.id === h.updatedById);
  return (
    <li className="timeline__item">
      <div className="timeline__dot"></div>
      <div className="timeline__body">
        <div className="timeline__head">
          <strong>{h.fromPercent}% → {h.toPercent}%</strong>
          <span className="text-muted text-sm">{fmt.dateTime(h.createdAt)}</span>
          <span className="text-muted text-sm">· {escapeHtml(u?.displayName || '—')}</span>
        </div>
        {h.note && <p>{escapeHtml(h.note)}</p>}
      </div>
    </li>
  );
}

// ---------------- Update progress form ----------------
interface ProgressFormProps {
  taskId: number;
  currentPercent: number;
  currentNote: string;
  onLogged: (to: number) => void;
  onNoted: () => void;
}

function UpdateProgressForm({ taskId, currentPercent, currentNote, onLogged, onNoted }: ProgressFormProps) {
  const { user } = useAuth();
  const [percent, setPercent] = useState<number>(currentPercent);
  const [note, setNote] = useState<string>(currentNote);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!note.trim()) {
      setError('Please add a short note describing what you did.');
      return;
    }
    const from = currentPercent;
    const history = Tasks.progressFor(taskId);
    const last = history[history.length - 1];

    if (percent > from) {
      Tasks.recordProgress(taskId, { progressPercent: percent, updatedById: user!.id, note });
      onLogged(percent);
    } else if (percent === from) {
      if (last && (last.note || '') === note) {
        setError('No changes. Progress and note are unchanged from the latest entry.');
        return;
      }
      const result = Tasks.updateLatestNote(taskId, note, user!.id);
      if (result.changed) {
        onNoted();
      } else {
        setError(
          history.length === 0
            ? 'No history yet. Pick a higher % to log the first progress entry.'
            : 'No changes — could not update the note.'
        );
      }
    }
  };

  return (
    <form className="form form--2col" onSubmit={onSubmit} noValidate>
      {error && <div className="alert alert--muted" role="status">{error}</div>}
      <div className="form__row">
        <label className="form__label" htmlFor="newPercent">New %</label>
        <select
          id="newPercent"
          className="form__select"
          value={percent}
          onChange={e => setPercent(Number(e.target.value))}
          required
        >
          {[0,10,20,30,40,50,60,70,80,90,100].map(p => {
            const disabled = p < currentPercent;
            return (
              <option
                key={p}
                value={p}
                disabled={disabled}
              >
                {p}%{p === currentPercent ? ' (current)' : ''}
              </option>
            );
          })}
        </select>
        <span className="form__hint text-muted">
          Pick a higher % to add a new dot. Picking the same % just updates the note on the latest dot.
        </span>
      </div>
      <div className="form__row form__row--full">
        <label className="form__label" htmlFor="progNote">Note</label>
        <textarea
          id="progNote"
          className="form__textarea"
          required
          maxLength={500}
          placeholder="What did you do / finish?"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </div>
      <div className="form__actions form__row--full" style={{ gridColumn: '1 / -1' }}>
        <button type="submit" className="btn btn--primary">Log progress</button>
      </div>
    </form>
  );
}

// ---------------- Toggle logic ----------------
function toggleProgressForm() {
  const body = document.getElementById('progCardBody');
  const btn = document.getElementById('updateProgBtn');
  const card = document.getElementById('progCard');
  if (!body || !btn || !card) return;
  const isOpen = body.style.display !== 'none';
  if (isOpen) {
    body.style.display = 'none';
    btn.textContent = 'Update progress';
  } else {
    body.style.display = '';
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      const sel = document.getElementById('newPercent');
      if (sel) sel.focus();
    }, 350);
    btn.textContent = 'Cancel update';
  }
}