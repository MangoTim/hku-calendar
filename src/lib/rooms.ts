// Rooms module — CRUD with LS persistence. ADMIN-only edits.
import type { Room } from './types';
import { ROOMS } from './data';

const LS_KEY = 'engg_user_rooms';

function loadUser(): Room[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function persistUser(list: Room[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function mergeWithUser<T extends { id: number }>(seed: T[], user: T[]): T[] {
  const byId = new Map<number, T>();
  for (const item of user) byId.set(item.id, item);
  const userDedupe = Array.from(byId.values());
  const userIds = new Set(userDedupe.map(x => x.id));
  const seedOnly = seed.filter(x => !userIds.has(x.id));
  return [...seedOnly, ...userDedupe];
}

export const Rooms = {
  all(): Room[] {
    return mergeWithUser(ROOMS, loadUser());
  },
  byId(id: number | string): Room | undefined {
    return this.all().find(r => r.id === Number(id));
  },
  nextId(): number {
    return this.all().reduce((acc, r) => Math.max(acc, r.id || 0), 0) + 1;
  },
  active(): Room[] {
    return this.all().filter(r => r.active);
  },

  validate(input: Partial<Room>): { ok: true } | { ok: false; error: string } {
    if (!input.name || !input.name.trim()) return { ok: false, error: 'Room name is required.' };
    if (input.name.length > 100) return { ok: false, error: 'Room name must be ≤ 100 characters.' };
    if (!input.building || !input.building.trim()) return { ok: false, error: 'Building is required.' };
    if (input.building.length > 100) return { ok: false, error: 'Building must be ≤ 100 characters.' };
    if (typeof input.maxSeats !== 'number' || input.maxSeats < 1 || input.maxSeats > 500) {
      return { ok: false, error: 'Max seats must be between 1 and 500.' };
    }
    if (input.notes && input.notes.length > 500) return { ok: false, error: 'Notes must be ≤ 500 characters.' };
    return { ok: true };
  },

  create(input: Omit<Room, 'id'>): Room {
    const list = loadUser();
    const full: Room = {
      ...input,
      name: input.name.trim(),
      building: input.building.trim(),
      notes: input.notes || '',
      id: this.nextId()
    };
    list.push(full);
    persistUser(list);
    return full;
  },

  update(id: number | string, patch: Partial<Room>): Room | null {
    const all = this.all();
    const i = all.findIndex(r => r.id === Number(id));
    if (i < 0) return null;
    const target = all[i];
    const merged: Room = { ...target, ...patch };
    const userList = mergeWithUser([], loadUser());
    const ui = userList.findIndex(r => r.id === Number(id));
    if (ui >= 0) userList[ui] = merged;
    else userList.push(merged);
    persistUser(userList);
    return merged;
  },

  remove(id: number | string): boolean {
    const userList = mergeWithUser([], loadUser());
    const ui = userList.findIndex(r => r.id === Number(id));
    if (ui < 0) return false;
    userList.splice(ui, 1);
    persistUser(userList);
    return true;
  }
};