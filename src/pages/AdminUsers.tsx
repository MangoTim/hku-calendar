// Admin users — list + enable/disable + role change.
import { useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { UserAdmin } from '../lib/userAdmin';
import { fmt, escapeHtml } from '../lib/app';
import type { User, Role } from '../lib/types';

type SourceFilter = 'ALL' | 'LOCAL' | 'DEMO';
type RoleFilter = Role | 'ALL';

export function AdminUsers() {
  const [, setRev] = useState(0);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<SourceFilter>('ALL');
  const [role, setRole] = useState<RoleFilter>('ALL');
  const [team, setTeam] = useState<string>('ALL');

  const list = useMemo(() => {
    let l = UserAdmin.all();
    if (source !== 'ALL') l = l.filter(u => u.source === source);
    if (role !== 'ALL')   l = l.filter(u => u.role === role);
    if (team !== 'ALL')   l = l.filter(u => u.team === team);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      l = l.filter(u =>
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.title.toLowerCase().includes(q)
      );
    }
    return l.sort((a, b) => a.team.localeCompare(b.team) || a.displayName.localeCompare(b.displayName));
  }, [search, role, team, source]);

  const counts = UserAdmin.counts();
  const teams = useMemo(
    () => Array.from(new Set(UserAdmin.all().map(u => u.team))).sort(),
    []
  );

  return (
    <AppShell title="Users">
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <div className="page-header__sub">
            {counts.total} total · {counts.enabled} enabled · {counts.admins} admins · {counts.taskManagers} task managers · {counts.auditors} auditors
          </div>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="form__input"
          style={{ maxWidth: 240 }}
          placeholder="🔎 Search name, username, title"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="text-muted text-sm">Source</span>
        <select className="form__select" style={{ width: 'auto' }} value={source} onChange={e => setSource(e.target.value as SourceFilter)}>
          <option value="ALL">All</option>
          <option value="LOCAL">LOCAL</option>
          <option value="DEMO">DEMO</option>
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
                  <th>Name</th><th>Team</th><th>Title</th>
                  <th>Role</th><th>Source</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map(u => <Row key={u.id} u={u} onChange={() => setRev(v => v + 1)} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Row({ u, onChange }: { u: User; onChange: () => void }) {
  const onToggleEnabled = () => {
    UserAdmin.setEnabled(u.id, !u.enabled);
    onChange();
  };
  const onChangeRole = (e: React.ChangeEvent<HTMLSelectElement>) => {
    UserAdmin.setRole(u.id, e.target.value as Role);
    onChange();
  };
  const roleColor: Record<Role, string> = {
    USER: 'muted', TASK_MANAGER: 'primary', ADMIN: 'danger', AUDITOR: 'info'
  };
  return (
    <tr>
      <td>
        <strong>{escapeHtml(u.displayName)}</strong>
        <div className="text-muted text-sm"><code>{escapeHtml(u.username)}</code></div>
      </td>
      <td>{escapeHtml(u.team)}</td>
      <td>{escapeHtml(u.title)}</td>
      <td>
        <select
          className={`form__select`}
          style={{ width: 'auto', padding: '2px 6px', fontSize: 13 }}
          value={u.role}
          onChange={onChangeRole}
        >
          <option value="USER">User</option>
          <option value="TASK_MANAGER">Task Manager</option>
          <option value="ADMIN">Administrator</option>
          <option value="AUDITOR">Auditor</option>
        </select>
        {' '}
        <span className={`badge badge--${roleColor[u.role]}`}>{fmt.role(u.role)}</span>
      </td>
      <td><span className="badge badge--muted">{escapeHtml(u.source)}</span></td>
      <td>
        {u.enabled
          ? <span className="badge badge--success">Enabled</span>
          : <span className="badge badge--danger">Disabled</span>}
      </td>
      <td className="actions">
        <button className="btn btn--ghost btn--sm" onClick={onToggleEnabled}>
          {u.enabled ? 'Disable' : 'Enable'}
        </button>
      </td>
    </tr>
  );
}