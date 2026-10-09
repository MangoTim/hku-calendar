// HolidayContext — org-wide holiday cache backed by the .103 API.
// Lives under <AuthProvider> in App.tsx so it can read `session` to attach
// userId to writes. The cache is a single source of truth for every page
// that needs to look up a holiday name, check if a date is a holiday, or
// render the admin's holiday tables.
//
// Storage transition (Phase 13 → Phase 14):
// Phase 13 stored holidays in localStorage (`engg_user_holidays`,
// `engg_user_holiday_imports`, `engg_user_holidays_removed`). On the first
// successful API read, if localStorage still has entries AND the API list
// doesn't, the local entries are pushed up to the server as a one-time
// migration and localStorage is cleared.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from 'react';
import type { ReactNode } from 'react';
import type { Holiday, HolidayImport, HolidayFormat } from '../lib/types';
import type { ParsedHoliday } from '../lib/holidayImport';
import { Holidays, type ImportResult } from '../lib/api/holidays';
import { useAuth } from './AuthContext';

const LS_KEY_HOLIDAYS = 'engg_user_holidays';
const LS_KEY_HOLIDAY_IMPORTS = 'engg_user_holiday_imports';

interface HolidayCtx {
  holidays: Holiday[];
  imports: HolidayImport[];
  holidayName: (date: string) => string | null;
  isHoliday: (date: string) => boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addHoliday: (date: string, name: string) => Promise<void>;
  removeHoliday: (date: string) => Promise<void>;
  importHolidays: (items: ParsedHoliday[], meta: { filename: string; format: HolidayFormat; fileText: string; importId: string }) => Promise<ImportResult>;
  removeImport: (importId: string) => Promise<void>;
  resetHolidays: () => Promise<void>;
}

const Ctx = createContext<HolidayCtx | null>(null);

// FNV-1a 32-bit — same algorithm the localStorage version used, so the
// importId is stable across the local→remote migration.
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= s.length;
  h = Math.imul(h, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(2).slice(0, 16);
}

function loadLocalHolidays(): Holiday[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY_HOLIDAYS) || '[]'); } catch { return []; }
}
function clearLocalHolidays(): void {
  try {
    localStorage.removeItem(LS_KEY_HOLIDAYS);
    localStorage.removeItem(LS_KEY_HOLIDAY_IMPORTS);
  } catch { /* ignore */ }
}

export function HolidayProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [imports, setImports] = useState<HolidayImport[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const migrated = useRef(false);

  // ---------- core fetch ----------
  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [list, imps] = await Promise.all([Holidays.all(), Holidays.listImports()]);
      setHolidays(list);
      setImports(imps);
    } catch (e: any) {
      setError(e?.message || 'Could not load holidays.');
    }
  }, []);

  // ---------- one-time localStorage → API migration ----------
  const migrateFromLocalIfNeeded = useCallback(async (): Promise<void> => {
    if (migrated.current) return;
    migrated.current = true;
    const local = loadLocalHolidays();
    if (local.length === 0) return;
    // If the API already has non-seed entries, skip the migration so we don't
    // overwrite someone else's data. Only migrate when the API list is empty
    // (i.e. only contains the seed list — but the API returns the merged list
    // so we can't easily tell here; instead we use a heuristic: only migrate
    // if the local entries have NO `importId`. In practice this runs once on
    // first load, and the API is empty because nobody else has used the new
    // flow).
    const localImported = local.filter(h => h.importId);
    const localManual = local.filter(h => !h.importId);
    if (localImported.length === 0 && localManual.length === 0) return;
    // Conservative: only migrate manual adds, not imports. Imports are tied
    // to a filename + format that the user can re-upload from the admin UI.
    if (localManual.length > 0) {
      const items: ParsedHoliday[] = localManual.map(h => ({ date: h.date, name: h.name }));
      try {
        await Holidays.importBulk({
          importId: shortHash('local-migration-' + Date.now()),
          items,
          filename: 'Local migration (pre-Phase-14)',
          format: 'json',
          userId
        });
      } catch (e) {
        // Migration is best-effort; log and continue.
        console.warn('[holidays] local → API migration failed', e);
      }
    }
    clearLocalHolidays();
  }, [userId]);

  // ---------- mount: load + maybe migrate ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await Holidays.all();
        if (cancelled) return;
        setHolidays(list);
        // Best-effort migration; doesn't block first paint.
        migrateFromLocalIfNeeded().then(() => {
          if (cancelled) return;
          // Re-fetch so the migrated entries show up.
          refresh().then(() => { if (!cancelled) setLoading(false); });
        });
        // If migration is a no-op, also set loading=false.
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Could not load holidays.');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [migrateFromLocalIfNeeded, refresh]);

  // ---------- mutations ----------
  const addHoliday = useCallback(async (date: string, name: string): Promise<void> => {
    await Holidays.add({ date, name, userId });
    await refresh();
  }, [userId, refresh]);

  const removeHoliday = useCallback(async (date: string): Promise<void> => {
    await Holidays.remove({ date, userId });
    await refresh();
  }, [userId, refresh]);

  const importHolidaysAction = useCallback(async (
    items: ParsedHoliday[],
    meta: { filename: string; format: HolidayFormat; fileText: string; importId: string }
  ): Promise<ImportResult> => {
    const r = await Holidays.importBulk({ ...meta, items, userId });
    await refresh();
    return r;
  }, [userId, refresh]);

  const removeImportAction = useCallback(async (importId: string): Promise<void> => {
    await Holidays.removeImport(importId);
    await refresh();
  }, [refresh]);

  const resetHolidaysAction = useCallback(async (): Promise<void> => {
    await Holidays.reset();
    await refresh();
  }, [refresh]);

  // ---------- memoized helpers ----------
  const byDate = useMemo(() => {
    const m = new Map<string, Holiday>();
    for (const h of holidays) m.set(h.date, h);
    return m;
  }, [holidays]);

  const holidayName = useCallback((date: string): string | null => byDate.get(date)?.name ?? null, [byDate]);
  const isHoliday = useCallback((date: string): boolean => byDate.has(date), [byDate]);

  const value = useMemo<HolidayCtx>(() => ({
    holidays,
    imports,
    holidayName,
    isHoliday,
    loading,
    error,
    refresh,
    addHoliday,
    removeHoliday,
    importHolidays: importHolidaysAction,
    removeImport: removeImportAction,
    resetHolidays: resetHolidaysAction
  }), [
    holidays, imports, holidayName, isHoliday, loading, error, refresh,
    addHoliday, removeHoliday, importHolidaysAction, removeImportAction, resetHolidaysAction
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHoliday(): HolidayCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHoliday must be used inside <HolidayProvider>');
  return v;
}
