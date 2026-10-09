// Holidays — remote API client (proxied to :8092 via vite.config).
// Mirrors the .103 server-side `holidays` / `holiday_seed_removed` /
// `holiday_imports` tables. Returns the same shapes as the local `Holiday`
// and `HolidayImport` types in `src/lib/types.ts`.
import type { Holiday, HolidayImport, HolidayFormat } from '../types';
import type { ParsedHoliday } from '../holidayImport';
import { jsonFetch } from './fetch';

export interface ImportResult {
  importId: string;
  added: ParsedHoliday[];
  skipped: { item: ParsedHoliday; reason: string }[];
  replaced: number;
}

export const Holidays = {
  /** Returns the org-wide merged list (HK 1823 seed + db additions − removed seeds). */
  all(): Promise<Holiday[]> {
    return jsonFetch<Holiday[]>('/api/holidays');
  },
  add(input: { date: string; name: string; userId: number | null }): Promise<Holiday> {
    return jsonFetch<Holiday>('/api/holidays', { method: 'POST', body: JSON.stringify(input) });
  },
  remove(input: { date: string; userId: number | null }): Promise<{ ok: true; source: 'added' | 'seed' }> {
    return jsonFetch(`/api/holidays/${encodeURIComponent(input.date)}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId: input.userId })
    });
  },
  reset(): Promise<{ ok: true }> {
    return jsonFetch('/api/holidays/reset', { method: 'POST' });
  },

  listImports(): Promise<HolidayImport[]> {
    return jsonFetch<HolidayImport[]>('/api/holiday-imports');
  },
  importBulk(input: {
    importId: string;
    items: ParsedHoliday[];
    filename: string;
    format: HolidayFormat;
    userId: number | null;
  }): Promise<ImportResult> {
    return jsonFetch<ImportResult>('/api/holiday-imports', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  removeImport(importId: string): Promise<{ removed: number }> {
    return jsonFetch(`/api/holiday-imports/${encodeURIComponent(importId)}`, {
      method: 'DELETE'
    });
  }
};
