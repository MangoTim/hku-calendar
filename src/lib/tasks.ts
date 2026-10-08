// Tasks module — port of static /assets/js/tasks.js
// CRUD · progress timeline · status transitions · due-soon
import type { Task as TaskRecord, TaskStatus, TaskPriority, TaskProgress as TaskProgressRec } from './types';
import { TASKS, TASK_PROGRESS, TASK_SETTINGS, USERS } from './data';
import { todayISO, addDaysISO } from './app';

const LS_KEY_TASKS = 'engg_user_tasks';
const LS_KEY_PROG  = 'engg_user_task_progress';

// ---------------- Priority / status catalogues ----------------
interface Meta { code: TaskStatus | TaskPriority; label: string; color: string; }

const PRIORITIES: Meta[] = [
  { code: 'HIGH',   label: 'High',   color: 'danger' },
  { code: 'NORMAL', label: 'Normal', color: 'muted'  },
  { code: 'LOW',    label: 'Low',    color: 'info'   }
];
const PRIORITY_BY_CODE: Record<string, Meta> = Object.fromEntries(PRIORITIES.map(p => [p.code, p]));

const STATUSES: Meta[] = [
  { code: 'OPEN',        label: 'Open',        color: 'muted'   },
  { code: 'IN_PROGRESS', label: 'In progress', color: 'primary' },
  { code: 'DONE',        label: 'Done',        color: 'success' }
];
const STATUS_BY_CODE: Record<string, Meta> = Object.fromEntries(STATUSES.map(s => [s.code, s]));

// ---------------- Local-storage helpers ----------------
function loadUserTasks(): TaskRecord[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY_TASKS) || '[]'); } catch { return []; }
}
function persistUserTasks(list: TaskRecord[]): void {
  try { localStorage.setItem(LS_KEY_TASKS, JSON.stringify(list)); } catch { /* ignore */ }
}
function loadUserProgress(): TaskProgressRec[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY_PROG) || '[]'); } catch { return []; }
}
function persistUserProgress(list: TaskProgressRec[]): void {
  try { localStorage.setItem(LS_KEY_PROG, JSON.stringify(list)); } catch { /* ignore */ }
}

// Last-wins dedup by id
function mergeWithUser<T extends { id: number }>(seedArr: T[], userArr: T[]): T[] {
  const byId = new Map<number, T>();
  for (const item of userArr) byId.set(item.id, item);
  const userDedupe = Array.from(byId.values());
  const userIdSet = new Set(userDedupe.map(x => x.id));
  const seedOnly = seedArr.filter(x => !userIdSet.has(x.id));
  return [...seedOnly, ...userDedupe];
}

