// Server-side audit + system-log writers. Use these from any route
// handler that performs a privileged action so the admin pages at
// /admin/audit and /admin/system-logs reflect what actually happened.
//
// Both helpers swallow errors and log to console — the calling request
// must NEVER fail because the audit write failed. (Postgres is the
// same connection that served the action, so an audit write failing
// means the action itself probably failed too, and we already have
// HTTP-level signals for that.)

import { getPool } from './db.ts';

export type AuditAction =
  // Auth lifecycle
  | 'SSO_LOGIN_SUCCESS'
  | 'SSO_LOGIN_FAILURE'
  | 'SSO_LOGIN_DENIED'        // signed in but email not in allowlist
  | 'LOCAL_ADMIN_LOGIN'       // local_admin cookie minted
  | 'LOGOUT'
  | 'ADMIN_AUTH_FAILURE'      // requireAdmin 401
  // SSO allowlist CRUD
  | 'SSO_USER_CREATE'
  | 'SSO_USER_UPDATE'
  | 'SSO_USER_DELETE'
  // SSO config
  | 'SSO_CONFIG_UPDATE'
  // Holidays
  | 'HOLIDAY_ADD'
  | 'HOLIDAY_REMOVE'
  | 'HOLIDAY_IMPORT'
  | 'HOLIDAY_IMPORT_REMOVE'
  | 'HOLIDAY_RESET'
  // Email
  | 'EMAIL_IT_SUPPORT_SENT'
  | 'EMAIL_IT_SUPPORT_FAILED'
  | 'EMAIL_TEST_SENT'
  | 'EMAIL_TEST_FAILED';

export interface AuditParams {
  actorUsername: string;
  actorUserId: number | null;
  actionType: AuditAction | string;
  resourceType: string;
  resourceId?: string | number | null;
  summary: string;
  ipAddress?: string | null;
  success?: boolean;
}

export async function logAudit(p: AuditParams): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO audit_events
         (actor_username, actor_user_id, action_type, resource_type, resource_id, summary, ip_address, success)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        p.actorUsername,
        p.actorUserId,
        p.actionType,
        p.resourceType,
        p.resourceId == null ? '' : String(p.resourceId),
        p.summary,
        p.ipAddress ?? '',
        p.success !== false
      ]
    );
  } catch (e) {
    // Never let audit failures break the request.
    console.error('[audit] failed to log', p.actionType, p.summary, e);
  }
}

export type SystemLevel = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export async function logSystem(
  level: SystemLevel,
  category: string,
  message: string,
  detail?: string
): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO system_logs (level, category, message, detail)
       VALUES ($1, $2, $3, $4)`,
      [level, category, message, detail ?? '']
    );
  } catch (e) {
    console.error('[syslog] failed to log', category, message, e);
  }
}
