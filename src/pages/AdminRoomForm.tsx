// Room form — new + edit (mode prop, ADMIN-only).
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Rooms } from '../lib/rooms';
import { escapeHtml } from '../lib/app';

// Suggested room names — shown in a datalist so users can pick a default
// (Meeting Room 1–5, Conference Room) or type their own custom name.
const SUGGESTED_NAMES = [
  'Meeting Room 1',
  'Meeting Room 2',
  'Meeting Room 3',
  'Meeting Room 4',
  'Meeting Room 5',
  'Conference Room'
];

export function AdminRoomNew() {
  return <RoomForm mode="new" />;
}

export function AdminRoomEdit() {
  return <RoomForm mode="edit" />;
}

interface FormData {
  name: string;
  building: string;
  maxSeats: number;
  active: boolean;
  notes: string;
}

function RoomForm({ mode }: { mode: 'new' | 'edit' }) {
  const pathParams = useParams<{ id: string }>();
  const editingId = mode === 'edit' ? Number(pathParams.id) : null;
  const editing = editingId != null ? Rooms.byId(editingId) ?? null : null;
  const [error, setError] = useState<string | null>(null);

  if (mode === 'edit' && !editing) {
    return (
      <AppShell title="Edit room">
        <div className="page-header">
          <h1>Room not found</h1>
          <Link className="btn" to="/admin/rooms">← Back</Link>
        </div>
      </AppShell>
    );
  }

  const [form, setForm] = useState<FormData>(editing
    ? {
        name: editing.name,
        building: editing.building,
        maxSeats: editing.maxSeats,
        active: editing.active,
        notes: editing.notes || ''
      }
    : { name: '', building: '', maxSeats: 8, active: true, notes: '' }
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = Rooms.validate(form);
    if (!v.ok) { setError(v.error); return; }
    if (mode === 'new') {
      Rooms.create(form);
      window.location.href = '/admin/rooms';
    } else {
      Rooms.update(editingId!, form);
      window.location.href = '/admin/rooms';
    }
  };

  return (
    <AppShell title={mode === 'new' ? 'Add room' : `Edit room #${editing!.id}`}>
      <div className="page-header">
        <div>
          <h1>{mode === 'new' ? 'Add room' : `Edit room #${editing!.id}`}</h1>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/admin/rooms">← Back</Link>
        </div>
      </div>

      {error && (
        <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(error)}</div>
      )}

      <form className="form card" onSubmit={onSubmit} noValidate>
        <div className="form__row form__row--2">
          <div className="form__row">
            <label className="form__label" htmlFor="name">Name</label>
            <input
              id="name"
              type="text"
              className="form__input"
              required
              maxLength={100}
              list="roomNameSuggestions"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Pick a default or type your own"
            />
            <datalist id="roomNameSuggestions">
              {SUGGESTED_NAMES.map(n => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <span className="form__hint text-muted">
              Suggestions: Meeting Room 1–5, Conference Room — or type any custom name.
            </span>
          </div>
          <div className="form__row">
            <label className="form__label" htmlFor="building">Building</label>
            <input id="building" type="text" className="form__input" required maxLength={100}
              value={form.building}
              onChange={e => setForm({ ...form, building: e.target.value })}
              placeholder="Main Building" />
          </div>
        </div>

        <div className="form__row form__row--2">
          <div className="form__row">
            <label className="form__label" htmlFor="maxSeats">Max seats</label>
            <input id="maxSeats" type="number" className="form__input" required min={1} max={500}
              value={form.maxSeats}
              onChange={e => setForm({ ...form, maxSeats: Number(e.target.value) })} />
          </div>
          <div className="form__row">
            <label className="form__label" htmlFor="active">Status</label>
            <select id="active" className="form__select"
              value={form.active ? 'true' : 'false'}
              onChange={e => setForm({ ...form, active: e.target.value === 'true' })}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="notes">Notes</label>
          <textarea id="notes" className="form__textarea" maxLength={500} rows={3}
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            placeholder="AV screen + video bridge" />
        </div>

        <div className="form__actions">
          <Link className="btn" to="/admin/rooms">Cancel</Link>
          <button type="submit" className="btn btn--primary">
            {mode === 'new' ? 'Add room' : 'Save changes'}
          </button>
        </div>
      </form>
    </AppShell>
  );
}