// ---------------- Public API ----------------
export const Tasks = {
  priorityMeta(code: TaskPriority | string): Meta {
    return PRIORITY_BY_CODE[code] || { code: code as TaskPriority, label: String(code), color: 'muted' };
  },
  statusMeta(code: TaskStatus | string): Meta {
    return STATUS_BY_CODE[code] || { code: code as TaskStatus, label: String(code), color: 'muted' };
  },
  prioritiesAll(): Meta[] { return PRIORITIES.slice(); },
  statusesAll(): Meta[] { return STATUSES.slice(); },
  PRIORITIES,
  PRIORITY_BY_CODE,
  STATUSES,
  STATUS_BY_CODE,

  all(): TaskRecord[] {
    return mergeWithUser(TASKS, loadUserTasks());
  },
  byId(id: number | string): TaskRecord | undefined {
    return this.all().find(t => t.id === Number(id));
  },
  nextId(): number {
    return this.all().reduce((acc, t) => Math.max(acc, t.id || 0), 0) + 1;
  },

  progressAll(): TaskProgressRec[] {
    const userProg = loadUserProgress();
    const byIdLocal = new Map<number, TaskProgressRec>();
    for (const p of userProg) byIdLocal.set(p.id, p);
    const userDedupe = Array.from(byIdLocal.values());
    const userIds = new Set(userDedupe.map(p => p.id));
    const seedOnly = TASK_PROGRESS.filter(p => !userIds.has(p.id));
    return [...seedOnly, ...userDedupe];
  },
  progressFor(taskId: number | string): TaskProgressRec[] {
    return this.progressAll()
      .filter(p => p.taskId === Number(taskId))
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  },

  statusFromProgress(progressPercent: number): TaskStatus {
    if (progressPercent >= 100) return 'DONE';
    if (progressPercent > 0)    return 'IN_PROGRESS';
    return 'OPEN';
  },

  validate(input: Partial<TaskRecord>, _excludeId?: number | string): { ok: true } | { ok: false; error: string } {
    if (!input.title || !input.title.trim()) return { ok: false, error: 'Title is required.' };
    if (input.title.length > 200) return { ok: false, error: 'Title must be ≤ 200 characters.' };
    if (input.description && input.description.length > 1000) return { ok: false, error: 'Description must be ≤ 1000 characters.' };
    if (!input.priority || !PRIORITY_BY_CODE[input.priority]) return { ok: false, error: 'Priority is required.' };
    if (!input.status || !STATUS_BY_CODE[input.status]) return { ok: false, error: 'Status is required.' };
    if (!input.dueDate) return { ok: false, error: 'Due date is required.' };
    if (!input.assigneeId) return { ok: false, error: 'Assignee is required.' };
    if (!input.assignedById) return { ok: false, error: 'No user in session.' };
    if (typeof input.progressPercent !== 'number' || input.progressPercent < 0 || input.progressPercent > 100) {
      return { ok: false, error: 'Progress must be 0–100.' };
    }
    if (input.progressPercent % 10 !== 0) {
      return { ok: false, error: 'Progress must be in 10% increments.' };
    }
    if (input.status === 'DONE' && input.progressPercent < 100) {
      return { ok: false, error: 'A Done task must be at 100%.' };
    }
    if (input.status === 'OPEN' && input.progressPercent > 0) {
      return { ok: false, error: 'An Open task must be at 0%.' };
    }
    return { ok: true };
  },

  create(input: Omit<TaskRecord, 'id' | 'createdAt' | 'completionNote' | 'completedAt'> & { completionNote?: string; completedAt?: string | null }): TaskRecord {
    const list = loadUserTasks();
    const id = this.nextId();
    const full: TaskRecord = {
      ...input,
      id,
      createdAt: new Date().toISOString(),
      completionNote: input.completionNote || '',
      completedAt: input.status === 'DONE' ? (input.completedAt || new Date().toISOString()) : null
    };
    list.push(full);
    persistUserTasks(list);
    return full;
  },

  update(id: number | string, patch: Partial<TaskRecord>): TaskRecord | null {
    const all2 = this.all();
    const i = all2.findIndex(t => t.id === Number(id));
    if (i < 0) return null;
    const target = all2[i];
    const merged: TaskRecord = { ...target, ...patch };
    // Auto-set completedAt when status transitions to DONE
    if (target.status !== 'DONE' && merged.status === 'DONE' && !merged.completedAt) {
      merged.completedAt = new Date().toISOString();
    }
    if (merged.status !== 'DONE') merged.completedAt = null;

    // Coalesce stale duplicates in userList first, so this write targets the same
    // entry that byId() returned to the form.
    const userList = mergeWithUser([], loadUserTasks());
    const ui = userList.findIndex(t => t.id === Number(id));
    if (ui >= 0) {
      userList[ui] = merged;
    } else {
      userList.push(merged);
    }
    persistUserTasks(userList);
    return merged;
  },

  recordProgress(taskId: number | string, args: { progressPercent: number; updatedById: number; note: string }): TaskRecord | null {
    const target = this.byId(taskId);
    if (!target) return null;
    const from = target.progressPercent || 0;
    if (args.progressPercent === from) return target;
    const list = loadUserProgress();
    list.push({
      id: list.length + TASK_PROGRESS.length + 1,
      taskId: Number(taskId),
      fromPercent: from,
      toPercent: args.progressPercent,
      note: args.note || '',
      updatedById: Number(args.updatedById),
      createdAt: new Date().toISOString()
    });
    persistUserProgress(list);

    const status = this.statusFromProgress(args.progressPercent);
    const completionNote = args.progressPercent === 100 ? (args.note || '') : (target.completionNote || '');
    return this.update(taskId, { progressPercent: args.progressPercent, status, completionNote });
  },

  // Update the note on the most recent progress entry (same %, no new timeline dot).
  // Returns { changed: true, entry } if updated, { changed: false } if note already matches.
  // If the latest history dot doesn't yet reach the task's current % (e.g. seed data has
  // the task at 60% but the last dot only reaches 40%), backfill a new dot covering the
  // gap and put the note on it — so the user's note is anchored to a step that
  // represents the current state.
  updateLatestNote(taskId: number | string, note: string, updatedById: number): { changed: true; entry: TaskProgressRec; created?: boolean; filled?: boolean } | { changed: false; entry?: TaskProgressRec } {
    const history = this.progressFor(taskId);
    const target = this.byId(taskId);
    if (!target) return { changed: false };

    if (history.length === 0) {
      // No history yet. If the task is at >0%, seed the first row as 0 → current%.
      if (target.progressPercent === 0) {
        return { changed: false };
      }
      const userList = mergeWithUser([], loadUserProgress());
      const newEntry: TaskProgressRec = {
        id: userList.length + TASK_PROGRESS.length + 1,
        taskId: Number(taskId),
        fromPercent: 0,
        toPercent: target.progressPercent,
        note: note || '',
        updatedById: Number(updatedById),
        createdAt: new Date().toISOString()
      };
      userList.push(newEntry);
      persistUserProgress(userList);
      return { changed: true, entry: newEntry, created: true };
    }

    const latest = history[history.length - 1];

    // Gap between latest history dot and current task % — create a fresh dot covering
    // the gap and attach the note to it. This avoids "where did my note go?" confusion
    // when seed data leaves the timeline behind the task's current %.
    if (latest.toPercent < target.progressPercent) {
      const userList = mergeWithUser([], loadUserProgress());
      const gapEntry: TaskProgressRec = {
        id: userList.length + TASK_PROGRESS.length + 1,
        taskId: Number(taskId),
        fromPercent: latest.toPercent,
        toPercent: target.progressPercent,
        note: note || '',
        updatedById: Number(updatedById),
        createdAt: new Date().toISOString()
      };
      userList.push(gapEntry);
      persistUserProgress(userList);
      return { changed: true, entry: gapEntry, created: true, filled: true };
    }

    if ((latest.note || '') === (note || '')) return { changed: false, entry: latest };

    const updated: TaskProgressRec = { ...latest, note: note || '', updatedById: Number(updatedById) };
    // Coalesce stale duplicates in userList first so this write targets the same
    // entry that progressFor() returned.
    const userList = mergeWithUser([], loadUserProgress());
    const ui = userList.findIndex(p => p.id === latest.id);
    if (ui >= 0) {
      userList[ui] = updated;
    } else {
      // Latest entry is from the seed; snapshot a user-side copy so the edit persists.
      userList.push(updated);
    }
    persistUserProgress(userList);
    return { changed: true, entry: updated };
  },

  dueSoon({ fromDate, toDate, userId, team, includeDone }: { fromDate?: string; toDate?: string; userId?: number | null; team?: string; includeDone?: boolean } = {}): TaskRecord[] {
    const f = fromDate || todayISO();
    const t = toDate   || addDaysISO(todayISO(), (TASK_SETTINGS.taskDeadlineAlertDays || 14) - 1);
    return this.all().filter(task => {
      if (!task.dueDate) return false;
      if (task.dueDate < f || task.dueDate > t) return false;
      if (!includeDone && task.status === 'DONE') return false;
      if (userId != null && task.assigneeId !== Number(userId)) return false;
      if (team && team !== 'ALL') {
        const u = USERS.find(x => x.id === task.assigneeId);
        if (!u || u.team !== team) return false;
      }
      return true;
    });
  },

  overdue(userId: number | string): TaskRecord[] {
    const today = todayISO();
    return this.all().filter(t =>
      t.assigneeId === Number(userId) &&
      t.status !== 'DONE' &&
      t.dueDate &&
      t.dueDate < today
    );
  }
};