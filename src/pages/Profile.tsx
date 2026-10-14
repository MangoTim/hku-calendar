// Profile — current user info, self-service profile settings (RFQ §2(d)),
// and notification preferences toggles.
//
// Self-service fields: displayName, title, team. Email is intentionally
// read-only here because for SSO users it's the identity anchor the
// Entra callback uses to match them — changing it locally would desync
// the local session from the DB. Admins update SSO identity fields on
// /admin/users.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { fmt, escapeHtml, Session } from '../lib/app';
import { getProfileOverride, setSelfProfile } from '../lib/userAdmin';
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
              <tr>
                <th>Email</th>
                <td>
                  {user.email
                    ? <code>{escapeHtml(user.email)}</code>
                    : <span className="text-muted text-sm">— not set —</span>}
                </td>
              </tr>
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
          <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
            Your email is the identity anchor used for SSO sign-in. Ask an administrator
            on the <Link to="/admin/users">Users admin page</Link> to update it.
          </p>
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

        <ProfileEditor
          user={user}
          onSaved={() => setRev(v => v + 1)}
        />
      </div>
    </AppShell>
  );
}

/**
 * Self-service profile editor (RFQ §2(d)).
 *
 * Lets the current user change their display name, title, and team. Email,
 * role, enabled flag, and source are admin-only — they're anchored to the
 * SSO identity (email) or admin workflow (role/enabled), so the editor
 * doesn't expose them.
 *
 * Persistence: writes to `engg_user_profile_overrides` via UserAdmin
 * helpers; AuthContext applies them on top of the session-derived User
 * view so other pages (Dashboard, Bookings, Tasks) see the new name
 * immediately. The underlying SSO DB record is intentionally left
 * untouched — admins update SSO identity fields on /admin/users.
 */
function ProfileEditor({ user, onSaved }: { user: User; onSaved: () => void }) {
  // Initial values come from the LS override first (so reopening the
  // editor reflects the latest saved state), then fall back to the live
  // session-derived fields. Editing a previously-saved value should show
  // the saved value, not the underlying seed value.
  const override = getProfileOverride(user.id);
  const [displayName, setDisplayName] = useState<string>(override?.displayName ?? user.displayName);
  const [title, setTitle] = useState<string>(override?.title ?? user.title);
  const [team, setTeam] = useState<string>(override?.team ?? user.team);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // If the user changes (sign-out / sign-in as a different account), reset
  // the form to that user's stored values. Without this the form would
  // keep showing the previous user's edits while the header above already
  // shows the new user's name.
  useEffect(() => {
    const o = getProfileOverride(user.id);
    setDisplayName(o?.displayName ?? user.displayName);
    setTitle(o?.title ?? user.title);
    setTeam(o?.team ?? user.team);
    setSavedAt(null);
    setErr(null);
  }, [user.id, user.displayName, user.title, user.team]);

  const dirty =
    (displayName.trim() !== (override?.displayName ?? user.displayName)) ||
    (title.trim()       !== (override?.title       ?? user.title)) ||
    (team.trim()        !== (override?.team        ?? user.team));

  const valid = displayName.trim().length > 0 && team.trim().length > 0;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setErr(null);
    try {
      setSelfProfile(user.id, {
        displayName: displayName.trim(),
        title:       title.trim(),
        team:        team.trim()
      });
      // Refresh the session so the rest of the app sees the new name/team.
      // Session.set is built from a User object; we keep the original
      // session fields (id/role/source/email) and update the user-visible
      // ones, then trigger the storage listener AuthContext subscribes to
      // so React state picks up the change without a reload.
      const next: User = {
        ...user,
        displayName: displayName.trim(),
        title: title.trim(),
        team: team.trim()
      };
      Session.set(next);
      // storage events don't fire in the same tab — manually nudge.
      window.dispatchEvent(new StorageEvent('storage', { key: 'engg_intranet_session' }));
      setSavedAt(new Date().toISOString());
      onSaved();
    } catch (e: any) {
      setErr((e as Error)?.message || 'Failed to save');
    }
  };

  const onReset = () => {
    const o = getProfileOverride(user.id);
    setDisplayName(o?.displayName ?? user.displayName);
    setTitle(o?.title ?? user.title);
    setTeam(o?.team ?? user.team);
    setSavedAt(null);
    setErr(null);
  };

  return (
    <section className="card" style={{ gridColumn: '1 / -1' }}>
      <h2>Profile settings</h2>
      <p className="text-muted text-sm" style={{ marginBottom: 'var(--space-3)' }}>
        Update how your name, title, and team show across the intranet
        (Dashboard, Bookings, Leave, Tasks, Announcements). Changes apply
        immediately and persist across sessions on this browser.
      </p>

      <form onSubmit={onSubmit}>
        <div className="dash-grid dash-grid--2" style={{ gap: 'var(--space-3)' }}>
          <div className="form__row">
            <label className="form__label" htmlFor="profileDisplayName">
              Display name <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              id="profileDisplayName"
              className="form__input"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              maxLength={64}
              autoComplete="name"
              required
            />
            <span className="form__hint text-muted">Used across the app and on notifications.</span>
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="profileTitle">Title</label>
            <input
              id="profileTitle"
              className="form__input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. IT Team Lead, Clerk"
              maxLength={64}
              autoComplete="organization-title"
            />
            <span className="form__hint text-muted">e.g. IT Team Lead, Clerk, Executive Officer.</span>
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="profileTeam">
              Team <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              id="profileTeam"
              className="form__input"
              value={team}
              onChange={e => setTeam(e.target.value)}
              placeholder="e.g. IT Admin, Accounts, Facilities"
              maxLength={64}
              required
            />
            <span className="form__hint text-muted">Affects which team-wide views include you.</span>
          </div>

          <div className="form__row">
            <label className="form__label">Email</label>
            <input
              className="form__input"
              value={user.email || ''}
              readOnly
              aria-readonly="true"
              placeholder="(not set)"
            />
            <span className="form__hint text-muted">
              {user.source === 'SSO'
                ? 'Anchored to your Microsoft Entra identity. An admin can change it on the Users admin page.'
                : 'Read-only here. An admin can change it on the Users admin page.'}
            </span>
          </div>
        </div>

        {err && (
          <div className="alert alert--danger" style={{ marginTop: 12 }}>
            {escapeHtml(err)}
          </div>
        )}

        <div className="btn-row" style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="submit" className="btn" disabled={!valid || !dirty}>
            Save
          </button>
          <button type="button" className="btn btn--ghost" onClick={onReset} disabled={!dirty}>
            Reset
          </button>
          {savedAt && (
            <span className="text-muted text-sm">
              ✓ Saved · applies to this browser only
            </span>
          )}
          {!valid && (
            <span className="text-sm" style={{ color: 'var(--color-danger)' }}>
              Display name and team are required.
            </span>
          )}
        </div>
      </form>
    </section>
  );
}