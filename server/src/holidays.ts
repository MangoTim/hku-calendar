// Holiday storage — pure DB functions (no HTTP). Used by the /api/holidays
// and /api/holiday-imports routes. The HK 1823 canonical seed (HOLIDAYS_FLAT)
// is imported from src/lib/data.ts and merged with the `holidays` table on
// every read, with `holiday_seed_removed` filtering out the dates the admin
// has chosen to hide.
import { getPool } from './db.ts';
import { HOLIDAYS_FLAT } from '../../src/lib/data.ts';
import type { Holiday, HolidayImport, HolidayFormat } from '../../src/lib/types.ts';
import type { ParsedHoliday } from '../../src/lib/holidayImport.ts';

// ---------- helpers ----------
function toIsoDate(d: any): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}
function toPgDate(iso: string): string {
  // pg accepts 'YYYY-MM-DD' as DATE; pass through after validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`bad date: ${iso}`);
  return iso;
}

// ---------- read ----------
export async function getMergedHolidays(): Promise<Holiday[]> {
  const pool = getPool();
  const [adds, removed] = await Promise.all([
    pool.query<{ date: any; name: string; import_id: string | null }>(
      `SELECT date::text AS date, name, import_id FROM holidays`
    ),
    pool.query<{ date: any }>(`SELECT date::text AS date FROM holiday_seed_removed`)
  ]);
  const byDate = new Map<string, Holiday>();
  for (const h of HOLIDAYS_FLAT) byDate.set(h.date, { date: h.date, name: h.name });
  for (const r of removed.rows) byDate.delete(toIsoDate(r.date));
  for (const a of adds.rows) {
    byDate.set(toIsoDate(a.date), { date: toIsoDate(a.date), name: a.name, importId: a.import_id ?? undefined });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function listImports(): Promise<HolidayImport[]> {
  const pool = getPool();
  const r = await pool.query<{
    import_id: string;
    filename: string;
    format: HolidayFormat;
    imported_at: any;
    count: number;
  }>(
    `SELECT import_id, filename, format, imported_at, count
     FROM holiday_imports
     ORDER BY imported_at ASC, import_id ASC`
  );
  // Recompute count live so it reflects any per-row deletes via the year table.
  const counts = await pool.query<{ import_id: string; n: string }>(
    `SELECT import_id, COUNT(*)::text AS n FROM holidays WHERE import_id IS NOT NULL GROUP BY import_id`
  );
  const liveCount = new Map(counts.rows.map(c => [c.import_id, Number(c.n)]));
  return r.rows.map(row => ({
    importId: row.import_id,
    filename: row.filename,
    format: row.format,
    importedAt: row.imported_at instanceof Date ? row.imported_at.toISOString() : String(row.imported_at),
    count: liveCount.get(row.import_id) ?? 0
  }));
}

// ---------- single holiday ----------
export type AddResult = { ok: true; holiday: Holiday } | { ok: false; error: string; code: 'CONFLICT' };

export async function addHoliday(date: string, name: string, userId: number | null): Promise<AddResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'date must be YYYY-MM-DD', code: 'CONFLICT' };
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return { ok: false, error: 'name is required', code: 'CONFLICT' };
  const pool = getPool();
  const seedDates = new Set(HOLIDAYS_FLAT.map(h => h.date));
  if (seedDates.has(date)) return { ok: false, error: `${date} is a seed holiday; remove the seed first`, code: 'CONFLICT' };
  const r = await pool.query<{ date: any }>(
    `SELECT date FROM holidays WHERE date = $1`,
    [toPgDate(date)]
  );
  if (r.rowCount && r.rowCount > 0) return { ok: false, error: `${date} is already a holiday`, code: 'CONFLICT' };
  const removed = await pool.query(`SELECT 1 FROM holiday_seed_removed WHERE date = $1`, [toPgDate(date)]);
  if (removed.rowCount && removed.rowCount > 0) {
    // Un-hide the seed: remove the seed-removed row so this date is visible again.
    await pool.query(`DELETE FROM holiday_seed_removed WHERE date = $1`, [toPgDate(date)]);
  }
  await pool.query(
    `INSERT INTO holidays (date, name, created_by) VALUES ($1, $2, $3)`,
    [toPgDate(date), trimmed, userId]
  );
  return { ok: true, holiday: { date, name: trimmed } };
}

