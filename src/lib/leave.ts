// Leave module — port of static /assets/js/leave.js
// Types · validation · ICS · date spans · holiday block · 2-week report
import type { Leave as LeaveRecord, LeaveType } from './types';
import { LEAVE, USERS } from './data';
import { localISO, todayISO, isPast, fmt } from './app';
import { Bookings } from './bookings';

const LS_KEY = 'engg_user_leave';

// ---------------- Type catalogue ----------------
interface TypeMeta { code: LeaveType; label: string; color: string; }

const TYPES: TypeMeta[] = [
  { code: 'ANNUAL',        label: 'Annual leave',        color: 'primary' },
  { code: 'SICK',          label: 'Sick leave',          color: 'danger'  },
  { code: 'UNPAID',        label: 'Unpaid leave',        color: 'muted'   },
  { code: 'MATERNITY',     label: 'Maternity leave',     color: 'purple'  },
  { code: 'PATERNITY',     label: 'Paternity leave',     color: 'info'    },
  { code: 'COMPASSIONATE', label: 'Compassionate leave', color: 'warning' },
  { code: 'STUDY',         label: 'Study leave',         color: 'success' }
];
const TYPE_BY_CODE: Record<string, TypeMeta> = Object.fromEntries(TYPES.map(t => [t.code, t]));

