// Sidebar — role-based nav. Mirrors app.js renderSidebar.
// On mobile the sidebar is hidden off-screen until the hamburger in Topbar opens it;
// `open` + `onClose` drive the slide-in.
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface NavItem { to: string; label: string; icon: string; }

const STAFF_ITEMS: NavItem[] = [
  { to: '/dashboard',          label: 'Dashboard',     icon: '🏠' },
  { to: '/bookings',           label: 'Bookings',      icon: '📅' },
  { to: '/leave',              label: 'Leave',         icon: '🏖️' },
  { to: '/tasks',              label: 'Tasks',         icon: '✅' },
  { to: '/announcements',      label: 'Announcements', icon: '📣' },
  { to: '/notifications',      label: 'Notifications', icon: '🔔' },
  { to: '/profile',            label: 'Profile',       icon: '👤' }
];

const ADMIN_ITEMS: NavItem[] = [
  { to: '/admin',              label: 'Admin home',     icon: '🛠️' },
  { to: '/admin/rooms',        label: 'Rooms',          icon: '🚪' },
  { to: '/admin/users',        label: 'Users',          icon: '👥' },
  { to: '/admin/sso',          label: 'Identity & SSO', icon: '🔐' },
  { to: '/admin/database',     label: 'Database',       icon: '🗄️' },
  { to: '/admin/backup',       label: 'Backup',         icon: '💾' },
  { to: '/admin/holidays',     label: 'Holidays',       icon: '🗓️' },
  { to: '/admin/task-settings',label: 'Task settings',  icon: '⏱️' }
];

const AUDIT_ITEMS: NavItem[] = [
  { to: '/admin/audit',        label: 'Audit trail',    icon: '📜' },
  { to: '/admin/system-logs',  label: 'System logs',    icon: '🧾' }
];

function NavGroup({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate?: () => void }) {
  return (
    <div className="sidebar__group">
      <div className="sidebar__group-title">{title}</div>
      <div className="sidebar__nav">
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) => `sidebar__link ${isActive ? 'is-active' : ''}`}
          >
            <span className="ic" aria-hidden="true">{item.icon}</span>{item.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ROLE } = useAuth();
  return (
    <aside id="appSidebar" className={`app__sidebar ${open ? 'app__sidebar--open' : ''}`}>
      <div className="sidebar__brand">
        <span className="brand-mark">U</span>
        <span>HKU · ENGG Intranet</span>
      </div>
      <NavGroup title="Workspace" items={STAFF_ITEMS} onNavigate={onClose} />
      {ROLE.isAdmin() && <NavGroup title="Admin" items={ADMIN_ITEMS} onNavigate={onClose} />}
      {ROLE.canSeeAudit() && <NavGroup title="Compliance" items={AUDIT_ITEMS} onNavigate={onClose} />}
      <div className="sidebar__spacer"></div>
      <div className="sidebar__footer">v0928 · Demo · Single-user</div>
    </aside>
  );
}
