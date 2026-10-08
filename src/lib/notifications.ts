// Notifications module — list, mark read, mark all read.
// Notifications are seeded per-user and can only be marked read/unread (no create/edit in UI).
import type { Notification } from './types';
import { NOTIFICATIONS } from './data';

type NotificationState = { id: number; recipientId: number; read: boolean };
const LS_KEY = 'engg_user_notification_state';

function loadUser(): NotificationState[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function persistUser(list: NotificationState[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function getStateMap(): Map<number, boolean> {
  const map = new Map<number, boolean>();
  for (const s of loadUser()) map.set(s.id, s.read);
  return map;
}

export const Notifications = {
  // All notifications, with current read-state applied
  all(): Notification[] {
    const stateMap = getStateMap();
    return NOTIFICATIONS.map(n => ({
      ...n,
      read: stateMap.has(n.id) ? stateMap.get(n.id)! : n.read
    }));
  },
  // Filtered for current user
  forUser(userId: number): Notification[] {
    return this.all().filter(n => n.recipientId === userId);
  },
  unreadCount(userId: number): number {
    return this.forUser(userId).filter(n => !n.read).length;
  },
  // Sort newest first
  sorted(list: Notification[]): Notification[] {
    return [...list].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  markRead(id: number): Notification | void {
    const target = NOTIFICATIONS.find(n => n.id === id);
    if (!target) return;
    const list = loadUser();
    const existing = list.find(s => s.id === id);
    if (existing) {
      existing.read = true;
    } else {
      list.push({ id, recipientId: target.recipientId, read: true });
    }
    persistUser(list);
    return { ...target, read: true };
  },
  markUnread(id: number): Notification | void {
    const target = NOTIFICATIONS.find(n => n.id === id);
    if (!target) return;
    const list = loadUser();
    const existing = list.find(s => s.id === id);
    if (existing) {
      existing.read = false;
    } else {
      list.push({ id, recipientId: target.recipientId, read: false });
    }
    persistUser(list);
    return { ...target, read: false };
  },
  markAllRead(userId: number): number {
    const list = loadUser();
    let count = 0;
    for (const n of NOTIFICATIONS) {
      if (n.recipientId !== userId || n.read) continue;
      const existing = list.find(s => s.id === n.id);
      if (existing) {
        if (!existing.read) { existing.read = true; count++; }
      } else {
        list.push({ id: n.id, recipientId: userId, read: true });
        count++;
      }
    }
    persistUser(list);
    return count;
  }
};