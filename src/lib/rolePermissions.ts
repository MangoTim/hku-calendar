// rolePermissions — capability matrix used by /admin/users as a guide
// when assigning roles. The matrix is the single source of truth: any
// role-gating in the rest of the app reads from ROLE in lib/app.ts, which
// matches these descriptions. If you change a capability here, make sure
// the corresponding gate in lib/app.ts / App.tsx still reflects it.
//
// The "intensity" of each role grows left-to-right. ADMIN inherits
// everything TASK_MANAGER can do plus the admin-only tools; AUDITOR is a
// read-only compliance role (audit/system logs only).
import type { Role } from './types';

export type Capability =
  | 'view_dashboard'
  | 'view_bookings'
  | 'view_leave'
  | 'view_tasks'
  | 'view_announcements'
  | 'view_notifications'
  | 'edit_profile'
  | 'create_own_booking'
  | 'create_own_leave'
  | 'update_own_task_progress'
  | 'post_announcement'
  | 'manage_announcement_others'
  | 'assign_tasks'
  | 'view_team_bookings'
  | 'view_team_leave'
  | 'view_team_tasks'
  | 'manage_rooms'
  | 'manage_users'
  | 'manage_sso_allowlist'
  | 'manage_task_settings'
  | 'manage_holidays'
  | 'manage_database'
  | 'manage_sso_config'
  | 'manage_backup'
  | 'manage_support'
  | 'manage_email_config'
  | 'view_audit_log'
  | 'view_system_logs';

export interface RolePermission {
  key: Role;
  label: string;
  blurb: string;            // 1-line role summary, shown as the card header
  audience: string;         // who this role is intended for (from RFQ §3)
  capabilities: Capability[];
}

/**
 * Ordered as the dropdown in /admin/users. Insert a new entry to add a
 * role; Capability union above is what gates are written against.
 */
export const ROLE_PERMISSIONS: RolePermission[] = [
  {
    key: 'USER',
    label: 'User',
    audience: 'Faculty Office Staff (Normal User)',
    blurb: 'Day-to-day operations for individual staff: view dashboards, file bookings and leave, update own task progress.',
    capabilities: [
      'view_dashboard', 'view_bookings', 'view_leave', 'view_tasks',
      'view_announcements', 'view_notifications', 'edit_profile',
      'create_own_booking', 'create_own_leave', 'update_own_task_progress'
    ]
  },
  {
    key: 'TASK_MANAGER',
    label: 'Task Manager',
    audience: 'Task Manager (Supervisor)',
    blurb: 'Everything a User can do, plus supervising a team: assign tasks, post announcements, view team-wide bookings/leave/tasks.',
    capabilities: [
      'view_dashboard', 'view_bookings', 'view_leave', 'view_tasks',
      'view_announcements', 'view_notifications', 'edit_profile',
      'create_own_booking', 'create_own_leave', 'update_own_task_progress',
      'post_announcement', 'manage_announcement_others',
      'assign_tasks',
      'view_team_bookings', 'view_team_leave', 'view_team_tasks'
    ]
  },
  {
    key: 'ADMIN',
    label: 'Administrator',
    audience: 'Faculty Office IT Team (Administrator)',
    blurb: 'Everything a Task Manager can do, plus the admin toolkit: rooms, users, SSO, holidays, DB, backup, support, email, and audit access.',
    capabilities: [
      'view_dashboard', 'view_bookings', 'view_leave', 'view_tasks',
      'view_announcements', 'view_notifications', 'edit_profile',
      'create_own_booking', 'create_own_leave', 'update_own_task_progress',
      'post_announcement', 'manage_announcement_others',
      'assign_tasks',
      'view_team_bookings', 'view_team_leave', 'view_team_tasks',
      'manage_rooms', 'manage_users', 'manage_sso_allowlist',
      'manage_task_settings', 'manage_holidays', 'manage_database',
      'manage_sso_config', 'manage_backup', 'manage_support', 'manage_email_config',
      'view_audit_log', 'view_system_logs'
    ]
  },
  {
    key: 'AUDITOR',
    label: 'Auditor',
    audience: 'Compliance / Audit (read-only)',
    blurb: 'Read-only compliance role: view audit log and system logs. No day-to-day operational powers.',
    capabilities: [
      'view_dashboard', 'view_bookings', 'view_leave', 'view_tasks',
      'view_announcements', 'view_notifications', 'edit_profile',
      'view_audit_log', 'view_system_logs'
    ]
  }
];

const byKey: Record<Role, RolePermission> = ROLE_PERMISSIONS.reduce(
  (acc, r) => { acc[r.key] = r; return acc; },
  {} as Record<Role, RolePermission>
);

export function getRolePermission(role: Role): RolePermission {
  return byKey[role] ?? ROLE_PERMISSIONS[0];
}

/** Capability labels grouped by section, for the renderable matrix. */
export const CAPABILITY_GROUPS: { title: string; items: { key: Capability; label: string }[] }[] = [
  {
    title: 'Day-to-day',
    items: [
      { key: 'view_dashboard',          label: 'View dashboard, profile, notifications' },
      { key: 'view_bookings',           label: 'View room bookings (list, detail, calendar)' },
      { key: 'view_leave',              label: 'View leave records' },
      { key: 'view_tasks',              label: 'View tasks' },
      { key: 'view_announcements',      label: 'View announcements' },
      { key: 'edit_profile',            label: 'Edit own profile settings' },
      { key: 'create_own_booking',      label: 'Create / edit own room bookings' },
      { key: 'create_own_leave',        label: 'File own leave' },
      { key: 'update_own_task_progress', label: 'Update progress on assigned tasks' }
    ]
  },
  {
    title: 'Team supervision',
    items: [
      { key: 'post_announcement',       label: 'Post announcements / file sharing' },
      { key: 'manage_announcement_others', label: 'Edit or delete other people’s announcements' },
      { key: 'assign_tasks',            label: 'Assign tasks to other users' },
      { key: 'view_team_bookings',      label: 'See team-wide bookings (cross-team)' },
      { key: 'view_team_leave',         label: 'See team-wide leave (cross-team)' },
      { key: 'view_team_tasks',         label: 'See team-wide tasks (cross-team)' }
    ]
  },
  {
    title: 'Admin toolkit',
    items: [
      { key: 'manage_rooms',            label: 'Manage rooms (add / edit / disable)' },
      { key: 'manage_users',            label: 'Manage user roles and enabled flag' },
      { key: 'manage_sso_allowlist',    label: 'Add / edit / delete SSO allowlist' },
      { key: 'manage_task_settings',    label: 'Task settings (e.g. deadline thresholds)' },
      { key: 'manage_holidays',         label: 'Holiday calendar / imports' },
      { key: 'manage_database',         label: 'Database connection settings' },
      { key: 'manage_sso_config',       label: 'SSO / Microsoft Entra configuration' },
      { key: 'manage_backup',           label: 'Backup & restore' },
      { key: 'manage_support',          label: 'IT support email templates' },
      { key: 'manage_email_config',     label: 'Email server configuration' }
    ]
  },
  {
    title: 'Compliance (read-only)',
    items: [
      { key: 'view_audit_log',          label: 'View audit log' },
      { key: 'view_system_logs',        label: 'View system logs' }
    ]
  }
];

export function roleCan(role: Role, capability: Capability): boolean {
  return getRolePermission(role).capabilities.includes(capability);
}