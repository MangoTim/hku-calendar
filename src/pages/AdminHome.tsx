// Admin home — overview counts + quick links to admin sections.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Rooms } from '../lib/rooms';
import { Tasks } from '../lib/tasks';
import { Bookings } from '../lib/bookings';
import { Leave } from '../lib/leave';
import { Announcements } from '../lib/announcements';
import { Settings } from '../lib/settings';
import { AuditEvents, SystemLogs, apiHealth } from '../lib/audit';
import { USERS, SSO_CONFIG } from '../lib/data';

export function AdminHome() {
  const totalRooms = Rooms.all().length;
  const activeRooms = Rooms.active().length;
  const totalTasks = Tasks.all().length;
  const totalBookings = Bookings.all().length;
  const totalLeave = Leave.all().length;
  const totalAnnouncements = Announcements.all().length;
  const totalUsers = USERS.length;
  const enabledUsers = USERS.filter(u => u.enabled).length;

  const [auditCount, setAuditCount] = useState<number>(0);
  const [logCount, setLogCount] = useState<number>(0);
  const [apiStatus, setApiStatus] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    apiHealth().then(setApiStatus);
    Promise.all([AuditEvents.all().catch(() => []), SystemLogs.all().catch(() => [])])
      .then(([a, l]) => { setAuditCount(a.length); setLogCount(l.length); });
  }, []);

  return (
    <AppShell title="Admin">
      <div className="page-header">
        <div>
          <h1>Admin console</h1>
          <div className="page-header__sub">
            Single-user demo · all changes persist to this browser's localStorage
          </div>
        </div>
      </div>

      <div className="dash-grid dash-grid--3">
        <StatCard title="Users" value={enabledUsers} sub={`${totalUsers} total · ${totalUsers - enabledUsers} disabled`} to="/admin/users" />
        <StatCard title="Rooms" value={activeRooms} sub={`${totalRooms} total · ${totalRooms - activeRooms} inactive`} to="/admin/rooms" />
        <StatCard title="Tasks" value={totalTasks} sub="across all teams" to="/tasks" />
        <StatCard title="Bookings" value={totalBookings} sub="confirmed + cancelled" to="/bookings" />
        <StatCard title="Leave entries" value={totalLeave} sub="approved + cancelled" to="/leave" />
        <StatCard title="Announcements" value={totalAnnouncements} sub="posted to date" to="/announcements" />
        <StatCard title="Audit events" value={auditCount} sub={`live from .103${apiStatus ? '' : ' (loading)'}`} to="/admin/audit" />
        <StatCard title="System logs" value={logCount} sub="info/warn/error" to="/admin/system-logs" />
        <StatCard title="Unread notifications" value={0} sub="(your own)" to="/notifications" />
      </div>

      <section className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Quick links</h2>
        <div className="btn-row">
          <Link className="btn" to="/admin/rooms">🚪 Manage rooms</Link>
          <Link className="btn" to="/admin/users">👥 Manage users</Link>
          <Link className="btn" to="/admin/task-settings">⏱️ Task settings</Link>
          <Link className="btn" to="/admin/holidays">🗓️ Holidays</Link>
          <Link className="btn" to="/admin/sso">🔐 Identity & SSO</Link>
          <Link className="btn" to="/admin/database">🗄️ Database</Link>
          <Link className="btn" to="/admin/backup">💾 Backup</Link>
          <Link className="btn" to="/admin/audit">📜 Audit trail</Link>
          <Link className="btn" to="/admin/system-logs">🧾 System logs</Link>
        </div>
      </section>

      <section className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>System status</h2>
        <table className="table">
          <tbody>
            <tr>
              <th>Audit API (8092)</th>
              <td>
                {apiStatus === null
                  ? <span className="text-muted text-sm">checking…</span>
                  : apiStatus.ok
                    ? <><span className="badge badge--success">ONLINE</span> <code>postgresql://postgres@192.168.147.103/engg_intranet</code></>
                    : <><span className="badge badge--danger">OFFLINE</span> {apiStatus.detail} <span className="text-muted text-sm">(run <code>cd server && bun run src/index.ts</code>)</span></>}
              </td>
            </tr>
            <tr><th>Identity & SSO</th><td>{SSO_CONFIG.mode} ({SSO_CONFIG.directoryMode}) — last test: {SSO_CONFIG.lastTestedAt || 'never'}</td></tr>
            <tr><th>Database</th><td>{Settings.databaseConfig().dbType} — last test: {Settings.databaseConfig().lastTestedAt ? Settings.databaseConfig().lastTestResult : 'never'}</td></tr>
            <tr><th>Backup</th><td>{(() => { const b = Settings.backupConfig(); return b.enabled ? `${b.frequency} @ ${b.hourOfDay}:00` : 'Disabled'; })()} — last: {Settings.backupConfig().lastBackupAt || 'never'}</td></tr>
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}

function StatCard({ title, value, sub, to }: { title: string; value: number; sub: string; to: string }) {
  return (
    <Link className="card stat-card" to={to} style={{ textDecoration: 'none' }}>
      <div className="text-muted text-sm">{title}</div>
      <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      <div className="text-muted text-sm" style={{ marginTop: 4 }}>{sub}</div>
    </Link>
  );
}