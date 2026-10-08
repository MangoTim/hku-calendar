// Admin task settings — single config: task deadline alert window (days).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Settings } from '../lib/settings';
import { escapeHtml } from '../lib/app';

export function AdminTaskSettings() {
  const initial = Settings.taskSettings();
  const [days, setDays] = useState<number>(initial.taskDeadlineAlertDays);
  const [saved, setSaved] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    Settings.setTaskDeadlineAlertDays(days);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <AppShell title="Task settings">
      <div className="page-header">
        <div>
          <h1>Task settings</h1>
          <div className="page-header__sub">
            Controls the "due soon" window used across Tasks pages.
          </div>
        </div>
      </div>

      <form className="form card" onSubmit={onSubmit} noValidate>
        <div className="form__row">
          <label className="form__label" htmlFor="alertDays">Deadline alert window (days)</label>
          <input
            id="alertDays"
            type="number"
            className="form__input"
            min={1}
            max={90}
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            required
          />
          <span className="form__hint text-muted">
            Tasks due within this many days appear under "Tasks due soon" on the dashboard and in the
            My tasks page. Range 1–90.
          </span>
        </div>

        <div className="form__actions">
          <Link className="btn" to="/admin">← Back to admin</Link>
          <button type="submit" className="btn btn--primary" disabled={saved}>
            {saved ? '✅ Saved' : 'Save settings'}
          </button>
        </div>
      </form>

      <section className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Current effective setting</h2>
        <p>
          Tasks due within <strong>{escapeHtml(String(Settings.taskSettings().taskDeadlineAlertDays))}</strong> days
          are flagged as "due soon" across the app.
        </p>
      </section>
    </AppShell>
  );
}