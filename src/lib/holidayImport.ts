// Holiday file parsers — accept a File and return normalized holiday items.
// Supported formats:
//   - vCalendar JSON (RFC 5545 JSON form, e.g. the HK 1823 government feed):
//       { "vcalendar": [{ "vevent": [{ "dtstart": ["20250101", ...], "summary": "..." }] }] }
//   - Flat JSON: [{ "date": "2025-12-25", "name": "Christmas Day" }, ...]
//   - CSV with optional `date,name` header; extra columns ignored; quoted commas OK
//   - XLSX: first non-empty sheet; reads columns named `date` and `name` (case-insensitive)
//
// The xlsx parser uses a dynamic import so the ~150 KB SheetJS bundle is only
// fetched on the first .xlsx upload — JSON/CSV paths are zero-dependency.
import type { HolidayFormat } from './types';
export type { HolidayFormat } from './types';

export interface ParsedHoliday {
  date: string;   // YYYY-MM-DD
  name: string;
}

export interface ParseResult {
  format: HolidayFormat;
  items: ParsedHoliday[];
  warnings: string[];
}

export async function parseHolidayFile(file: File): Promise<ParseResult> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'xlsx') {
    return parseXlsxFile(file);
  }
  if (ext === 'csv') {
    const text = await file.text();
    return parseCsvText(text);
  }
  if (ext === 'json') {
    const text = await file.text();
    return parseJsonText(text);
  }
  throw new Error(`Unsupported file type: .${ext || '(none)'}. Use .json, .csv, or .xlsx.`);
}

// ---------- JSON dispatcher ----------
async function parseJsonText(text: string): Promise<ParseResult> {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch (e: any) {
    throw new Error(`Invalid JSON: ${e?.message || 'parse error'}`);
  }
  // vCalendar shape: top-level has "vcalendar" key with an array containing a
  // single vcalendar object whose "vevent" array holds the events.
  if (json && Array.isArray(json.vcalendar)) {
    return parseVCalendar(json);
  }
  // Flat array shape: [{ date, name }, ...]
  if (Array.isArray(json)) {
    return parseFlatArray(json);
  }
  // Some feeds wrap the list under another key (e.g. { "holidays": [...] }).
  if (json && Array.isArray(json.holidays)) {
    return parseFlatArray(json.holidays);
  }
  throw new Error('JSON is neither a vCalendar ({"vcalendar":[...]}) nor a flat holiday array ([{date,name}]).');
}

function parseVCalendar(json: any): ParseResult {
  const warnings: string[] = [];
  const items: ParsedHoliday[] = [];
  const events = json?.vcalendar?.[0]?.vevent;
  if (!Array.isArray(events)) {
    throw new Error('vCalendar structure missing vcalendar[0].vevent array.');
  }
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    // dtstart is a tuple: [ "20250101", { value: "DATE" } ]. We only care about
    // the first element and we ignore VALUE=DATE vs VALUE=DATE-TIME (the HK
    // 1823 feed uses DATE exclusively).
    const dtstart = ev?.dtstart;
    const dateRaw = Array.isArray(dtstart) ? dtstart[0] : dtstart;
    const summary = typeof ev?.summary === 'string' ? ev.summary.trim() : '';
    const iso = toIsoDate(String(dateRaw || ''));
    if (!iso) {
      warnings.push(`vevent[${i}]: missing or invalid dtstart (${dateRaw ?? '∅'}) — skipped.`);
      continue;
    }
    if (!summary) {
      warnings.push(`vevent[${i}] (${iso}): missing summary — skipped.`);
      continue;
    }
    items.push({ date: iso, name: summary.slice(0, 100) });
  }
  if (items.length === 0) {
    throw new Error('vCalendar contained no usable vevent entries.');
  }
  return { format: 'vcalendar', items, warnings };
}

function parseFlatArray(arr: any[]): ParseResult {
  const warnings: string[] = [];
  const items: ParsedHoliday[] = [];
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i];
    const dateRaw = row?.date ?? row?.Date ?? row?.DATE;
    const nameRaw = row?.name ?? row?.Name ?? row?.NAME ?? row?.summary;
    const iso = toIsoDate(String(dateRaw ?? ''));
    const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
    if (!iso) {
      warnings.push(`row[${i}]: invalid date (${dateRaw ?? '∅'}) — skipped.`);
      continue;
    }
    if (!name) {
      warnings.push(`row[${i}] (${iso}): missing name — skipped.`);
      continue;
    }
    items.push({ date: iso, name: name.slice(0, 100) });
  }
  if (items.length === 0) {
    throw new Error('Array contained no holidays with valid date + name.');
  }
  return { format: 'json', items, warnings };
}