export async function removeHoliday(date: string, userId: number | null): Promise<{ ok: true; source: 'added' | 'seed' }> {
  const pool = getPool();
  const seedDates = new Set(HOLIDAYS_FLAT.map(h => h.date));
  // Try the user-added/imported table first.
  const del = await pool.query(`DELETE FROM holidays WHERE date = $1`, [toPgDate(date)]);
  if (del.rowCount && del.rowCount > 0) return { ok: true, source: 'added' };
  if (seedDates.has(date)) {
    // Hide the seed by inserting into the seed-removed list (idempotent).
    await pool.query(
      `INSERT INTO holiday_seed_removed (date, removed_by) VALUES ($1, $2)
       ON CONFLICT (date) DO NOTHING`,
      [toPgDate(date), userId]
    );
    return { ok: true, source: 'seed' };
  }
  // Nothing to remove — treat as success so the UI can stay idempotent.
  return { ok: true, source: 'added' };
}

// ---------- import (bulk) ----------
export interface ImportMeta {
  filename: string;
  format: HolidayFormat;
  /** The import id is the FNV-1a hash of the file text, computed by the client. */
  importId: string;
}
export interface ImportResult {
  importId: string;
  added: ParsedHoliday[];
  skipped: { item: ParsedHoliday; reason: string }[];
  replaced: number;
}

export async function importHolidays(
  items: ParsedHoliday[],
  meta: ImportMeta,
  userId: number | null
): Promise<ImportResult> {
  const pool = getPool();
  // 1) Re-import: drop the previous rows from this same importId so the new
  //    content takes over cleanly. Idempotent.
  let replaced = 0;
  const prior = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM holidays WHERE import_id = $1`,
    [meta.importId]
  );
  if (Number(prior.rows[0].c) > 0) {
    const del = await pool.query(`DELETE FROM holidays WHERE import_id = $1`, [meta.importId]);
    replaced = del.rowCount ?? 0;
  }

  // 2) Conflict-check: skip dates already in seeds, in `holidays` (other imports
  //    or manual adds), or in the seed-removed list.
  const current = await getMergedHolidays();
  const taken = new Set(current.map(h => h.date));
  const added: ParsedHoliday[] = [];
  const skipped: { item: ParsedHoliday; reason: string }[] = [];
  for (const item of items) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      skipped.push({ item, reason: 'invalid date' });
      continue;
    }
    if (taken.has(item.date)) {
      skipped.push({ item, reason: 'date already taken (seed, manual, or another import)' });
      continue;
    }
    try {
      await pool.query(
        `INSERT INTO holidays (date, name, import_id, created_by) VALUES ($1, $2, $3, $4)`,
        [toPgDate(item.date), item.name.slice(0, 100), meta.importId, userId]
      );
      taken.add(item.date);
      added.push(item);
    } catch (e: any) {
      // Race: another writer took the same date between our check and insert.
      skipped.push({ item, reason: `insert failed: ${e?.message || 'unknown'}` });
    }
  }

  // 3) Upsert the import registry record.
  await pool.query(
    `INSERT INTO holiday_imports (import_id, filename, format, imported_by, count, imported_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (import_id) DO UPDATE SET
       filename = EXCLUDED.filename,
       format = EXCLUDED.format,
       imported_by = EXCLUDED.imported_by,
       count = EXCLUDED.count,
       imported_at = NOW()`,
    [meta.importId, meta.filename, meta.format, userId, added.length]
  );

  return { importId: meta.importId, added, skipped, replaced };
}

export async function removeImport(importId: string): Promise<number> {
  const pool = getPool();
  const del = await pool.query(`DELETE FROM holidays WHERE import_id = $1`, [importId]);
  await pool.query(`DELETE FROM holiday_imports WHERE import_id = $1`, [importId]);
  return del.rowCount ?? 0;
}

// ---------- reset ----------
export async function resetHolidays(): Promise<void> {
  const pool = getPool();
  await pool.query(`TRUNCATE holidays, holiday_seed_removed RESTART IDENTITY`);
  // Keep the holiday_imports registry — it's metadata about the import, not
  // the holiday data itself. Reset to seed only wipes the holiday state.
}