// ---------------- Local-storage helpers ----------------
function loadUserLeave(): LeaveRecord[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}
function persistUserLeave(list: LeaveRecord[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

// Last-wins dedup by id (so user updates persist and stale duplicates coalesce)
function mergeWithUser(seedArr: LeaveRecord[], userArr: LeaveRecord[]): LeaveRecord[] {
  const byId = new Map<number, LeaveRecord>();
  for (const item of userArr) byId.set(item.id, item);
  const userDedupe = Array.from(byId.values());
  const userIdSet = new Set(userDedupe.map(x => x.id));
  const seedOnly = seedArr.filter(x => !userIdSet.has(x.id));
  return [...seedOnly, ...userDedupe];
}

// ---------------- Public API ----------------
export const Leave = {
  typeMeta(code: LeaveType | string): TypeMeta {
    return TYPE_BY_CODE[code] || { code: code as LeaveType, label: String(code), color: 'muted' };
  },
  typesAll(): TypeMeta[] { return TYPES.slice(); },
  TYPES,
  TYPE_BY_CODE,

  all(): LeaveRecord[] {
    return mergeWithUser(LEAVE, loadUserLeave());
  },
  byId(id: number | string): LeaveRecord | undefined {
    return this.all().find(l => l.id === Number(id));
  },
  nextId(): number {
    return this.all().reduce((acc, l) => Math.max(acc, l.id || 0), 0) + 1;
  },

  create(input: Omit<LeaveRecord, 'id' | 'status' | 'createdAt'>): LeaveRecord {
    const list = loadUserLeave();
    const id = this.nextId();
    const full: LeaveRecord = {
      ...input,
      id,
      status: 'APPROVED',  // demo: auto-approved on submit
      createdAt: new Date().toISOString()
    };
    list.push(full);
    persistUserLeave(list);
    return full;
  },
  update(id: number | string, patch: Partial<LeaveRecord>): LeaveRecord | null {
    const all2 = this.all();
    const i = all2.findIndex(l => l.id === Number(id));
    if (i < 0) return null;
    const target = all2[i];
    const updated: LeaveRecord = { ...target, ...patch };
    // Coalesce stale duplicates so this write targets the same entry byId() returned.
    const userList = mergeWithUser([], loadUserLeave());
    const ui = userList.findIndex(l => l.id === Number(id));
    if (ui >= 0) {
      userList[ui] = updated;
    } else {
      userList.push(updated);
    }
    persistUserLeave(userList);
    return updated;
  },
  cancel(id: number | string): LeaveRecord | null {
    return this.update(id, { status: 'CANCELLED' });
  },

  // ---------------- Validation ----------------
  validate(input: Partial<LeaveRecord>, excludeId?: number | string): { ok: true } | { ok: false; error: string } {
    if (!input.type) return { ok: false, error: 'Leave type is required.' };
    if (!TYPE_BY_CODE[input.type]) return { ok: false, error: 'Unknown leave type.' };
    if (!input.startDate) return { ok: false, error: 'Start date is required.' };
    if (!input.endDate)   return { ok: false, error: 'End date is required.' };
    if (input.endDate! < input.startDate!) return { ok: false, error: 'End date must be on or after start date.' };
    // SICK is allowed to be in the past; other types must be today or future
    if (input.type !== 'SICK' && isPast(input.startDate!)) {
      return { ok: false, error: 'Start date cannot be in the past for this leave type.' };
    }
    if (input.userId == null) return { ok: false, error: 'No user in session.' };

    // Conflict with the same user's other non-cancelled leave
    const conflict = this.all().find(l =>
      l.id !== Number(excludeId) &&
      l.userId === Number(input.userId) &&
      l.status !== 'CANCELLED' &&
      this.overlaps(l.startDate, l.endDate, input.startDate!, input.endDate!)
    );
    if (conflict) {
      return {
        ok: false,
        error: `Overlaps with existing leave ${fmt.dateLong(conflict.startDate)} – ${fmt.dateLong(conflict.endDate)}.`
      };
    }
    return { ok: true };
  },

  // ---------------- Date span helpers ----------------
  expandSpan(leave: Pick<LeaveRecord, 'startDate' | 'endDate'>): string[] {
    const out: string[] = [];
    const d = new Date(leave.startDate + 'T00:00:00');
    const end = new Date(leave.endDate + 'T00:00:00');
    while (d <= end) {
      out.push(localISO(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  },
  daysCount(leave: Pick<LeaveRecord, 'startDate' | 'endDate'>): number {
    return this.expandSpan(leave).length;
  },
  overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
    return !(aEnd < bStart || aStart > bEnd);
  },
  leaveOnDay(iso: string): LeaveRecord[] {
    return this.all().filter(l =>
      l.status !== 'CANCELLED' &&
      iso >= l.startDate && iso <= l.endDate
    );
  },

  // ---------------- Monday two-week leave report (TASK_MANAGER feature) ----------------
  twoWeekReport({ fromDate, team }: { fromDate: string; team?: string }): LeaveRecord[] {
    return this.all().filter(l => {
      if (l.status === 'CANCELLED') return false;
      if (l.startDate > fromDate || l.endDate < fromDate) return false;
      if (team && team !== 'ALL') {
        const u = USERS.find(x => x.id === l.userId);
        if (!u || u.team !== team) return false;
      }
      return true;
    });
  },

  // ---------------- ICS export ----------------
  buildIcs(records: LeaveRecord[], calendarName = 'HKU ENGG Leave'): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//HKU ENGG Intranet//Leave//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeIcs(calendarName)}`
    ];
    records.forEach(l => {
      const user = USERS.find(u => u.id === l.userId);
      const meta = this.typeMeta(l.type);
      // DTEND for all-day events is the day AFTER the last day
      const endPlus1 = new Date(l.endDate + 'T00:00:00');
      endPlus1.setDate(endPlus1.getDate() + 1);
      const dtend = localISO(endPlus1);
      lines.push(
        'BEGIN:VEVENT',
        `UID:leave-${l.id}@engg.hku.hk`,
        `DTSTAMP:${fmtIcsDate((l.createdAt || todayISO()).slice(0, 10))}`,
        `DTSTART;VALUE=DATE:${fmtIcsDate(l.startDate)}`,
        `DTEND;VALUE=DATE:${fmtIcsDate(dtend)}`,
        `SUMMARY:${escapeIcs(`${meta.label} — ${user?.displayName || '—'}`)}`,
        `DESCRIPTION:${escapeIcs([
          l.note ? `Note: ${l.note}` : null,
          `User: ${user?.displayName || '—'} (${user?.team || ''})`
        ].filter(Boolean).join('\\n'))}`,
        `CATEGORIES:${escapeIcs(meta.label)}`,
        'TRANSP:OPAQUE',
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  },
  downloadIcs(records: LeaveRecord[], filename?: string): void {
    const blob = new Blob([this.buildIcs(records)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'hku-ENGG-leave.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // ---------------- Calendar grid helpers (delegated to Bookings) ----------------
  startOfWeek: Bookings.startOfWeek,
  startOfMonth: Bookings.startOfMonth,
  buildMonthGrid: Bookings.buildMonthGrid,
  buildWeekGrid: Bookings.buildWeekGrid
};

function escapeIcs(s: string): string {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
function fmtIcsDate(date: string): string {
  return date.replace(/-/g, '');
}