// ---------- CSV ----------
function parseCsvText(text: string): ParseResult {
  const warnings: string[] = [];
  const items: ParsedHoliday[] = [];
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    throw new Error('CSV file is empty.');
  }
  // Detect header: first row whose first cell looks like the word "date" (case-insensitive).
  let startIdx = 0;
  const first = rows[0].map(c => c.trim().toLowerCase());
  if (first[0] === 'date') {
    startIdx = 1;
  }
  for (let i = startIdx; i < rows.length; i++) {
    const r = rows[i];
    const dateRaw = r[0];
    const nameRaw = r[1] ?? '';
    const iso = toIsoDate(String(dateRaw ?? '').trim());
    const name = String(nameRaw).trim();
    if (!iso) {
      warnings.push(`row[${i}]: invalid date (${dateRaw ?? '∅'}) — skipped.`);
      continue;
    }
    if (!name) {
      warnings.push(`row[${i}] (${iso}): missing name — skipped.`);
      continue;
    }
    items.push({ date: iso, name: name.slice(0, 100) });
  }
  if (items.length === 0) {
    throw new Error('CSV contained no holidays with valid date + name.');
  }
  return { format: 'csv', items, warnings };
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields with embedded commas
// and "" escapes. Newlines inside quotes preserved (we treat only \n and \r\n).
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip — handled by \n */ }
      else { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] && r[0].trim() !== ''));
}

// ---------- XLSX (dynamic import) ----------
async function parseXlsxFile(file: File): Promise<ParseResult> {
  const warnings: string[] = [];
  // Dynamic import — SheetJS only loads on the first .xlsx upload.
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  if (!wb.SheetNames.length) throw new Error('XLSX file has no sheets.');
  // Use the first sheet. (If a multi-sheet "calendar year per sheet" file is
  // uploaded later, we can add a sheet picker — out of scope for v1.)
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  if (json.length === 0) throw new Error('XLSX sheet is empty.');

  // Detect header: first row whose first cell is "date" (case-insensitive).
  let startIdx = 0;
  const firstCell = String(json[0]?.[0] ?? '').trim().toLowerCase();
  if (firstCell === 'date') startIdx = 1;

  // Find the "name" column index from the header (if present), else assume col 1.
  let nameCol = 1;
  if (startIdx === 1) {
    for (let c = 0; c < (json[0]?.length ?? 0); c++) {
      if (String(json[0][c] ?? '').trim().toLowerCase() === 'name') { nameCol = c; break; }
    }
  }

  const items: ParsedHoliday[] = [];
  for (let i = startIdx; i < json.length; i++) {
    const row = json[i];
    if (!row || row.length === 0) continue;
    const dateRaw = row[0];
    const nameRaw = row[nameCol];
    const iso = toIsoDate(String(dateRaw ?? '').trim());
    const name = String(nameRaw ?? '').trim();
    if (!iso) {
      warnings.push(`row[${i}]: invalid date (${dateRaw ?? '∅'}) — skipped.`);
      continue;
    }
    if (!name) {
      warnings.push(`row[${i}] (${iso}): missing name — skipped.`);
      continue;
    }
    items.push({ date: iso, name: name.slice(0, 100) });
  }
  if (items.length === 0) {
    throw new Error('XLSX contained no holidays with valid date + name.');
  }
  return { format: 'xlsx', items, warnings };
}

// ---------- date helper ----------
// Accept "20250101" (vCalendar) or "2025-01-01" (everything else) → "2025-01-01".
// Returns null for anything unparseable.
export function toIsoDate(s: string): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{8}$/.test(trimmed)) {
    const y = trimmed.slice(0, 4);
    const m = trimmed.slice(4, 6);
    const d = trimmed.slice(6, 8);
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`;
    }
  }
  return null;
}

// ---------- short non-crypto hash ----------
// FNV-1a 32-bit, returned as 16 hex chars. Used to key imports so re-uploading
// the same file content updates the existing record (idempotent).
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Mix in length to reduce the chance of collisions on short inputs.
  h ^= s.length;
  h = Math.imul(h, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(2).slice(0, 16);
}

// Read the file as text + compute hash in one pass so the UI can show a hash
// before the user commits the import.
export async function readFileForImport(file: File): Promise<{ text: string; hash: string }> {
  if (file.name.toLowerCase().endsWith('.xlsx')) {
    // xlsx is binary; hash the arrayBuffer instead.
    const buf = await file.arrayBuffer();
    return { text: '', hash: shortHash(arrayBufferToHex(buf)) };
  }
  const text = await file.text();
  return { text, hash: shortHash(text) };
}

function arrayBufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}
