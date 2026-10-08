// Announcements module — simple CRUD with LS persistence.
// Seeded from /assets/js/data.js ANNOUNCEMENTS array.
import type { Announcement } from './types';
import { ANNOUNCEMENTS } from './data';
import { fmt } from './app';

const LS_KEY = 'engg_user_announcements';

function loadUser(): Announcement[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function persistUser(list: Announcement[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

// Last-wins dedup by id (mirrors Tasks/Bookings/Leave pattern)
function mergeWithUser<T extends { id: number }>(seed: T[], user: T[]): T[] {
  const byId = new Map<number, T>();
  for (const item of user) byId.set(item.id, item);
  const userDedupe = Array.from(byId.values());
  const userIds = new Set(userDedupe.map(x => x.id));
  const seedOnly = seed.filter(x => !userIds.has(x.id));
  return [...seedOnly, ...userDedupe];
}

export const Announcements = {
  all(): Announcement[] {
    return mergeWithUser(ANNOUNCEMENTS, loadUser());
  },
  byId(id: number | string): Announcement | undefined {
    return this.all().find(a => a.id === Number(id));
  },
  nextId(): number {
    return this.all().reduce((acc, a) => Math.max(acc, a.id || 0), 0) + 1;
  },

  // Sorted newest-first by createdAt
  sorted(): Announcement[] {
    return [...this.all()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  // Search by title or body (case-insensitive substring)
  search(query: string): Announcement[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.sorted();
    return this.sorted().filter(a =>
      a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)
    );
  },

  validate(input: Partial<Announcement>): { ok: true } | { ok: false; error: string } {
    if (!input.title || !input.title.trim()) return { ok: false, error: 'Title is required.' };
    if (input.title.length > 200) return { ok: false, error: 'Title must be ≤ 200 characters.' };
    if (!input.body || !input.body.trim()) return { ok: false, error: 'Body is required.' };
    if (input.body.length > 4000) return { ok: false, error: 'Body must be ≤ 4000 characters.' };
    if (input.fileUrl && input.fileUrl.length > 500) return { ok: false, error: 'File URL must be ≤ 500 characters.' };
    if (input.fileLabel && input.fileLabel.length > 200) return { ok: false, error: 'File label must be ≤ 200 characters.' };
    if (!input.postedById) return { ok: false, error: 'No user in session.' };
    return { ok: true };
  },

  create(input: Omit<Announcement, 'id' | 'createdAt'>): Announcement {
    const list = loadUser();
    const full: Announcement = {
      ...input,
      title: input.title.trim(),
      body: input.body.trim(),
      fileUrl: input.fileUrl || '',
      fileLabel: input.fileLabel || '',
      id: this.nextId(),
      createdAt: new Date().toISOString()
    };
    list.push(full);
    persistUser(list);
    return full;
  },

  update(id: number | string, patch: Partial<Announcement>): Announcement | null {
    const all = this.all();
    const i = all.findIndex(a => a.id === Number(id));
    if (i < 0) return null;
    const target = all[i];
    const merged: Announcement = { ...target, ...patch };

    const userList = mergeWithUser([], loadUser());
    const ui = userList.findIndex(a => a.id === Number(id));
    if (ui >= 0) userList[ui] = merged;
    else userList.push(merged);
    persistUser(userList);
    return merged;
  },

  remove(id: number | string): boolean {
    const userList = mergeWithUser([], loadUser());
    const ui = userList.findIndex(a => a.id === Number(id));
    if (ui < 0) return false;
    userList.splice(ui, 1);
    persistUser(userList);
    return true;
  },

  // Format helpers for use in pages
  formatPostDate: (createdAt: string) => fmt.dateTime(createdAt),
  formatShortDate: (createdAt: string) => fmt.dateLong(createdAt)
};