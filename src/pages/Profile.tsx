// Profile — current user info + notification preferences toggles.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { fmt, escapeHtml } from '../lib/app';
import type { User } from '../lib/types';

const LS_KEY_USER_OVERRIDES = 'engg_user_user_overrides';

interface UserOverride { id: number; morningTeamDigestEnabled: boolean; mondayTwoWeekLeaveReportEnabled: boolean; }

function loadOverrides(): UserOverride[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY_USER_OVERRIDES) || '[]'); } catch { return []; }
}
function persistOverrides(list: UserOverride[]): void {
  try { localStorage.setItem(LS_KEY_USER_OVERRIDES, JSON.stringify(list)); } catch { /* ignore */ }
}

function applyOverride(user: User): UserOverride | undefined {
  const overrides = loadOverrides();
  return overrides.find(o => o.id === user.id);
}

function setPreference(userId: number, key: 'morningTeamDigestEnabled' | 'mondayTwoWeekLeaveReportEnabled', value: boolean): void {
  const list = loadOverrides();
  let entry = list.find(o => o.id === userId);
  if (!entry) {
    entry = { id: userId, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false };
    list.push(entry);
  }
  entry[key] = value;
  persistOverrides(list);
}

export function ProfilePage() {
  const { user } = useAuth();
  const [, setRev] = useState(0);

  if (!user) return null;

  const override = applyOverride(user);
  const morningDigest = override ? override.morningTeamDigestEnabled : user.morningTeamDigestEnabled;
  const leaveReport = override ? override.mondayTwoWeekLeaveReportEnabled : user.mondayTwoWeekLeaveReportEnabled;

  const onToggleDigest = () => {
    setPreference(user.id, 'morningTeamDigestEnabled', !morningDigest);
    setRev(v => v + 1);
  };
  const onToggleLeaveReport = () => {
    setPreference(user.id, 'mondayTwoWeekLeaveReportEnabled', !leaveReport);
    setRev(v => v + 1);
  };

  return (
    <AppShell title="Profile">
      <div className="page-header">
        <div>
          <h1>{escapeHtml(user.displayName)}</h1>
          <div className="page-header__sub">{escapeHtml(user.title)} · {escapeHtml(user.team)}</div>
        </div>
      </div>

      <div className="dash-grid dash-grid--2">
        <section className="card">
          <h2>Account</h2>
          <table className="table">
            <tbody>
              <tr><th>Display name</th><td>{escapeHtml(user.displayName)}</td></tr>
              <tr><th>Username</th><td><code>{escapeHtml(user.username)}</code></td></tr>
              <tr><th>Title</th><td>{escapeHtml(user.title)}</td></tr>
              <tr><th>Team</th><td>{escapeHtml(user.team)}</td></tr>
              <tr><th>Role</th><td><span className="badge badge--info">{fmt.role(user.role)}</span></td></tr>
              <tr><th>Source</th><td><span className="badge badge--muted">{escapeHtml(user.source)}</span></td></tr>
              <tr>
                <th>Status</th>
                <td>
                  {user.enabled
                    ? <span className="badge badge--success">Enabled</span>
                    : <span className="badge badge--danger">Disabled</span>}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Notification preferences</h2>
          <p className="text-muted text-sm" style={{ marginBottom: 'var(--space-3)' }}>
            Per-user toggles. Changes apply immediately and persist across sessions on this browser.
          </p>

          <div className="form__row">
            <label className="form__label" htmlFor="prefDigest">
              <input
                type="checkbox"
                id="prefDigest"
                checked={morningDigest}
                onChange={onToggleDigest}
              />{' '}
              Morning team digest
            </label>
            <span className="form__hint text-muted">
              Receive an email every morning summarising today's bookings and leave for your team.
            </span>
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="prefLeave">
              <input
                type="checkbox"
                id="prefLeave"
                checked={leaveReport}
                onChange={onToggleLeaveReport}
              />{' '}
              Monday two-week leave report
            </label>
            <span className="form__hint text-muted">
              Receive a Monday-morning email covering the next 14 days of leave across all teams.
            </span>
          </div>
        </section>
      </div>

      <p className="text-muted text-sm" style={{ marginTop: 'var(--space-4)' }}>
        Need to change your name or team? Ask an administrator on the{' '}
        <Link to="/admin/users">Users admin page</Link>.
      </p>
    </AppShell>
  );
}