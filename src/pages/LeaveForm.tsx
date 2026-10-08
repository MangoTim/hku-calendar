// Leave form — handles both new and edit modes (mode prop).
// Port of static leave/new.html + leave/edit.html.
import { useState } from 'react';
import { useNavigate, useSearchParams, useParams, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { Leave } from '../lib/leave';
import { USERS, holidayName } from '../lib/data';
import { escapeHtml } from '../lib/app';
import type { LeaveType } from '../lib/types';

export function LeaveNew() {
  return <LeaveForm mode="new" />;
}

export function LeaveEdit() {
  return <LeaveForm mode="edit" />;
}

interface FormState {
  userId: number;
  type: LeaveType;
  startDate: string;
  endDate: string;
  note: string;
}

function LeaveForm({ mode }: { mode: 'new' | 'edit' }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const pathParams = useParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);

  const editingId = mode === 'edit' ? Number(pathParams.id) : null;
  const editing = editingId != null ? Leave.byId(editingId) ?? null : null;

  const prefUserId = mode === 'edit'
    ? (editing?.userId ?? user!.id)
    : (Number(params.get('userId')) || user!.id);
  const prefType = mode === 'edit'
    ? (editing?.type ?? 'ANNUAL')
    : ((params.get('type') as LeaveType) || 'ANNUAL');
  const prefStart = mode === 'edit'
    ? (editing?.startDate ?? new Date().toISOString().slice(0,10))
    : (params.get('start') || new Date().toISOString().slice(0,10));
  const prefEnd = mode === 'edit'
    ? (editing?.endDate ?? prefStart)
    : (params.get('end') || prefStart);

  const person = USERS.find(u => u.id === prefUserId);
  const isOther = prefUserId !== user!.id;

  const [form, setForm] = useState<FormState>(() => editing
    ? {
        userId: editing.userId,
        type: editing.type,
        startDate: editing.startDate,
        endDate: editing.endDate,
        note: editing.note || ''
      }
    : {
        userId: prefUserId,
        type: prefType,
        startDate: prefStart,
        endDate: prefEnd,
        note: ''
      }
  );

  if (mode === 'edit' && !editing) {
    return (
      <AppShell title="Edit leave">
        <div className="page-header">
          <h1>Leave not found</h1>
          <Link className="btn" to="/leave">← Back</Link>
        </div>
      </AppShell>
    );
  }

  const startHint = form.type === 'SICK'
    ? 'Sick leave can be back-dated to a past date.'
    : 'Must be today or a future date.';
  const startMin = form.type === 'SICK' ? undefined : new Date().toISOString().slice(0,10);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = Leave.validate(form, editingId ?? undefined);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    if (mode === 'new') {
      const created = Leave.create(form);
      nav(`/leave/${created.id}?justCreated=1`, { replace: true });
    } else {
      Leave.update(editingId!, form);
      nav(`/leave/${editingId}`, { replace: true });
    }
  };

  const backHref = mode === 'new' ? '/leave' : `/leave/${editingId}`;
  const startHol = holidayName(form.startDate);
  const endHol = holidayName(form.endDate);

  return (
    <AppShell title={mode === 'new' ? 'New leave' : 'Edit leave'}>
      <div className="page-header">
        <div>
          <h1>
            {mode === 'new' ? 'New leave' : 'Edit leave'}
            {person && mode === 'new' && <> — {person.displayName}</>}
            {person && mode === 'edit' && <> for {person.displayName}</>}
          </h1>
          <div className="page-header__sub">
            {mode === 'new'
              ? `Auto-approved in demo · ICS export · conflict check against existing leave${isOther ? ' · (demo: any signed-in user can file leave for anyone; production would restrict to self or TASK_MANAGER)' : ''}`
              : 'Status stays APPROVED · conflict check excludes this record'}
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
        <div className="form__row">
          <label className="form__label" htmlFor="userId">Person</label>
          <select
            id="userId"
            className="form__select"
            value={form.userId}
            onChange={e => setForm({ ...form, userId: Number(e.target.value) })}
            required
          >
            {USERS.map(u => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.team})
              </option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="type">Type</label>
          <select
            id="type"
            className="form__select"
            value={form.type}
            onChange={e => setForm({ ...form, type: e.target.value as LeaveType })}
            required
          >
            {Leave.typesAll().map(t => (
              <option key={t.code} value={t.code}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="startDate">Start date</label>
          <input
            id="startDate"
            type="date"
            className="form__input"
            value={form.startDate}
            min={startMin}
            onChange={e => setForm({ ...form, startDate: e.target.value })}
            required
          />
          <span className="form__hint text-muted">{startHint}</span>
          {mode === 'edit' && startHol && (
            <span className="form__hint text-muted">
              Currently starts on a HK public holiday ({startHol}).
            </span>
          )}
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="endDate">End date</label>
          <input
            id="endDate"
            type="date"
            className="form__input"
            value={form.endDate}
            onChange={e => setForm({ ...form, endDate: e.target.value })}
            required
          />
          {mode === 'edit' && endHol && (
            <span className="form__hint text-muted">
              Currently ends on a HK public holiday ({endHol}).
            </span>
          )}
        </div>

        <div className="form__row form__row--full">
          <label className="form__label" htmlFor="note">Note (optional)</label>
          <textarea
            id="note"
            className="form__textarea"
            placeholder="Family trip, doctor visit, etc."
            value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
            maxLength={500}
          />
        </div>

        <div className="form__actions form__row--full" style={{ gridColumn: '1 / -1' }}>
          <Link className="btn" to={backHref}>Cancel</Link>
          <button type="submit" className="btn btn--primary">
            {mode === 'new' ? 'Submit leave' : 'Save changes'}
          </button>
        </div>
      </form>
    </AppShell>
  );
}