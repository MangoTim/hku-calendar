// Admin holidays — list seed + user-added holidays grouped by year, plus add/remove.
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Settings } from '../lib/settings';
import { fmt, escapeHtml } from '../lib/app';

export function AdminHolidays() {
  const [, setRev] = useState(0);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const all = useMemo(() => Settings.holidays(), []);
  const grouped = useMemo(() => {
    const map = new Map<number, ReturnType<typeof Settings.holidays>>();
    for (const h of all) {
      const y = Number(h.date.slice(0, 4));
      if (!map.has(y)) map.set(y, []);
      map.get(y)!.push(h);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [all]);

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      setError('Pick a valid date.');
      return;
    }
    if (!newName.trim()) {
      setError('Name is required.');
      return;
    }
    const existing = Settings.holidays();
    if (existing.some(h => h.date === newDate)) {
      setError(`${newDate} is already a holiday (${existing.find(h => h.date === newDate)?.name}).`);
      return;
    }
    Settings.addHoliday(newDate, newName);
    setNewDate('');
    setNewName('');
    setRev(v => v + 1);
  };

  const onRemove = (date: string) => {
    if (!confirm(`Remove holiday on ${date}?`)) return;
    Settings.removeHoliday(date);
    setRev(v => v + 1);
  };

  return (
    <AppShell title="Holidays">
      <div className="page-header">
        <div>
          <h1>HK public holidays</h1>
          <div className="page-header__sub">
            {all.length} holidays across {grouped.length} years · new bookings, leave and task due dates are blocked on these dates
          </div>
        </div>
        <div className="page-header__actions">
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              if (!confirm('Reset all holiday changes back to seed?')) return;
              Settings.resetHolidays();
              setRev(v => v + 1);
            }}
          >
            Reset to seed
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(error)}</div>
      )}

      <form className="form card form--2col" onSubmit={onAdd} noValidate>
        <div className="form__row">
          <label className="form__label" htmlFor="newDate">Date</label>
          <input
            id="newDate"
            type="date"
            className="form__input"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
            required
          />
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="newName">Name</label>
          <input
            id="newName"
            type="text"
            className="form__input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            maxLength={100}
            placeholder="Faculty Foundation Day"
            required
          />
        </div>
        <div className="form__actions form__row--full" style={{ gridColumn: '1 / -1' }}>
          <Link className="btn" to="/admin">← Back to admin</Link>
          <button type="submit" className="btn btn--primary">+ Add holiday</button>
        </div>
      </form>

      {grouped.map(([year, list]) => (
        <section key={year} className="card" style={{ marginTop: 'var(--space-3)' }}>
          <h2>{year} <span className="text-muted text-sm">({list.length})</span></h2>
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Name</th><th></th></tr>
            </thead>
            <tbody>
              {list.map(h => (
                <tr key={h.date}>
                  <td>{fmt.dateLong(h.date)}</td>
                  <td>{escapeHtml(h.name)}</td>
                  <td className="actions">
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => onRemove(h.date)}
                      style={{ color: 'var(--color-danger)' }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </AppShell>
  );
}