// HKU ENGG Intranet — App helpers (port of static /assets/js/app.js)
// Session · role guard · formatters · date helpers
import type { Role, User, Session as SessionType } from './types';

const SESSION_KEY = 'engg_intranet_session';

// ---------------- Session ----------------
export const Session: {
  get(): SessionType | null;
  set(user: User): SessionType;
  clear(): void;
  is(role: Role): boolean;
  isAny(...roles: Role[]): boolean;
} = {
  get(): SessionType | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(user: User): SessionType {
    const session: SessionType = {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      team: user.team,
      title: user.title,
      source: user.source,
      loggedInAt: new Date().toISOString()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  },
  clear(): void {
    localStorage.removeItem(SESSION_KEY);
  },
  is(role: Role): boolean {
    const s = this.get();
    return !!s && s.role === role;
  },
  isAny(...roles: Role[]): boolean {
    const s = this.get();
    return !!s && roles.includes(s.role);
  }
} as const;

// ---------------- Role helpers ----------------
export const ROLE = {
  isUser:        () => Session.is('USER'),
  isTaskManager: () => Session.is('TASK_MANAGER'),
  isAdmin:       () => Session.is('ADMIN'),
  isAuditor:     () => Session.is('AUDITOR'),
  canAssignTasks: () => Session.isAny('TASK_MANAGER', 'ADMIN'),
  isUpper:        () => Session.isAny('TASK_MANAGER', 'ADMIN'),
  canSeeAudit:    () => Session.isAny('ADMIN', 'AUDITOR'),
  isDeanTitle:    () => {
    const s = Session.get();
    return !!s && /dean/i.test(s.title);
  }
};

// ---------------- Formatters ----------------
export const fmt = {
  date(d: string | null | undefined): string {
    if (!d) return '';
    const x = new Date(d);
    return isNaN(x.getTime()) ? d : x.toISOString().slice(0, 10);
  },
  dateLong(d: string | null | undefined): string {
    if (!d) return '';
    const x = new Date(d);
    if (isNaN(x.getTime())) return d;
    return x.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  },
  dateTime(d: string | null | undefined): string {
    if (!d) return '';
    const x = new Date(d);
    if (isNaN(x.getTime())) return d;
    return x.toLocaleString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  },
  timeRange(a: string, b: string): string {
    return `${a} – ${b}`;
  },
  initials(name: string | null | undefined): string {
    if (!name) return '?';
    const parts = name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase();
  },
  role(role: string | null | undefined): string {
    return ({
      USER: 'User', TASK_MANAGER: 'Task Manager',
      ADMIN: 'Administrator', AUDITOR: 'Auditor'
    } as Record<string, string>)[role || ''] || role || '';
  }
};

// ---------------- Date helpers ----------------
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
export function addDaysISO(dateISO: string, n: number): string {
  const d = new Date(dateISO);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
export function localISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
export function isPast(d: string): boolean {
  return new Date(d + 'T00:00:00') < new Date(todayISO() + 'T00:00:00');
}
export function isToday(d: string): boolean {
  return d === todayISO();
}

// ---------------- HTML helpers ----------------
export function escapeHtml(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
