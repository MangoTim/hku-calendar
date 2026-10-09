// Bookings module — port of static /assets/js/bookings.js
// FCFS · conflict · holiday · quantities · ICS · calendar grid helpers
import type { Booking } from './types';
import { BOOKINGS, ROOMS, USERS } from './data';
import { todayISO, isPast, localISO } from './app';

const LS_KEY = 'engg_user_bookings';

// ---------------- Local-storage helpers ----------------
function loadUserBookings(): Booking[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}
function persistUserBookings(list: Booking[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

// Last-wins dedup by id (so user updates persist and stale duplicates coalesce)
function mergeWithUser(seedArr: Booking[], userArr: Booking[]): Booking[] {
  const byId = new Map<number, Booking>();
  for (const item of userArr) byId.set(item.id, item);
  const userDedupe = Array.from(byId.values());
  const userIdSet = new Set(userDedupe.map(x => x.id));
  const seedOnly = seedArr.filter(x => !userIdSet.has(x.id));
  return [...seedOnly, ...userDedupe];
}

// ---------------- Public CRUD ----------------
export const Bookings = {
  all(): Booking[] {
    return mergeWithUser(BOOKINGS, loadUserBookings());
  },
  byId(id: number | string): Booking | undefined {
    return this.all().find(b => b.id === Number(id));
  },
  nextRef(): string {
    const max = this.all().reduce((acc, b) => {
      const m = String(b.ref || 'RB-0000').split('-')[1];
      return Math.max(acc, parseInt(m, 10) || 0);
    }, 0);
    return 'RB-' + String(max + 1).padStart(4, '0');
  },
  nextId(): number {
    const max = this.all().reduce((acc, b) => Math.max(acc, b.id || 0), 0);
    return max + 1;
  },
  create(b: Omit<Booking, 'id' | 'ref' | 'status' | 'createdAt'>): Booking {
    const list = loadUserBookings();
    const id = this.nextId();
    const ref = this.nextRef();
    const full: Booking = {
      ...b,
      id,
      ref,
      status: 'CONFIRMED',
      createdAt: new Date().toISOString()
    };
    list.push(full);
    persistUserBookings(list);
    return full;
  },
  update(id: number | string, patch: Partial<Booking>): Booking | null {
    const all2 = this.all();
    const i = all2.findIndex(b => b.id === Number(id));
    if (i < 0) return null;
    const target = all2[i];
    const updated: Booking = { ...target, ...patch };
    // Coalesce stale duplicates so this write targets the same entry byId() returned.
    const userList = mergeWithUser([], loadUserBookings());
    const ui = userList.findIndex(b => b.id === Number(id));
    if (ui >= 0) {
      userList[ui] = updated;
    } else {
      userList.push(updated);
    }
    persistUserBookings(userList);
    return updated;
  },
  cancel(id: number | string): Booking | null {
    return this.update(id, { status: 'CANCELLED' });
  },

  // ---------------- Validation ----------------
  // Async because the holiday check needs the (remote, cached) holiday name.
  // Callers pass the resolver from `useHoliday().holidayName` so the
  // validator stays free of React context and can be unit-tested.
  async validate(
    input: Partial<Booking>,
    excludeBookingId: number | string | undefined,
    ctx: { holidayName: (d: string) => string | null }
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const todayIso = todayISO();
    if (!input.date) return { ok: false, error: 'Date is required.' };
    if (isPast(input.date)) return { ok: false, error: 'Date cannot be in the past.' };
    const hname = ctx.holidayName(input.date);
    if (hname) return { ok: false, error: `Date falls on a Hong Kong public holiday: ${hname}.` };
    if (!input.startTime || !input.endTime) return { ok: false, error: 'Start and end time are required.' };
    if (input.endTime <= input.startTime) return { ok: false, error: 'End time must be after start time.' };
    if (input.date === todayIso) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const nowHm = `${hh}:${mm}`;
      if (input.endTime <= nowHm) return { ok: false, error: 'End time must be later than the current time for today.' };
    }
    if (!input.roomId) return { ok: false, error: 'Room is required.' };
    if (!input.purpose || !input.purpose.trim()) return { ok: false, error: 'Purpose is required.' };

    const quantities: Array<keyof Booking> = ['cupsOfTea', 'warmWater', 'coolWater', 'iPads'];
    for (const q of quantities) {
      const v = Number(input[q] || 0);
      if (!Number.isFinite(v) || v < 0) return { ok: false, error: `${q} must be ≥ 0.` };
    }
    if (Number(input.cupsOfTea) > 50) return { ok: false, error: 'Cups of tea must be ≤ 50.' };
    if (Number(input.warmWater) > 50) return { ok: false, error: 'Warm water cups must be ≤ 50.' };
    if (Number(input.coolWater) > 50) return { ok: false, error: 'Cool water cups must be ≤ 50.' };
    if (Number(input.iPads) > 20) return { ok: false, error: 'iPads must be ≤ 20.' };

    // Conflict (same room, overlapping times, ignoring CANCELLED; edit excludes self)
    const conflict = this.all().find(b =>
      b.id !== Number(excludeBookingId) &&
      b.status !== 'CANCELLED' &&
      b.roomId === Number(input.roomId) &&
      b.date === input.date &&
      !(input.endTime! <= b.startTime || input.startTime! >= b.endTime)
    );
    if (conflict) {
      const room = ROOMS.find(r => r.id === Number(input.roomId));
      return { ok: false, error: `Conflicts with existing booking ${conflict.ref} (${conflict.startTime}–${conflict.endTime}) in ${room?.name || 'this room'}.` };
    }
    return { ok: true };
  },

  // ---------------- ICS export ----------------
  buildIcs(bookings: Booking[], calendarName = 'HKU ENGG Bookings'): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//HKU ENGG Intranet//Bookings//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeIcs(calendarName)}`
    ];
    const fmtIcsDate = (date: string, time: string) => {
      const [y, m, d] = date.split('-');
      const [hh, mm] = time.split(':');
      return `${y}${m}${d}T${hh}${mm}00`;
    };
    bookings.forEach(b => {
      const room = ROOMS.find(r => r.id === b.roomId);
      const booker = USERS.find(u => u.id === b.bookedById);
      const desc = [
        `Purpose: ${b.purpose}`,
        `Booked by: ${booker?.displayName || '—'}`,
        b.supportRequests ? `Support: ${b.supportRequests}` : null,
        b.itSupport ? 'IT support requested' : null
      ].filter(Boolean).join('\\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${b.ref}@engg.hku.hk`,
        `DTSTAMP:${fmtIcsDate(b.date || todayISO(), '00:00')}`,
        `DTSTART:${fmtIcsDate(b.date, b.startTime)}`,
        `DTEND:${fmtIcsDate(b.date, b.endTime)}`,
        `SUMMARY:${escapeIcs(`${b.ref} — ${room?.name || 'Room'}`)}`,
        `DESCRIPTION:${escapeIcs(desc)}`,
        `LOCATION:${escapeIcs(`${room?.name || ''} (${room?.building || ''})`)}`,
        'STATUS:' + (b.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'),
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  },
  downloadIcs(bookings: Booking[], filename?: string): void {
    const blob = new Blob([this.buildIcs(bookings)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'hkU-ENGG-bookings.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // ---------------- Calendar grid helpers ----------------
  startOfWeek(d: Date): Date {
    const day = d.getDay();
    const diff = (day + 6) % 7;
    const r = new Date(d);
    r.setDate(d.getDate() - diff);
    r.setHours(0, 0, 0, 0);
    return r;
  },
  startOfMonth(d: Date): Date {
    const r = new Date(d.getFullYear(), d.getMonth(), 1);
    r.setHours(0, 0, 0, 0);
    return r;
  },
  buildMonthGrid(anchor: Date): { cells: Date[]; month: Date; end: Date } {
    const start = this.startOfMonth(anchor);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const first = this.startOfWeek(start);
    const cells: Date[] = [];
    const cursor = new Date(first);
    while (cells.length < 42 && cursor <= new Date(end.getTime() + 7 * 86400000)) {
      cells.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return { cells, month: start, end };
  },
  buildWeekGrid(anchor: Date): { cells: Date[]; start: Date } {
    const start = this.startOfWeek(anchor);
    const cells: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return { cells, start };
  }
};

// Re-export helper for callers that already imported it from elsewhere
export { localISO };

function escapeIcs(s: string): string {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}