// Booking form — handles BOTH new and edit modes (mode prop).
// Port of static bookings/new.html + bookings/edit.html.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, useParams, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { useHoliday } from '../contexts/HolidayContext';
import { Bookings } from '../lib/bookings';
import { ROOMS } from '../lib/data';
import { escapeHtml, todayISO } from '../lib/app';

export function BookingNew() {
  return <BookingForm mode="new" />;
}

export function BookingEdit() {
  return <BookingForm mode="edit" />;
}

interface FormState {
  roomId: number;
  date: string;
  startTime: string;
  endTime: string;
  purpose: string;
  cupsOfTea: number;
  warmWater: number;
  coolWater: number;
  iPads: number;
  supportRequests: string;
  itSupport: boolean;
}

function BookingForm({ mode }: { mode: 'new' | 'edit' }) {
  const { user } = useAuth();
  const { holidayName, loading: holidaysLoading } = useHoliday();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const pathParams = useParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);

  // Resolve initial values
  const editingId = mode === 'edit' ? Number(pathParams.id) : null;
  const editing = editingId != null ? Bookings.byId(editingId) ?? null : null;

  const preselectedRoom = editing
    ? editing.roomId
    : Number(params.get('room') || (ROOMS.find(r => r.active)?.id ?? 0));
  const preselectedDate = editing?.date || params.get('date') || todayISO();

  const [form, setForm] = useState<FormState>(() => editing
    ? {
        roomId: editing.roomId,
        date: editing.date,
        startTime: editing.startTime,
        endTime: editing.endTime,
        purpose: editing.purpose,
        cupsOfTea: editing.cupsOfTea,
        warmWater: editing.warmWater,
        coolWater: editing.coolWater,
        iPads: editing.iPads,
        supportRequests: editing.supportRequests || '',
        itSupport: editing.itSupport
      }
    : {
        roomId: preselectedRoom,
        date: preselectedDate,
        startTime: '10:00',
        endTime: '11:00',
        purpose: '',
        cupsOfTea: 0,
        warmWater: 0,
        coolWater: 0,
        iPads: 0,
        supportRequests: '',
        itSupport: false
      }
  );

  // If the URL ?room or ?date changes after mount, keep them in sync
  useEffect(() => {
    if (mode === 'new') {
      setForm(f => ({
        ...f,
        roomId: preselectedRoom,
        date: preselectedDate
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedRoom, preselectedDate]);

  if (mode === 'edit' && !editing) {
    return (
      <AppShell title="Edit booking">
        <div className="page-header">
          <h1>Booking not found</h1>
          <Link className="btn" to="/bookings">← Back</Link>
        </div>
      </AppShell>
    );
  }

  const hname = holidayName(form.date);
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = await Bookings.validate(form, editingId ?? undefined, { holidayName });
    if (!v.ok) {
      setError(v.error);
      return;
    }
    if (mode === 'new') {
      const created = Bookings.create({ ...form, bookedById: user!.id });
      if (created.itSupport) {
        // eslint-disable-next-line no-console
        console.info(`[demo] IT support requested — would notify ADMIN users for booking ${created.ref}`);
      }
      nav(`/bookings/${created.id}?justCreated=1`, { replace: true });
    } else {
      Bookings.update(editingId!, form);
      nav(`/bookings/${editingId}`, { replace: true });
    }
  };

  const backHref = mode === 'new' ? '/bookings' : `/bookings/${editingId}`;

  return (
    <AppShell title={mode === 'new' ? 'New booking' : 'Edit booking'}>
      <div className="page-header">
        <div>
          <h1>{mode === 'new' ? 'New booking' : `Edit ${escapeHtml(editing?.ref || '')}`}</h1>
          <div className="page-header__sub">
            {mode === 'new'
              ? 'First-come-first-serve · status set to CONFIRMED immediately · HK holidays blocked'
              : 'FCFS · status stays CONFIRMED · conflict check excludes this booking'}
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
          <label className="form__label" htmlFor="roomId">Room</label>
          <select
            id="roomId"
            className="form__select"
            value={form.roomId}
            onChange={e => setForm({ ...form, roomId: Number(e.target.value) })}
            required
          >
            {ROOMS.map(r => (
              <option key={r.id} value={r.id} disabled={!r.active}>
                {r.name} — {r.building} ({r.maxSeats} seats){r.active ? '' : ' — inactive'}
              </option>
            ))}
          </select>
          <span className="form__hint text-muted">
            {mode === 'edit'
              ? 'Inactive rooms are listed but cannot be reselected — pick an active room to keep this booking live.'
              : 'Only active rooms are listed.'}
          </span>
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="date">Date</label>
          <input
            id="date"
            type="date"
            className="form__input"
            value={form.date}
            min={todayISO()}
            onChange={e => setForm({ ...form, date: e.target.value })}
            required
          />
          <span className="form__hint">
            {hname
              ? `Currently on a HK public holiday (${hname}) — change to a working day before submitting.`
              : 'HK public holidays are blocked.'}
          </span>
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="startTime">Start time</label>
          <input
            id="startTime"
            type="time"
            className="form__input"
            value={form.startTime}
            onChange={e => setForm({ ...form, startTime: e.target.value })}
            required
          />
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="endTime">End time</label>
          <input
            id="endTime"
            type="time"
            className="form__input"
            value={form.endTime}
            onChange={e => setForm({ ...form, endTime: e.target.value })}
            required
          />
        </div>
        <div className="form__row form__row--full">
          <label className="form__label" htmlFor="purpose">Purpose</label>
          <input
            id="purpose"
            type="text"
            className="form__input"
            placeholder="e.g. Weekly sync, vendor demo, exam prep"
            value={form.purpose}
            onChange={e => setForm({ ...form, purpose: e.target.value })}
            required
            maxLength={255}
          />
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="cupsOfTea">Cups of tea (0–50)</label>
          <input
            id="cupsOfTea"
            type="number"
            className="form__input"
            min={0} max={50}
            value={form.cupsOfTea}
            onChange={e => setForm({ ...form, cupsOfTea: Number(e.target.value) })}
          />
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="warmWater">Warm water cups (0–50)</label>
          <input
            id="warmWater"
            type="number"
            className="form__input"
            min={0} max={50}
            value={form.warmWater}
            onChange={e => setForm({ ...form, warmWater: Number(e.target.value) })}
          />
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="coolWater">Cool water cups (0–50)</label>
          <input
            id="coolWater"
            type="number"
            className="form__input"
            min={0} max={50}
            value={form.coolWater}
            onChange={e => setForm({ ...form, coolWater: Number(e.target.value) })}
          />
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="iPads">iPads (0–20)</label>
          <input
            id="iPads"
            type="number"
            className="form__input"
            min={0} max={20}
            value={form.iPads}
            onChange={e => setForm({ ...form, iPads: Number(e.target.value) })}
          />
        </div>
        <div className="form__row form__row--full">
          <label className="form__label" htmlFor="supportRequests">Other support</label>
          <textarea
            id="supportRequests"
            className="form__textarea"
            placeholder="AV / projector / whiteboard / video bridge…"
            value={form.supportRequests}
            onChange={e => setForm({ ...form, supportRequests: e.target.value })}
            maxLength={1000}
          />
        </div>
        <div className="form__row form__row--full">
          <label className="form__check">
            <input
              id="itSupport"
              type="checkbox"
              checked={form.itSupport}
              onChange={e => setForm({ ...form, itSupport: e.target.checked })}
            />
            <span>Request IT technical support (notifies IT Admin)</span>
          </label>
        </div>
        <div className="form__actions form__row--full" style={{ gridColumn: '1 / -1' }}>
          <Link className="btn" to={backHref}>Cancel</Link>
          <button type="submit" className="btn btn--primary" disabled={holidaysLoading}>
            {holidaysLoading ? 'Loading holidays…' : (mode === 'new' ? 'Save booking' : 'Save changes')}
          </button>
        </div>
      </form>
    </AppShell>
  );
}