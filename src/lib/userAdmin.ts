// User admin — enable/disable + role change with LS persistence, plus
// admin-created local users (also LS-backed). The USERS array is seeded
// but admin overrides live in localStorage so users can experiment
// without losing the seed.
//
// Two storage buckets:
//   1. engg_user_user_overrides  — id/enabled/role patches for SEED users
//   2. engg_user_created         — full LocalUser objects admins created
//                                  (id starts at 1000 to stay clear of seeds)
import type { User, Role } from './types';
import { USERS } from './data';

const LS_KEY_OVERRIDES = 'engg_user_user_overrides';
const LS_KEY_CREATED   = 'engg_user_created';

interface UserOverride {
  id: number;            // seed user id
  enabled: boolean;
  role: Role;
}

export interface CreatedLocalUser {
  id: number;
  username: string;
  displayName: string;
  team: string;
  title: string;
  role: Role;
  source: 'LOCAL';
  email?: string;
  enabled: boolean;
  morningTeamDigestEnabled: boolean;
  mondayTwoWeekLeaveReportEnabled: boolean;
}

function loadOverrides(): UserOverride[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY_OVERRIDES) || '[]'); } catch { return []; }
}
function persistOverrides(list: UserOverride[]): void {
  try { localStorage.setItem(LS_KEY_OVERRIDES, JSON.stringify(list)); } catch { /* ignore */ }
}

function loadCreated(): CreatedLocalUser[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY_CREATED) || '[]'); } catch { return []; }
}
function persistCreated(list: CreatedLocalUser[]): void {
  try { localStorage.setItem(LS_KEY_CREATED, JSON.stringify(list)); } catch { /* ignore */ }
}

function applySeedOverrides(users: User[]): User[] {
  const overrides = loadOverrides();
  return users.map(u => {
    const o = overrides.find(x => x.id === u.id);
    if (!o) return u;
    return { ...u, enabled: o.enabled, role: o.role };
  });
}

/** True if a user with this id originates from the seed USERS array (vs an
 *  admin-created local user stored in LS). */
export function isSeedUser(id: number): boolean {
  return USERS.some(u => u.id === id);
}

export const UserAdmin = {
  all(): User[] {
    return [...applySeedOverrides(USERS), ...loadCreated()];
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

  /** Create a new local user (persisted in LS). The id is allocated from
   *  1000+ so it never collides with seed USERS (max 21). Email is optional
   *  — useful when the admin later wants to "+ Allow SSO" for them. */
  createLocalUser(input: {
    displayName: string;
    username?: string;
    email?: string;
    role: Role;
    team?: string;
    title?: string;
    enabled?: boolean;
  }): User {
    const list = loadCreated();
    const seedMax = USERS.reduce((m, u) => Math.max(m, u.id), 0);
    const createdMax = list.reduce((m, u) => Math.max(m, u.id), 0);
    const nextId = Math.max(1000, createdMax + 1, seedMax + 1);
    const generated = (input.displayName || '')
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '.')
      .replace(/^\.+|\.+$/g, '');
    const u: CreatedLocalUser = {
      id: nextId,
      username: (((input.username ?? generated) || `user${nextId}`)).trim(),
      displayName: input.displayName.trim(),
      team: (input.team ?? '').trim() || 'Unassigned',
      title: (input.title ?? '').trim(),
      role: input.role,
      source: 'LOCAL',
      email: input.email?.trim() || undefined,
      enabled: input.enabled ?? true,
      morningTeamDigestEnabled: true,
      mondayTwoWeekLeaveReportEnabled: false
    };
    persistCreated([...list, u]);
    return u;
  },

  /** Delete an admin-created local user. Returns false when the id belongs
   *  to a seed user (use setEnabled(false) for those). */
  deleteLocalUser(id: number): boolean {
    if (isSeedUser(id)) return false;
    const list = loadCreated();
    const filtered = list.filter(u => u.id !== id);
    if (filtered.length === list.length) return false;
    persistCreated(filtered);
    return true;
  },

  /** Toggle enabled flag on an LS-created user. Returns false for seed
   *  users (use setEnabled for those) or unknown ids. */
  toggleCreatedEnabled(id: number, enabled: boolean): User | null {
    if (isSeedUser(id)) return null;
    const list = loadCreated();
    const idx = list.findIndex(u => u.id === id);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], enabled };
    persistCreated(list);
    return list[idx];
  },

  /** Change role on an LS-created user. Returns false for seed users. */
  setCreatedRole(id: number, role: Role): User | null {
    if (isSeedUser(id)) return null;
    const list = loadCreated();
    const idx = list.findIndex(u => u.id === id);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], role };
    persistCreated(list);
    return list[idx];
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
      auditors: list.filter(u => u.role === 'AUDITOR').length,
      seed: USERS.length,
      created: loadCreated().length
    };
  }
};
