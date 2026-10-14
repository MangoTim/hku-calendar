// AdminEmail — schedule + templates + manual triggers for the leave
// digests (RFQ §2(c) "Generates and sends a daily leave report via email").
//
// Three independent sections:
//
//   1. Schedule  — enabled toggle, daily hour (UTC), weekly Monday hour
//      (UTC), default-recipient override. PUT /api/email/digest-config.
//   2. Templates — LEAVE_DIGEST + WEEKLY_LEAVE_REPORT, each editable in
//      the same shape as the IT-support template editor on
//      /admin/support. PUT /api/email/templates/:code.
//   3. Run now   — POST /api/email/run-digest + /run-weekly. Uses the
//      digest_runs idempotency key so a manual trigger on the same day
//      as an already-fired scheduler run returns `skipped: 'already-ran'`
//      and doesn't double-send.
//
// Auto-saves are intentionally NOT used; admins click Save to confirm.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { EmailApi } from '../lib/api/email';
import type {
  EmailTemplate,
  EmailTemplateVariable,
  DigestConfig,
  DigestConfigInput,
  DigestRunSummary,
  DigestRunResult
} from '../lib/api/email';
import { fmt, escapeHtml } from '../lib/app';

export function AdminEmail() {
  // --- schedule ---
  const [config, setConfig] = useState<DigestConfig | null>(null);
  const [draft, setDraft] = useState<DigestConfigInput>({
    enabled: true, dailyHour: 8, weeklyHour: 8, defaultRecipient: ''
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSuccess, setConfigSuccess] = useState<string | null>(null);

  // --- templates ---
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [variables, setVariables] = useState<EmailTemplateVariable[]>([]);
  const [selectedCode, setSelectedCode] = useState<string>('LEAVE_DIGEST');
  const [active, setActive] = useState<EmailTemplate | null>(null);
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [useHtml, setUseHtml] = useState(false);
  const [description, setDescription] = useState('');
  const [savingTpl, setSavingTpl] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);
  const [tplSuccess, setTplSuccess] = useState<string | null>(null);
  const [tplDirty, setTplDirty] = useState(false);

  // --- last-run summary + manual triggers ---
  const [lastRuns, setLastRuns] = useState<{ daily: DigestRunSummary | null; weekly: DigestRunSummary | null } | null>(null);
  const [runningDaily, setRunningDaily] = useState(false);
  const [runningWeekly, setRunningWeekly] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<{ job: string; result: DigestRunResult | null; error: string | null } | null>(null);

  // ---- loaders ----
  useEffect(() => {
    let cancelled = false;
    setConfigError(null);
    EmailApi.getDigestConfig()
      .then(c => {
        if (cancelled) return;
        setConfig(c);
        setDraft({
          enabled: c.enabled,
          dailyHour: c.dailyHour,
          weeklyHour: c.weeklyHour,
          defaultRecipient: c.defaultRecipient || ''
        });
      })
      .catch(e => { if (!cancelled) setConfigError((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    EmailApi.listTemplates()
      .then(r => {
        if (cancelled) return;
        setTemplates(r.templates);
        setVariables(r.variables);
        // Default selection to LEAVE_DIGEST if present, otherwise the
        // first non-IT_SUPPORT template (those live on /admin/support).
        const preferred = ['LEAVE_DIGEST', 'WEEKLY_LEAVE_REPORT'].filter(c => r.templates.some(t => t.code === c));
        if (preferred.length > 0 && !preferred.includes(selectedCode)) {
          setSelectedCode(preferred[0]);
        }
      })
      .catch(e => { if (!cancelled) setTplError((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

  // ---- editor: fetch on selection ----
  useEffect(() => {
    if (!selectedCode) { setActive(null); return; }
    let cancelled = false;
    setTplError(null);
    EmailApi.getTemplate(selectedCode)
      .then(r => {
        if (cancelled) return;
        const t = r.template;
        setActive(t);
        setSubject(t.subject);
        setBodyText(t.bodyText);
        setBodyHtml(t.bodyHtml ?? '');
        setUseHtml(Boolean(t.bodyHtml));
        setDescription(t.description ?? '');
        setTplDirty(false);
      })
      .catch(e => { if (!cancelled) setTplError((e as Error).message); });
    return () => { cancelled = true; };
  }, [selectedCode]);

  // ---- editor: dirtiness ----
  useEffect(() => {
    if (!active) { setTplDirty(false); return; }
    const htmlChanged = useHtml
      ? bodyHtml !== (active.bodyHtml ?? '')
      : Boolean(active.bodyHtml) && bodyHtml === '';
    setTplDirty(
      subject !== active.subject ||
      bodyText !== active.bodyText ||
      htmlChanged ||
      (description || '') !== (active.description || '')
    );
  }, [subject, bodyText, bodyHtml, useHtml, description, active]);

  // ---- last-run loader ----
  const refreshLastRuns = async () => {
    try {
      const r = await EmailApi.lastDigestRun();
      setLastRuns(r);
    } catch {
      // Non-fatal; table may not be seeded on first boot.
    }
  };
  useEffect(() => { refreshLastRuns(); }, []);

  // ---- save schedule ----
  const onSaveConfig = async () => {
    const recipient = (draft.defaultRecipient || '').trim();
    if (recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setConfigError(`"${recipient}" does not look like an email address.`);
      return;
    }
    if (draft.dailyHour < 0 || draft.dailyHour > 23 || draft.weeklyHour < 0 || draft.weeklyHour > 23) {
      setConfigError('Hours must be 0–23 (UTC).');
      return;
    }
    setSavingConfig(true);
    setConfigError(null);
    setConfigSuccess(null);
    try {
      await EmailApi.updateDigestConfig({
        enabled: draft.enabled,
        dailyHour: Math.floor(draft.dailyHour),
        weeklyHour: Math.floor(draft.weeklyHour),
        defaultRecipient: recipient
      });
      setConfig({
        enabled: draft.enabled,
        dailyHour: draft.dailyHour,
        weeklyHour: draft.weeklyHour,
        defaultRecipient: recipient
      });
      setConfigSuccess('Schedule saved. The next scheduler tick will use the new hour.');
      setTimeout(() => setConfigSuccess(null), 4000);
    } catch (e: any) {
      setConfigError(e?.message || 'Could not save schedule.');
    } finally {
      setSavingConfig(false);
    }
  };

  // ---- save template ----
  const onSaveTpl = async () => {
    if (!active) return;
    if (!subject.trim()) { setTplError('Subject is required.'); return; }
    if (!bodyText.trim()) { setTplError('Body text is required.'); return; }
    setSavingTpl(true);
    setTplError(null);
    setTplSuccess(null);
    try {
      const r = await EmailApi.updateTemplate(active.code, {
        subject: subject.trim(),
        bodyText,
        bodyHtml: useHtml ? bodyHtml : null,
        description: description.trim()
      });
      setActive(r.template);
      setTemplates(prev => prev.map(t => t.code === r.template.code ? r.template : t));
      setTplSuccess(`Saved template "${r.template.code}". Next digest run uses this.`);
      setTplDirty(false);
      setTimeout(() => setTplSuccess(null), 4000);
    } catch (e: any) {
      setTplError(e?.message || 'Could not save template.');
    } finally {
      setSavingTpl(false);
    }
  };

  const onResetTpl = () => {
    if (!active) return;
    if (tplDirty && !confirm(`Discard unsaved changes to "${active.code}"?`)) return;
    setSubject(active.subject);
    setBodyText(active.bodyText);
    setBodyHtml(active.bodyHtml ?? '');
    setUseHtml(Boolean(active.bodyHtml));
    setDescription(active.description ?? '');
  };

  // ---- manual triggers ----
  const onRunDaily = async () => {
    setRunningDaily(true);
    setLastRunResult(null);
    try {
      const r = await EmailApi.runDailyDigest();
      setLastRunResult({ job: r.job, result: r, error: null });
      await refreshLastRuns();
    } catch (e: any) {
      setLastRunResult({ job: 'DAILY_LEAVE_DIGEST', result: null, error: e?.message || 'Run failed' });
    } finally {
      setRunningDaily(false);
    }
  };
  const onRunWeekly = async () => {
    setRunningWeekly(true);
    setLastRunResult(null);
    try {
      const r = await EmailApi.runWeeklyDigest();
      setLastRunResult({ job: r.job, result: r, error: null });
      await refreshLastRuns();
    } catch (e: any) {
      setLastRunResult({ job: 'WEEKLY_LEAVE_REPORT', result: null, error: e?.message || 'Run failed' });
    } finally {
      setRunningWeekly(false);
    }
  };

  const digestTemplates = templates.filter(t => t.code === 'LEAVE_DIGEST' || t.code === 'WEEKLY_LEAVE_REPORT');
  const configDirty = !!config && (
    draft.enabled !== config.enabled ||
    draft.dailyHour !== config.dailyHour ||
    draft.weeklyHour !== config.weeklyHour ||
    (draft.defaultRecipient || '').trim() !== (config.defaultRecipient || '').trim()
  );

  return (
    <AppShell title="Email & digests">
      <div className="page-header">
        <div>
          <h1>Email & digests</h1>
          <div className="page-header__sub">
            Daily + weekly leave report schedule, recipient override, templates, and manual triggers.
            IT-support templates live on <Link to="/admin/support">/admin/support</Link>.
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/admin">← Back to admin</Link>
        </div>
      </div>

      {configError && <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(configError)}</div>}
      {configSuccess && <div className="alert alert--success" role="alert">✓ {escapeHtml(configSuccess)}</div>}
      {tplError && <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(tplError)}</div>}
      {tplSuccess && <div className="alert alert--success" role="alert">✓ {escapeHtml(tplSuccess)}</div>}

      {/* ---------- Schedule ---------- */}
      <section className="card" style={{ marginTop: 'var(--space-3)' }}>
        <div className="page-header" style={{ marginBottom: 'var(--space-3)' }}>
          <div>
            <h2 style={{ margin: 0 }}>Schedule</h2>
            <div className="text-muted text-sm" style={{ marginTop: 4 }}>
              Hours are in <strong>UTC</strong>. The scheduler reads these on the next tick, so changes take
              effect without a restart.
            </div>
          </div>
          <span className={`badge badge--${config?.enabled ? 'success' : 'muted'}`}>
            {config?.enabled ? 'DIGESTS ENABLED' : 'DIGESTS DISABLED'}
          </span>
        </div>

        {!config ? (
          <div className="empty">Loading schedule…</div>
        ) : (
          <>
            <div className="form__row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))}
                />
                Send leave digests
              </label>
              <span className="form__hint text-muted">
                When off, the scheduler still ticks but skips the email send (digest_runs row is recorded as EMPTY).
              </span>
            </div>

            <div className="form form--2col">
              <div className="form__row">
                <label className="form__label" htmlFor="dailyHour">Daily digest hour (UTC)</label>
                <input
                  id="dailyHour"
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  className="form__input"
                  value={draft.dailyHour}
                  onChange={e => setDraft(d => ({ ...d, dailyHour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) }))}
                />
                <span className="form__hint text-muted">
                  Today's bookings + leave, per team. Default: 08:00 UTC.
                </span>
              </div>
              <div className="form__row">
                <label className="form__label" htmlFor="weeklyHour">Weekly digest hour (UTC, Monday)</label>
                <input
                  id="weeklyHour"
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  className="form__input"
                  value={draft.weeklyHour}
                  onChange={e => setDraft(d => ({ ...d, weeklyHour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) }))}
                />
                <span className="form__hint text-muted">
                  Next 14 days across all teams. Default: 08:00 UTC on Monday.
                </span>
              </div>
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="defaultRecipient">Default recipient</label>
              <input
                id="defaultRecipient"
                type="email"
                className="form__input"
                value={draft.defaultRecipient || ''}
                onChange={e => setDraft(d => ({ ...d, defaultRecipient: e.target.value }))}
                placeholder="someone@example.com"
                maxLength={200}
                autoComplete="off"
              />
              <span className="form__hint text-muted">
                Until per-user opt-in flags are stored server-side, this is the single mailbox the digest goes
                to. Leave empty to suppress the digest (the scheduler will record EMPTY and log a warning).
              </span>
            </div>

            <div className="form__actions">
              <button
                type="button"
                className="btn"
                onClick={() => setDraft({
                  enabled: config.enabled,
                  dailyHour: config.dailyHour,
                  weeklyHour: config.weeklyHour,
                  defaultRecipient: config.defaultRecipient || ''
                })}
                disabled={savingConfig || !configDirty}
              >
                Discard
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={onSaveConfig}
                disabled={savingConfig || !configDirty}
              >
                {savingConfig ? 'Saving…' : 'Save schedule'}
              </button>
            </div>
          </>
        )}
      </section>

      {/* ---------- Manual triggers ---------- */}
      <section className="card" style={{ marginTop: 'var(--space-3)' }}>
        <div className="page-header" style={{ marginBottom: 'var(--space-3)' }}>
          <div>
            <h2 style={{ margin: 0 }}>Run now</h2>
            <div className="text-muted text-sm" style={{ marginTop: 4 }}>
              Fires the digest immediately using today's data. Idempotency
              (<code>digest_runs</code>) means re-running on the same day returns
              <code> skipped: 'already-ran'</code> rather than double-sending.
            </div>
          </div>
        </div>

        <div className="btn-row">
          <button
            type="button"
            className="btn btn--primary"
            onClick={onRunDaily}
            disabled={runningDaily || runningWeekly}
          >
            {runningDaily ? 'Running…' : '▶ Send today\'s digest now'}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onRunWeekly}
            disabled={runningDaily || runningWeekly}
          >
            {runningWeekly ? 'Running…' : '▶ Send this week\'s leave report now'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={refreshLastRuns}
            disabled={runningDaily || runningWeekly}
          >
            ⟳ Refresh last-run
          </button>
        </div>

        {lastRunResult && (
          <div
            className={`alert ${lastRunResult.error ? 'alert--danger' : lastRunResult.result?.skipped ? 'alert--warning' : 'alert--success'}`}
            role="alert"
            style={{ marginTop: 'var(--space-3)' }}
          >
            {lastRunResult.error ? (
              <span>⚠️ <strong>{lastRunResult.job}</strong> failed: {escapeHtml(lastRunResult.error)}</span>
            ) : lastRunResult.result ? (
              lastRunResult.result.skipped === 'already-ran' ? (
                <span>⏭️ <strong>{lastRunResult.result.job}</strong> already ran today ({lastRunResult.result.runDate}) — skipped.</span>
              ) : lastRunResult.result.ok ? (
                <span>✓ <strong>{lastRunResult.result.job}</strong> sent ({lastRunResult.result.runDate}) to {lastRunResult.result.recipients} recipient(s).</span>
              ) : (
                <span>⚠️ <strong>{lastRunResult.result.job}</strong> finished with errors: {escapeHtml(lastRunResult.result.error || 'unknown')}</span>
              )
            ) : null}
          </div>
        )}

        <h3 style={{ marginTop: 'var(--space-3)' }}>Last runs</h3>
        {!lastRuns ? (
          <div className="empty">Loading…</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Last run date</th>
                  <th>Status</th>
                  <th>Recipients</th>
                  <th>Finished at</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>DAILY_LEAVE_DIGEST</code></td>
                  <td>{lastRuns.daily ? escapeHtml(lastRuns.daily.run_date) : <span className="text-muted">never</span>}</td>
                  <td>{lastRuns.daily ? <RunStatus status={lastRuns.daily.status} /> : <span className="text-muted">—</span>}</td>
                  <td>{lastRuns.daily?.recipients_count ?? 0}</td>
                  <td className="text-sm text-muted">{lastRuns.daily?.finished_at ? fmt.dateTime(lastRuns.daily.finished_at) : '—'}</td>
                  <td className="text-sm text-muted">{lastRuns.daily?.error ? escapeHtml(lastRuns.daily.error) : '—'}</td>
                </tr>
                <tr>
                  <td><code>WEEKLY_LEAVE_REPORT</code></td>
                  <td>{lastRuns.weekly ? escapeHtml(lastRuns.weekly.run_date) : <span className="text-muted">never</span>}</td>
                  <td>{lastRuns.weekly ? <RunStatus status={lastRuns.weekly.status} /> : <span className="text-muted">—</span>}</td>
                  <td>{lastRuns.weekly?.recipients_count ?? 0}</td>
                  <td className="text-sm text-muted">{lastRuns.weekly?.finished_at ? fmt.dateTime(lastRuns.weekly.finished_at) : '—'}</td>
                  <td className="text-sm text-muted">{lastRuns.weekly?.error ? escapeHtml(lastRuns.weekly.error) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------- Templates ---------- */}
      <section className="card" style={{ marginTop: 'var(--space-3)' }}>
        <div className="page-header" style={{ marginBottom: 'var(--space-3)' }}>
          <div>
            <h2 style={{ margin: 0 }}>Templates</h2>
            <div className="text-muted text-sm" style={{ marginTop: 4 }}>
              Digest bodies. The IT-support template is on <Link to="/admin/support">/admin/support</Link>.
            </div>
          </div>
        </div>

        {digestTemplates.length === 0 ? (
          <div className="empty">
            No digest templates seeded yet. The server falls back to built-in defaults at send time —
            see <code>server/src/emailTemplates.ts</code>.
          </div>
        ) : (
          <>
            <div className="toolbar" style={{ flexWrap: 'wrap' }}>
              <label className="form__label" htmlFor="tplSelect" style={{ margin: 0 }}>Template</label>
              <select
                id="tplSelect"
                className="form__select"
                value={selectedCode}
                onChange={e => setSelectedCode(e.target.value)}
                style={{ maxWidth: 360 }}
              >
                {digestTemplates.map(t => (
                  <option key={t.code} value={t.code}>
                    {t.code} — {t.description || '(no description)'}
                  </option>
                ))}
              </select>
              <div className="toolbar__sep" />
              {active && (
                <span className="text-muted text-sm">
                  Last updated {fmt.dateTime(active.updatedAt)}
                </span>
              )}
            </div>

            {active && (
              <form
                onSubmit={e => { e.preventDefault(); onSaveTpl(); }}
                style={{ marginTop: 'var(--space-3)' }}
              >
                <div className="form__row">
                  <label className="form__label" htmlFor="tplSubject">Subject</label>
                  <input
                    id="tplSubject"
                    className="form__input"
                    type="text"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    maxLength={200}
                    required
                  />
                </div>

                <div className="form__row">
                  <label className="form__label" htmlFor="tplBodyText">Body (plain text, required)</label>
                  <textarea
                    id="tplBodyText"
                    className="form__textarea"
                    value={bodyText}
                    onChange={e => setBodyText(e.target.value)}
                    rows={14}
                    spellCheck={false}
                    required
                    style={{ fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)' }}
                  />
                  <span className="form__hint text-muted">{bodyText.length.toLocaleString()} chars.</span>
                </div>

                <div className="form__row">
                  <label className="form__label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={useHtml}
                      onChange={e => setUseHtml(e.target.checked)}
                    />
                    Provide an HTML body (advanced)
                  </label>
                  {useHtml && (
                    <textarea
                      className="form__textarea"
                      value={bodyHtml}
                      onChange={e => setBodyHtml(e.target.value)}
                      rows={10}
                      spellCheck={false}
                      style={{ fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)' }}
                    />
                  )}
                </div>

                <div className="form__row">
                  <label className="form__label" htmlFor="tplDesc">Description (optional)</label>
                  <input
                    id="tplDesc"
                    className="form__input"
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    maxLength={200}
                    placeholder="Shown in the template picker dropdown."
                  />
                </div>

                <div className="form__actions">
                  <button type="button" className="btn" onClick={onResetTpl} disabled={savingTpl || !tplDirty}>
                    Discard changes
                  </button>
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={savingTpl || !tplDirty || !subject.trim() || !bodyText.trim()}
                  >
                    {savingTpl ? 'Saving…' : 'Save template'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </section>

      {/* ---------- Variable reference ---------- */}
      {variables.length > 0 && (
        <section className="card" style={{ marginTop: 'var(--space-3)' }}>
          <h2 style={{ marginTop: 0 }}>Available variables</h2>
          <p className="text-muted text-sm">
            Tokens used by both digest templates. See <code>/admin/support</code> for the IT-support template's variables.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 220 }}>Token</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {variables
                  .filter(v => ['displayName','team','totalBookings','totalLeave','fromDate','toDate'].includes(v.name))
                  .map(v => (
                    <tr key={v.name}>
                      <td><code>&#123;&#123;{escapeHtml(v.name)}&#125;&#125;</code></td>
                      <td className="text-sm text-muted">{escapeHtml(v.description)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AppShell>
  );
}

function RunStatus({ status }: { status: 'STARTED' | 'OK' | 'EMPTY' | 'FAILED' }) {
  const klass =
    status === 'OK' ? 'success' :
    status === 'EMPTY' ? 'muted' :
    status === 'FAILED' ? 'danger' : 'info';
  return <span className={`badge badge--${klass}`}>{status}</span>;
}
