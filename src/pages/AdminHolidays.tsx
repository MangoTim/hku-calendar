// Admin holidays — list seed + user-added + imported holidays grouped by year,
// plus add/remove forms and file import (.json vCalendar or flat, .csv, .xlsx).
// (Phase 14: storage is on .103 PostgreSQL via HolidayContext; this page is
// the only ADMIN surface for write operations.)
import { useRef, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useHoliday } from '../contexts/HolidayContext';
import { fmt, escapeHtml } from '../lib/app';
import {
  parseHolidayFile,
  readFileForImport,
  type HolidayFormat
} from '../lib/holidayImport';
import type { Holiday, HolidayImport } from '../lib/types';

interface ImportPreview {
  filename: string;
  format: HolidayFormat;
  fileText: string;     // used as hash input; empty string for xlsx (we hash binary)
  items: { date: string; name: string }[];
  warnings: string[];
  importId: string;
}

const FORMAT_LABEL: Record<HolidayFormat, string> = {
  vcalendar: 'vCalendar JSON',
  json: 'Flat JSON',
  csv: 'CSV',
  xlsx: 'Excel'
};

// FNV-1a 32-bit — same algorithm the server uses, so a re-import matches
// the prior server-side record by importId.
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

export function AdminHolidays() {
  const {
    holidays: all, imports, loading, error: ctxError,
    addHoliday, removeHoliday, importHolidays, removeImport, resetHolidays
  } = useHoliday();

  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<number, Holiday[]>();
    for (const h of all) {
      const y = Number(h.date.slice(0, 4));
      if (!map.has(y)) map.set(y, []);
      map.get(y)!.push(h);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [all]);

  // ---- Add holiday (form) ----
  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      setError('Pick a valid date.');
      return;
    }
    if (!newName.trim()) {
      setError('Name is required.');
      return;
    }
    if (all.some(h => h.date === newDate)) {
      const existing = all.find(h => h.date === newDate);
      setError(`${newDate} is already a holiday (${existing?.name}).`);
      return;
    }
    try {
      setBusy(true);
      await addHoliday(newDate, newName);
      setNewDate('');
      setNewName('');
    } catch (e: any) {
      setError(e?.message || 'Could not add holiday.');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (date: string) => {
    if (!confirm(`Remove holiday on ${date}?`)) return;
    try {
      setBusy(true);
      await removeHoliday(date);
    } catch (e: any) {
      setError(e?.message || 'Could not remove holiday.');
    } finally {
      setBusy(false);
    }
  };

  // ---- File import ----
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportSuccess(null);
    setImportPreview(null);
    try {
      const { text: fileText } = await readFileForImport(file);
      const result = await parseHolidayFile(file);
      setImportPreview({
        filename: file.name,
        format: result.format,
        fileText,
        items: result.items,
        warnings: result.warnings,
        importId: shortHash(fileText || file.name)
      });
    } catch (err: any) {
      setImportError(err?.message || 'Could not read this file.');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const cancelPreview = () => {
    setImportPreview(null);
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const commitImport = async () => {
    if (!importPreview) return;
    const { filename, format, fileText, items, importId } = importPreview;
    try {
      setBusy(true);
      const r = await importHolidays(items, { filename, format, fileText, importId });
      let msg = `Imported ${r.added.length} holiday${r.added.length === 1 ? '' : 's'}`;
      if (r.replaced > 0) msg += ` (replaced ${r.replaced} from previous version of this file)`;
      if (r.skipped.length > 0) {
        const seedCount = r.skipped.filter(s => s.reason.includes('seed')).length;
        const dupCount = r.skipped.length - seedCount;
        const parts: string[] = [];
        if (seedCount) parts.push(`${seedCount} already in seed`);
        if (dupCount) parts.push(`${dupCount} already added`);
        msg += ` · skipped ${r.skipped.length} (${parts.join(', ')})`;
      }
      setImportSuccess(msg);
      setImportPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) {
      setImportError(e?.message || 'Could not import this file.');
    } finally {
      setBusy(false);
    }
  };

  const onRemoveImport = async (imp: HolidayImport) => {
    if (!confirm(`Remove ${imp.count} holiday${imp.count === 1 ? '' : 's'} from "${imp.filename}"?`)) return;
    try {
      setBusy(true);
      await removeImport(imp.importId);
      setImportSuccess(`Removed ${imp.count} holiday${imp.count === 1 ? '' : 's'} from ${imp.filename}.`);
    } catch (e: any) {
      setError(e?.message || 'Could not remove import.');
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    if (!confirm('Reset all holiday changes back to seed?')) return;
    try {
      setBusy(true);
      await resetHolidays();
    } catch (e: any) {
      setError(e?.message || 'Could not reset holidays.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Holidays">
      <div className="page-header">
        <div>
          <h1>HK public holidays</h1>
          <div className="page-header__sub">
            {all.length} holidays across {grouped.length} years · shared across all users · new bookings, leave and task due dates are blocked on these dates
          </div>
        </div>
        <div className="page-header__actions">
          <button
            className="btn btn--ghost btn--sm"
            onClick={onReset}
            disabled={busy || loading}
          >
            Reset to seed
          </button>
        </div>
      </div>

      {loading && (
        <div className="alert alert--info" role="status">Loading holidays from the shared database…</div>
      )}
      {ctxError && <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(ctxError)}</div>}
      {error && <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(error)}</div>}
      {importError && <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(importError)}</div>}
      {importSuccess && <div className="alert alert--success" role="alert">✓ {escapeHtml(importSuccess)}</div>}

      {/* ---- Add holiday form ---- */}
      <form className="form card form--2col" onSubmit={onAdd} noValidate>
        <div className="form__row">
          <label className="form__label" htmlFor="newDate">Date</label>
          <input
            id="newDate"
            type="date"
            className="form__input"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
            required
          />
        </div>
        <div className="form__row">
          <label className="form__label" htmlFor="newName">Name</label>
          <input
            id="newName"
            type="text"
            className="form__input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            maxLength={100}
            placeholder="Faculty Foundation Day"
            required
          />
        </div>
        <div className="form__actions form__row--full" style={{ gridColumn: '1 / -1' }}>
          <Link className="btn" to="/admin">← Back to admin</Link>
          <button type="submit" className="btn btn--primary" disabled={busy || loading}>
            + Add holiday
          </button>
        </div>
      </form>

      {/* ---- Import from file ---- */}
      <section className="card" style={{ marginTop: 'var(--space-3)' }}>
        <h2>Import from file</h2>
        <p className="text-muted text-sm" style={{ marginTop: 4 }}>
          Upload a <code>.json</code> (HK 1823 vCalendar, or a flat <code>[&#123;date,name&#125;]</code> array), <code>.csv</code>, or <code>.xlsx</code> with a <code>date</code> + <code>name</code> column.
          Re-uploading the same file replaces its previous entries (shared with all users).
        </p>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv,.xlsx,application/json,text/csv"
            onChange={onPickFile}
            aria-label="Choose a holiday file to import"
            disabled={busy || loading}
          />
        </div>

        {importPreview && (
          <div className="alert alert--info" style={{ marginTop: 'var(--space-3)' }} role="region" aria-label="Import preview">
            <div><strong>{escapeHtml(importPreview.filename)}</strong> · {FORMAT_LABEL[importPreview.format]}</div>
            <div style={{ marginTop: 4 }}>
              Found <strong>{importPreview.items.length}</strong> holiday{importPreview.items.length === 1 ? '' : 's'}
              {importPreview.warnings.length > 0 && (
                <span className="text-muted"> · {importPreview.warnings.length} warning{importPreview.warnings.length === 1 ? '' : 's'}</span>
              )}
            </div>
            {importPreview.warnings.length > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary className="text-sm">Show warnings</summary>
                <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                  {importPreview.warnings.map((w, i) => <li key={i} className="text-sm text-muted">{escapeHtml(w)}</li>)}
                </ul>
              </details>
            )}
            <div className="btn-row" style={{ marginTop: 'var(--space-3)' }}>
              <button className="btn" onClick={cancelPreview} disabled={busy}>Cancel</button>
              <button className="btn btn--primary" onClick={commitImport} disabled={busy}>
                Import {importPreview.items.length} holiday{importPreview.items.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ---- Imported files ---- */}
      {imports.length > 0 && (
        <section className="card" style={{ marginTop: 'var(--space-3)' }}>
          <h2>Imported files <span className="text-muted text-sm">({imports.length})</span></h2>
          <table className="table">
            <thead>
              <tr><th>File</th><th>Format</th><th>Count</th><th>Imported</th><th></th></tr>
            </thead>
            <tbody>
              {imports.map(imp => (
                <tr key={imp.importId}>
                  <td>{escapeHtml(imp.filename)}</td>
                  <td><span className="badge badge--muted">{FORMAT_LABEL[imp.format]}</span></td>
                  <td>{imp.count}</td>
                  <td className="text-muted text-sm">{fmt.dateLong(imp.importedAt.slice(0, 10))} {imp.importedAt.slice(11, 16)}</td>
                  <td className="actions">
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => onRemoveImport(imp)}
                      disabled={busy}
                      style={{ color: 'var(--color-danger)' }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ---- Year-grouped tables ---- */}
      {grouped.map(([year, list]) => (
        <section key={year} className="card" style={{ marginTop: 'var(--space-3)' }}>
          <h2>{year} <span className="text-muted text-sm">({list.length})</span></h2>
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Name</th><th>Source</th><th></th></tr>
            </thead>
            <tbody>
              {list.map(h => (
                <tr key={h.date}>
                  <td>{fmt.dateLong(h.date)}</td>
                  <td>{escapeHtml(h.name)}</td>
                  <td>
                    {h.importId
                      ? <span className="badge badge--muted" title="Added via file import">imported</span>
                      : <span className="text-muted text-sm">seed</span>}
                  </td>
                  <td className="actions">
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => onRemove(h.date)}
                      disabled={busy}
                      style={{ color: 'var(--color-danger)' }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </AppShell>
  );
}
