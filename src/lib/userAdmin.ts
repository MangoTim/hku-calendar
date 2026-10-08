// User admin — enable/disable + role change with LS persistence.
// The USERS array is seeded but admin overrides live in localStorage so users
// can experiment without losing the seed.
import type { User, Role } from './types';
import { USERS } from './data';

const LS_KEY = 'engg_user_user_overrides';

interface UserOverride {
  id: number;
  enabled: boolean;
  role: Role;
}

function loadOverrides(): UserOverride[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function persistOverrides(list: UserOverride[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function applyOverrides(users: User[]): User[] {
  const overrides = loadOverrides();
  return users.map(u => {
    const o = overrides.find(x => x.id === u.id);
    if (!o) return u;
    return { ...u, enabled: o.enabled, role: o.role };
  });
}

export const UserAdmin = {
  all(): User[] {
    return applyOverrides(USERS);
  },
  byId(id: number): User | undefined {
    return this.all().find(u => u.id === id);
  },

  setEnabled(userId: number, enabled: boolean): User | null {
    const list = loadOverrides();
    let entry = list.find(o => o.id === userId);
    const target = USERS.find(u => u.id === userId);
    if (!target) return null;
    if (!entry) {
      entry = { id: userId, enabled: target.enabled, role: target.role };
      list.push(entry);
    }
    entry.enabled = enabled;
    persistOverrides(list);
    return { ...target, enabled };
  },

  setRole(userId: number, role: Role): User | null {
    const list = loadOverrides();
    let entry = list.find(o => o.id === userId);
    const target = USERS.find(u => u.id === userId);
    if (!target) return null;
    if (!entry) {
      entry = { id: userId, enabled: target.enabled, role: target.role };
      list.push(entry);
    }
    entry.role = role;
    persistOverrides(list);
    return { ...target, role };
  },

  rolesAll(): Role[] {
    return ['USER', 'TASK_MANAGER', 'ADMIN', 'AUDITOR'];
  },

  counts() {
    const list = this.all();
    return {
      total: list.length,
      enabled: list.filter(u => u.enabled).length,
      disabled: list.filter(u => !u.enabled).length,
      admins: list.filter(u => u.role === 'ADMIN').length,
      taskManagers: list.filter(u => u.role === 'TASK_MANAGER').length,
      auditors: list.filter(u => u.role === 'AUDITOR').length
    };
  }
};