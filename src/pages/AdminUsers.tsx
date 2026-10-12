// Admin users — list LOCAL/DEMO seed users + admin-managed SSO users.
//
// The two sources are rendered in one view:
//   - LOCAL/DEMO seed users: editable via the existing LS overlay
//     (`UserAdmin.setRole` / `setEnabled`) — no add/delete; the seed is part
//     of the source code, not the runtime.
//   - SSO users (source === 'SSO'): editable + deletable via /api/sso/users.
//     Admins add rows through the "+ Add SSO user" modal. Email is the
//     match key used by the FE bridge when an Azure ID-token comes back.
//
// Email column is shown for both. For seed users it's almost always empty —
// those accounts pre-date the email-as-identity bridge and are selectable
// only via the local /login picker.
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { UserAdmin } from '../lib/userAdmin';
import { SsoUsers, type SsoUserView } from '../lib/api/ssoUsers';
import { fmt, escapeHtml } from '../lib/app';
import type { User as AppUserT, Role as AppRoleT } from '../lib/types';

type SourceFilter = 'ALL' | 'LOCAL' | 'DEMO' | 'SSO';
type RoleFilter = AppRoleT | 'ALL';

export function AdminUsers() {
  const [, setRev] = useState(0);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<SourceFilter>('ALL');
  const [role, setRole] = useState<RoleFilter>('ALL');
  const [team, setTeam] = useState<string>('ALL');

  const [ssoUsers, setSsoUsers] = useState<SsoUserView[]>([]);
  const [ssoLoading, setSsoLoading] = useState(true);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [addingSso, setAddingSso] = useState(false);

  const reloadSso = async () => {
    setSsoLoading(true);
    setSsoError(null);
    try {
      const r = await SsoUsers.list();
      setSsoUsers(r.users);
    } catch (e: any) {
      setSsoError((e as Error)?.message || 'Failed to load SSO users');
    } finally {
      setSsoLoading(false);
    }
  };

  useEffect(() => { reloadSso(); }, []);

  const all = useMemo<AppUserT[]>(() => {
    // Seed users first (with overrides applied), then SSO users.
    return [...UserAdmin.all(), ...ssoUsers];
  }, [ssoUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    let l = all;
    if (source !== 'ALL') l = l.filter(u => u.source === source);
    if (role !== 'ALL')   l = l.filter(u => u.role === role);
    if (team !== 'ALL')   l = l.filter(u => u.team === team);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      l = l.filter(u =>
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.title.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q)
      );
    }
    return l.sort((a, b) =>
      a.team.localeCompare(b.team) ||
      a.displayName.localeCompare(b.displayName)
    );
  }, [all, search, role, team, source]);

  const counts = useMemo(() => {
    const seed = UserAdmin.all();
    const enabledCount = all.filter(u => u.enabled).length;
    return {
      total: all.length,
      enabled: enabledCount,
      disabled: all.length - enabledCount,
      admins: all.filter(u => u.role === 'ADMIN').length,
      taskManagers: all.filter(u => u.role === 'TASK_MANAGER').length,
      auditors: all.filter(u => u.role === 'AUDITOR').length,
      seed: seed.length,
      sso: ssoUsers.length
    };
  }, [all, ssoUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  const teams = useMemo(
    () => Array.from(new Set(all.map(u => u.team))).sort(),
    [all]
  );

  const onChange = () => setRev(v => v + 1);

  return (
    <AppShell title="Users">
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <div className="page-header__sub">
            {counts.total} total · {counts.enabled} enabled · {counts.admins} admins · {counts.taskManagers} task managers · {counts.auditors} auditors
            {' · '}
            <span className="text-muted">{counts.seed} seed + {counts.sso} SSO</span>
          </div>
        </div>
        <button className="btn" onClick={() => setAddingSso(true)}>+ Add SSO user</button>
      </div>

      {ssoError && (
        <div className="alert alert--danger" style={{ marginBottom: 12 }}>
          Failed to load SSO allowlist: {escapeHtml(ssoError)}.{' '}
          <button className="btn btn--ghost btn--sm" onClick={reloadSso}>Retry</button>
        </div>
      )}

      <div className="toolbar">
        <input
          className="form__input"
          style={{ maxWidth: 240 }}
          placeholder="🔎 Search name, username, title, email"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="text-muted text-sm">Source</span>
        <select className="form__select" style={{ width: 'auto' }} value={source} onChange={e => setSource(e.target.value as SourceFilter)}>
          <option value="ALL">All</option>
          <option value="LOCAL">LOCAL</option>
          <option value="DEMO">DEMO</option>
          <option value="SSO">SSO</option>
        </select>
        <span className="text-muted text-sm">Role</span>
        <select className="form__select" style={{ width: 'auto' }} value={role} onChange={e => setRole(e.target.value as RoleFilter)}>
          <option value="ALL">Any</option>
          <option value="USER">User</option>
          <option value="TASK_MANAGER">Task Manager</option>
          <option value="ADMIN">Administrator</option>
          <option value="AUDITOR">Auditor</option>
        </select>
        <span className="text-muted text-sm">Team</span>
        <select className="form__select" style={{ width: 'auto' }} value={team} onChange={e => setTeam(e.target.value)}>
          <option value="ALL">All teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {list.length === 0 ? (
        <div className="card empty">No users match your filters.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table table--hover">
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>Team</th><th>Title</th>
                  <th>Role</th><th>Source</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map(u => (
                  <Row
                    key={`${u.source}:${u.id}`}
                    u={u}
                    onChange={onChange}
                    onSsoChanged={reloadSso}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {addingSso && (
        <AddSsoModal
          onClose={() => setAddingSso(false)}
          onSaved={async () => { setAddingSso(false); await reloadSso(); }}
        />
      )}

      {ssoLoading && ssoUsers.length === 0 && (
        <div className="text-muted text-sm" style={{ marginTop: 8 }}>Loading SSO allowlist…</div>
      )}
    </AppShell>
  );
}

function Row({
  u,
  onChange,
  onSsoChanged
}: {
  u: AppUserT;
  onChange: () => void;
  onSsoChanged: () => Promise<void>;
}) {
  const isSso = u.source === 'SSO';
  const [editing, setEditing] = useState(false);

  const onToggleEnabled = async () => {
    if (isSso) {
      await SsoUsers.update(u.id, { enabled: !u.enabled });
      await onSsoChanged();
    } else {
      UserAdmin.setEnabled(u.id, !u.enabled);
      onChange();
    }
  };

  const onChangeRole = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as AppRoleT;
    if (isSso) {
      await SsoUsers.update(u.id, { role: next });
      await onSsoChanged();
    } else {
      UserAdmin.setRole(u.id, next);
      onChange();
    }
  };

  const onDelete = async () => {
    if (!confirm(`Delete SSO user "${u.displayName}" (${u.email})? This cannot be undone.`)) return;
    await SsoUsers.remove(u.id);
    await onSsoChanged();
  };

  const roleColor: Record<AppRoleT, string> = {
    USER: 'muted', TASK_MANAGER: 'primary', ADMIN: 'danger', AUDITOR: 'info'
  };
  const sourceColor: Record<AppUserT['source'], string> = {
    LOCAL: 'muted', DEMO: 'primary', SSO: 'info'
  };

  return (
    <>
      <tr>
        <td>
          <strong>{escapeHtml(u.displayName)}</strong>
          <div className="text-muted text-sm"><code>{escapeHtml(u.username)}</code></div>
        </td>
        <td>
          {u.email
            ? <code className="text-sm">{escapeHtml(u.email)}</code>
            : <span className="text-muted text-sm">—</span>}
        </td>
        <td>{escapeHtml(u.team)}</td>
        <td>{escapeHtml(u.title)}</td>
        <td>
          <select
            className={`form__select`}
            style={{ width: 'auto', padding: '2px 6px', fontSize: 13 }}
            value={u.role}
            onChange={onChangeRole}
            disabled={!isSso && false /* seed users stay editable in role */ && false}
          >
            <option value="USER">User</option>
            <option value="TASK_MANAGER">Task Manager</option>
            <option value="ADMIN">Administrator</option>
            <option value="AUDITOR">Auditor</option>
          </select>
          {' '}
          <span className={`badge badge--${roleColor[u.role]}`}>{fmt.role(u.role)}</span>
        </td>
        <td><span className={`badge badge--${sourceColor[u.source]}`}>{escapeHtml(u.source)}</span></td>
        <td>
          {u.enabled
            ? <span className="badge badge--success">Enabled</span>
            : <span className="badge badge--danger">Disabled</span>}
        </td>
        <td className="actions">
          <button className="btn btn--ghost btn--sm" onClick={onToggleEnabled}>
            {u.enabled ? 'Disable' : 'Enable'}
          </button>
          {isSso && (
            <>
              {' '}
              <button className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>Edit</button>
              {' '}
              <button className="btn btn--ghost btn--sm" style={{ color: 'var(--color-danger)' }} onClick={onDelete}>Delete</button>
            </>
          )}
        </td>
      </tr>
      {editing && isSso && (
        <EditSsoModal
          u={u as SsoUserView}
          onClose={() => setEditing(false)}
          onSaved={async () => { setEditing(false); await onSsoChanged(); }}
        />
      )}
    </>
  );
}

function AddSsoModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> | void }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRoleT>('USER');
  const [team, setTeam] = useState('SSO');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && displayName.trim().length > 0;

  const onSubmit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      await SsoUsers.create({
        email: email.trim(),
        displayName: displayName.trim(),
        role,
        team: team.trim() || 'SSO',
        title: title.trim(),
        enabled: true
      });
      await onSaved();
    } catch (e: any) {
      const msg = (e as Error)?.message || 'Failed to create';
      setErr(/409|already/i.test(msg) ? `Email "${email}" is already registered.` : msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Add SSO user" onClose={onClose}>
      <FormFields
        displayName={displayName} setDisplayName={setDisplayName}
        role={role} setRole={setRole}
        team={team} setTeam={setTeam}
        title={title} setTitle={setTitle}
        email={email} setEmail={setEmail}
      />
      {err && <div className="alert alert--danger" style={{ marginTop: 8 }}>{escapeHtml(err)}</div>}
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={!valid || submitting} onClick={onSubmit}>
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
      </div>
    </ModalShell>
  );
}

function EditSsoModal({ u, onClose, onSaved }: { u: SsoUserView; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const [displayName, setDisplayName] = useState(u.displayName);
  const [email, setEmail] = useState(u.email ?? '');
  const [role, setRole] = useState<AppRoleT>(u.role);
  const [team, setTeam] = useState(u.team);
  const [title, setTitle] = useState(u.title);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && displayName.trim().length > 0;

  const onSubmit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      await SsoUsers.update(u.id, {
        email: email.trim(),
        displayName: displayName.trim(),
        role,
        team: team.trim() || 'SSO',
        title: title.trim()
      });
      await onSaved();
    } catch (e: any) {
      const msg = (e as Error)?.message || 'Failed to save';
      setErr(/409|already/i.test(msg) ? `Email "${email}" is already registered.` : msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={`Edit SSO user — ${u.displayName}`} onClose={onClose}>
      <FormFields
        displayName={displayName} setDisplayName={setDisplayName}
        role={role} setRole={setRole}
        team={team} setTeam={setTeam}
        title={title} setTitle={setTitle}
        email={email} setEmail={setEmail}
      />
      {err && <div className="alert alert--danger" style={{ marginTop: 8 }}>{escapeHtml(err)}</div>}
      <div className="text-muted text-sm" style={{ marginTop: 8 }}>
        Last seen: {u.oid ? <code>{escapeHtml(u.oid)}</code> : <span>(never signed in)</span>}
        {' · '}id: <code>{u.id}</code>
      </div>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={!valid || submitting} onClick={onSubmit}>
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
      </div>
    </ModalShell>
  );
}

function FormFields(props: {
  displayName: string; setDisplayName: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  role: AppRoleT; setRole: (v: AppRoleT) => void;
  team: string; setTeam: (v: string) => void;
  title: string; setTitle: (v: string) => void;
}) {
  return (
    <>
      <div className="form__row">
        <label className="form__label" htmlFor="ssoEmail">Email <span style={{ color: 'var(--color-danger)' }}>*</span></label>
        <input
          id="ssoEmail"
          className="form__input"
          type="email"
          placeholder="tim.wong@rainbowtech.com.hk"
          value={props.email}
          onChange={e => props.setEmail(e.target.value)}
          autoComplete="off"
        />
        <span className="form__hint text-muted">Case-insensitive. Must match what Azure returns in the ID token.</span>
      </div>
      <div className="form__row">
        <label className="form__label" htmlFor="ssoDisplayName">Display name <span style={{ color: 'var(--color-danger)' }}>*</span></label>
        <input
          id="ssoDisplayName"
          className="form__input"
          value={props.displayName}
          onChange={e => props.setDisplayName(e.target.value)}
        />
      </div>
      <div className="form__row">
        <label className="form__label" htmlFor="ssoRole">Role</label>
        <select
          id="ssoRole"
          className="form__select"
          value={props.role}
          onChange={e => props.setRole(e.target.value as AppRoleT)}
        >
          <option value="USER">User</option>
          <option value="TASK_MANAGER">Task Manager</option>
          <option value="ADMIN">Administrator</option>
          <option value="AUDITOR">Auditor</option>
        </select>
      </div>
      <div className="form__row">
        <label className="form__label" htmlFor="ssoTeam">Team</label>
        <input
          id="ssoTeam"
          className="form__input"
          value={props.team}
          onChange={e => props.setTeam(e.target.value)}
        />
      </div>
      <div className="form__row">
        <label className="form__label" htmlFor="ssoTitle">Title</label>
        <input
          id="ssoTitle"
          className="form__input"
          value={props.title}
          onChange={e => props.setTitle(e.target.value)}
        />
      </div>
    </>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 'min(560px, 92vw)', maxHeight: '90vh', overflow: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{escapeHtml(title)}</h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}