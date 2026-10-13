// AdminSupport — edit the IT-support email template that goes out to the IT
// team when a booking is saved with itSupport=true. The template lives in
// the email_templates table (server-side) and is fetched/updated via the
// EmailApi. Preview renders the template with sample booking fields so the
// admin can verify the {{tokens}} resolve and that the layout looks right
// before saving. Falls back to the built-in default if the row is empty
// (handled server-side — see server/src/email.ts).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { EmailApi } from '../lib/api/email';
import type { EmailTemplate, EmailConfig, EmailTemplateVariable, ItSupportPreviewPayload } from '../lib/api/email';
import { fmt, escapeHtml } from '../lib/app';

const SAMPLE_BOOKING: ItSupportPreviewPayload = {
  ref: 'RB-0042',
  date: fmt.dateLong('2026-10-15'),
  startTime: '14:00',
  endTime: '15:30',
  room: 'Conference Room A',
  purpose: 'Quarterly review with external vendor',
  supportRequests: 'Projector + speakerphone please; remote join via Teams.',
  booker: { name: 'Grace Ng', email: 'grace.ng@example.com', team: 'Systems' }
};

export function AdminSupport() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [variables, setVariables] = useState<EmailTemplateVariable[]>([]);
  const [selectedCode, setSelectedCode] = useState<string>('IT_SUPPORT');
  const [active, setActive] = useState<EmailTemplate | null>(null);

  // Editor state — initialised when active loads, re-initialised on template switch.
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [useHtml, setUseHtml] = useState(false);
  const [description, setDescription] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; text: string; html: string } | null>(null);

  // IT team email config (separate from template — changes the recipient, not the body)
  const [emailConfig, setEmailConfig] = useState<EmailConfig | null>(null);
  const [draftEmail, setDraftEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailDirty, setEmailDirty] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  // Variable insertion — track which editor field the Insert button targets.
  // Defaults to bodyText; auto-updates when the user focuses a different
  // editor. Refs let Insert restore the cursor position after React re-renders.
  type FieldKey = 'subject' | 'bodyText' | 'bodyHtml';
  const [activeField, setActiveField] = useState<FieldKey>('bodyText');
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyTextRef = useRef<HTMLTextAreaElement>(null);
  const bodyHtmlRef = useRef<HTMLTextAreaElement>(null);

  // Load templates + variable reference once.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    EmailApi.listTemplates()
      .then(r => {
        if (cancelled) return;
        setTemplates(r.templates);
        setVariables(r.variables);
        const initial = r.templates.find(t => t.code === selectedCode) ?? r.templates[0];
        if (initial) setSelectedCode(initial.code);
      })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Re-fetch the full row when selection changes (PUT needs the live updatedAt).
  useEffect(() => {
    if (!selectedCode) { setActive(null); return; }
    let cancelled = false;
    setError(null);
    setPreview(null);
    EmailApi.getTemplate(selectedCode)
      .then(r => {
        if (cancelled) return;
        const tpl = r.template;
        setActive(tpl);
        setSubject(tpl.subject);
        setBodyText(tpl.bodyText);
        setBodyHtml(tpl.bodyHtml ?? '');
        setUseHtml(Boolean(tpl.bodyHtml));
        setDescription(tpl.description ?? '');
        setDirty(false);
      })
      .catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [selectedCode]);

  // Load current IT team email config once.
  useEffect(() => {
    let cancelled = false;
    EmailApi.config()
      .then(r => { if (!cancelled) { setEmailConfig(r); setDraftEmail(r.itTeamEmail); } })
      .catch(() => { /* non-fatal — config section hides */ });
    return () => { cancelled = true; };
  }, []);

  // Track email-field dirtiness against the live config.
  useEffect(() => {
    if (!emailConfig) return;
    setEmailDirty(draftEmail.trim() !== emailConfig.itTeamEmail);
  }, [draftEmail, emailConfig]);

  const onSaveEmail = async () => {
    const trimmed = draftEmail.trim();
    if (!trimmed) { setError('IT team email is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(`"${trimmed}" does not look like an email address.`);
      return;
    }
    setSavingEmail(true);
    setError(null);
    setEmailSuccess(null);
    try {
      const r = await EmailApi.updateConfig(trimmed);
      setEmailConfig(prev => prev ? { ...prev, itTeamEmail: r.itTeamEmail, source: 'db' } : prev);
      setEmailSuccess(`IT team email saved → ${r.itTeamEmail}. The next IT-support booking will go here.`);
      setEmailDirty(false);
      setTimeout(() => setEmailSuccess(null), 4000);
    } catch (e: any) {
      setError(e?.message || 'Could not save IT team email.');
    } finally {
      setSavingEmail(false);
    }
  };

  // Detect dirtiness against the freshly-loaded row so Save is gated.
  useEffect(() => {
    if (!active) return;
    const htmlChanged = useHtml
      ? bodyHtml !== (active.bodyHtml ?? '')
      : Boolean(active.bodyHtml) && bodyHtml === ''; // toggled off
    const changed =
      subject !== active.subject ||
      bodyText !== active.bodyText ||
      htmlChanged ||
      (description || '') !== (active.description || '');
    setDirty(changed);
  }, [subject, bodyText, bodyHtml, useHtml, description, active]);

  const onSave = async () => {
    if (!active) return;
    if (!subject.trim()) { setError('Subject is required.'); return; }
    if (!bodyText.trim()) { setError('Body text is required.'); return; }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        subject: subject.trim(),
        bodyText,
        bodyHtml: useHtml ? bodyHtml : null,
        description: description.trim()
      };
      const r = await EmailApi.updateTemplate(active.code, payload);
      setActive(r.template);
      // Refresh the list summary too.
      setTemplates(prev => prev.map(t => t.code === r.template.code ? r.template : t));
      setSuccess(`Saved template "${r.template.code}". New bookings will use this from now on.`);
      setDirty(false);
      setTimeout(() => setSuccess(null), 3500);
    } catch (e: any) {
      setError(e?.message || 'Could not save template.');
    } finally {
      setSaving(false);
    }
  };

  const onPreview = async () => {
    if (!active) return;
    setPreviewing(true);
    setError(null);
    try {
      const r = await EmailApi.previewTemplate(active.code, SAMPLE_BOOKING);
      setPreview(r);
    } catch (e: any) {
      setError(e?.message || 'Preview failed.');
    } finally {
      setPreviewing(false);
    }
  };

  const onReset = () => {
    if (!active) return;
    if (!confirm(`Discard unsaved changes to "${active.code}"?`)) return;
    setSubject(active.subject);
    setBodyText(active.bodyText);
    setBodyHtml(active.bodyHtml ?? '');
    setUseHtml(Boolean(active.bodyHtml));
    setDescription(active.description ?? '');
    setPreview(null);
  };

  // Insert `{{token}}` at the saved cursor position of the chosen field.
  // Falls back to appending when no cursor info is available (e.g. the
  // user clicked Insert without ever focusing the field).
  const insertToken = (field: FieldKey, name: string) => {
    const token = `{{${name}}}`;
    if (field === 'subject') {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? start;
      const next = subject.slice(0, start) + token + subject.slice(end);
      setSubject(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
    } else if (field === 'bodyText') {
      const el = bodyTextRef.current;
      const start = el?.selectionStart ?? bodyText.length;
      const end = el?.selectionEnd ?? start;
      const next = bodyText.slice(0, start) + token + bodyText.slice(end);
      setBodyText(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      const el = bodyHtmlRef.current;
      const start = el?.selectionStart ?? bodyHtml.length;
      const end = el?.selectionEnd ?? start;
      const next = bodyHtml.slice(0, start) + token + bodyHtml.slice(end);
      setBodyHtml(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
    }
  };

  return (
    <AppShell title="IT support">
      <div className="page-header">
        <div>
          <h1>IT support</h1>
          <div className="page-header__sub">
            Editable templates for IT-team notifications. Bookings flagged with <em>IT support needed</em> send this email automatically.
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/admin">← Back to admin</Link>
        </div>
      </div>

      {error && <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(error)}</div>}
      {success && <div className="alert alert--success" role="alert">✓ {escapeHtml(success)}</div>}
      {emailSuccess && <div className="alert alert--success" role="alert">✓ {escapeHtml(emailSuccess)}</div>}

      {/* ---- IT team email ---- */}
      {emailConfig && (
        <section className="card" style={{ marginTop: 'var(--space-3)' }}>
          <div className="page-header" style={{ marginBottom: 'var(--space-3)' }}>
            <div>
              <h2 style={{ margin: 0 }}>IT team email</h2>
              <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                Recipient for every IT-support booking notification. Stored in the <code>app_config</code> table
                so it can change at runtime.
              </div>
            </div>
            <span
              className={`badge badge--${emailConfig.source === 'db' ? 'success' : emailConfig.source === 'env' ? 'muted' : 'warning'}`}
              title={emailConfig.source === 'db' ? 'Saved to the database by an admin' : emailConfig.source === 'env' ? 'Container -e IT_TEAM_EMAIL env var' : 'Build-time default (no env, no DB override)'}
            >
              source: {emailConfig.source}
            </span>
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="itEmail">Recipient email</label>
            <input
              id="itEmail"
              type="email"
              className="form__input"
              value={draftEmail}
              onChange={e => setDraftEmail(e.target.value)}
              placeholder="it-team@example.com"
              maxLength={200}
              autoComplete="off"
            />
            <span className="form__hint text-muted">
              The next IT-support booking email will go to this address. Reply-To stays set to the booker so IT can reply to them directly.
              {emailConfig.source !== 'db' && (
                <>
                  {' '}Saving will switch the badge to <code>db</code>; the env var / default still exists as a fallback if the row is cleared later.
                </>
              )}
            </span>
          </div>

          <div className="form__actions">
            <button
              type="button"
              className="btn"
              onClick={() => setDraftEmail(emailConfig.itTeamEmail)}
              disabled={savingEmail || !emailDirty}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={onSaveEmail}
              disabled={savingEmail || !emailDirty || !draftEmail.trim()}
            >
              {savingEmail ? 'Saving…' : 'Save IT email'}
            </button>
          </div>
        </section>
      )}

      {/* ---- Template picker ---- */}
      <section className="card" style={{ marginTop: 'var(--space-3)' }}>
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <label className="form__label" htmlFor="tplSelect" style={{ margin: 0 }}>Template</label>
          <select
            id="tplSelect"
            className="form__select"
            value={selectedCode}
            onChange={e => setSelectedCode(e.target.value)}
            disabled={loading || templates.length === 0}
            style={{ maxWidth: 360 }}
          >
            {templates.length === 0 && <option value="">(no templates loaded)</option>}
            {templates.map(t => (
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
      </section>

      {/* ---- Editor ---- */}
      {active && (
        <form
          className="card"
          style={{ marginTop: 'var(--space-3)' }}
          onSubmit={e => { e.preventDefault(); onSave(); }}
        >
          <div className="form__row">
            <label className="form__label" htmlFor="tplSubject">Subject</label>
            <input
              id="tplSubject"
              ref={subjectRef}
              className="form__input"
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              onFocus={() => setActiveField('subject')}
              maxLength={200}
              placeholder="[IT support] {{ref}} — {{date}} {{startTime}}–{{endTime}} · {{room}}"
              required
            />
            <span className="form__hint text-muted">
              Supports <code>&#123;&#123;variable&#125;&#125;</code> tokens. Unknown variables are left as-is so typos show in the preview.
            </span>
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="tplBodyText">Body (plain text, required)</label>
            <textarea
              id="tplBodyText"
              ref={bodyTextRef}
              className="form__textarea"
              value={bodyText}
              onChange={e => setBodyText(e.target.value)}
              onFocus={() => setActiveField('bodyText')}
              rows={14}
              spellCheck={false}
              required
              style={{ fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)' }}
            />
            <span className="form__hint text-muted">
              {bodyText.length.toLocaleString()} chars · always sent. The HTML body below is optional.
            </span>
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
                ref={bodyHtmlRef}
                className="form__textarea"
                value={bodyHtml}
                onChange={e => setBodyHtml(e.target.value)}
                onFocus={() => setActiveField('bodyHtml')}
                rows={10}
                placeholder="<!DOCTYPE html><html><body>…</body></html>"
                spellCheck={false}
                style={{ fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)' }}
              />
            )}
            <span className="form__hint text-muted">
              Leave unchecked and the email goes out as plain text only — both versions are rendered in the preview below.
            </span>
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
            <button type="button" className="btn" onClick={onReset} disabled={saving || !dirty}>
              Discard changes
            </button>
            <button
              type="button"
              className="btn"
              onClick={onPreview}
              disabled={previewing || saving}
            >
              {previewing ? 'Rendering…' : '👁 Preview with sample booking'}
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={saving || !dirty || !subject.trim() || !bodyText.trim()}
            >
              {saving ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </form>
      )}

      {/* ---- Variable reference + click-to-insert ---- */}
      {variables.length > 0 && (
        <section className="card" style={{ marginTop: 'var(--space-3)' }}>
          <div className="page-header" style={{ marginBottom: 'var(--space-3)' }}>
            <div>
              <h2 style={{ margin: 0 }}>Available variables</h2>
              <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                Use these <code>&#123;&#123;tokens&#125;&#125;</code> in the subject or body. They are filled in
                automatically when the email is sent. Click <strong>Insert</strong> to drop the token at your
                cursor.
              </div>
            </div>
          </div>

          {/* ---- Currently saved template reference ---- */}
          {active && (
            <details style={{ marginBottom: 'var(--space-3)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Currently saved template (live in production)
              </summary>
              <div className="card" style={{ marginTop: 'var(--space-2)', padding: 'var(--space-3)', background: 'var(--bg-soft)' }}>
                <div className="form__row">
                  <label className="form__label">Subject</label>
                  <div className="form__input" style={{
                    background: '#fff',
                    fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
                    fontSize: 13
                  }}>
                    {escapeHtml(active.subject)}
                  </div>
                </div>
                <div className="form__row">
                  <label className="form__label">Body (plain text)</label>
                  <pre style={{
                      background: '#fff',
                      padding: 'var(--space-2)',
                      borderRadius: 6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 240,
                      overflow: 'auto',
                      margin: 0,
                      fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
                      fontSize: 12
                    }}>
                      {active.bodyText}
                    </pre>
                </div>
                {active.bodyHtml && (
                  <div className="form__row">
                    <label className="form__label">Body (HTML)</label>
                    <pre style={{
                        background: '#fff',
                        padding: 'var(--space-2)',
                        borderRadius: 6,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: 200,
                        overflow: 'auto',
                        margin: 0,
                        fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
                        fontSize: 12
                      }}>
                        {active.bodyHtml}
                      </pre>
                  </div>
                )}
                <div className="text-muted text-sm" style={{ marginTop: 6 }}>
                  Saved {fmt.dateTime(active.updatedAt)}. Edits above don't reach production until you click <strong>Save template</strong>.
                </div>
              </div>
            </details>
          )}

          {/* ---- Insert target picker ---- */}
          <div className="toolbar" style={{ marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span className="form__label" style={{ margin: 0 }}>Insert into:</span>
            <div className="seg">
              {(['subject', 'bodyText', 'bodyHtml'] as FieldKey[]).map(f => {
                const label = f === 'subject' ? 'Subject' : f === 'bodyText' ? 'Body text' : 'HTML body';
                const enabled = f === 'bodyHtml' ? useHtml : true;
                return (
                  <button
                    key={f}
                    type="button"
                    className={`btn btn--sm ${activeField === f ? 'is-active' : ''}`}
                    onClick={() => setActiveField(f)}
                    disabled={!enabled}
                    title={enabled ? '' : 'Enable the HTML body above first'}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="toolbar__sep" />
            <span className="text-muted text-sm">
              Click <strong>Insert</strong> to place the token at your cursor in the selected field.
            </span>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 220 }}>Token</th>
                  <th>Description</th>
                  <th style={{ width: 130 }}></th>
                </tr>
              </thead>
              <tbody>
                {variables.map(v => (
                  <tr key={v.name}>
                    <td><code>&#123;&#123;{escapeHtml(v.name)}&#125;&#125;</code></td>
                    <td className="text-sm text-muted">{escapeHtml(v.description)}</td>
                    <td>
                      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => navigator.clipboard?.writeText(`{{${v.name}}}`)}
                          title="Copy to clipboard"
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          onClick={() => insertToken(activeField, v.name)}
                          title={`Insert at ${activeField === 'subject' ? 'subject' : activeField === 'bodyText' ? 'body text' : 'HTML body'}`}
                        >
                          + Insert
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---- Preview pane ---- */}
      {active && (
        <section className="card" style={{ marginTop: 'var(--space-3)' }}>
          <h2 style={{ marginTop: 0 }}>Preview</h2>
          {!preview ? (
            <div className="empty">
              Click <strong>Preview with sample booking</strong> to render the template using a sample booking
              ({escapeHtml(SAMPLE_BOOKING.ref)} on {escapeHtml(SAMPLE_BOOKING.date)}). The preview does not send an email.
            </div>
          ) : (
            <>
              <div className="form__row">
                <label className="form__label">Rendered subject</label>
                <div className="form__input" style={{ background: 'var(--bg-soft)', fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)' }}>
                  {escapeHtml(preview.subject)}
                </div>
              </div>

              <div className="form__row">
                <label className="form__label">Plain-text body</label>
                <pre style={{
                  background: 'var(--bg-soft)',
                  padding: 'var(--space-3)',
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 320,
                  overflow: 'auto',
                  margin: 0,
                  fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
                  fontSize: 13
                }}>
                  {preview.text}
                </pre>
              </div>

              {preview.html && (
                <div className="form__row">
                  <label className="form__label">HTML body (rendered)</label>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 'var(--space-3)', maxHeight: 360, overflow: 'auto', background: '#fff' }}>
                    <iframe
                      title="Email HTML preview"
                      srcDoc={preview.html}
                      style={{ width: '100%', minHeight: 240, border: 'none' }}
                      sandbox=""
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ---- All templates summary ---- */}
      {templates.length > 0 && (
        <section className="card" style={{ marginTop: 'var(--space-3)' }}>
          <h2 style={{ marginTop: 0 }}>All templates <span className="text-muted text-sm">({templates.length})</span></h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Updated</th>
                  <th>Subject</th>
                </tr>
              </thead>
              <tbody>
                {templates.map(t => (
                  <tr key={t.code} className={t.code === selectedCode ? 'is-selected' : ''}>
                    <td><code>{escapeHtml(t.code)}</code></td>
                    <td className="text-sm text-muted">{escapeHtml(t.description || '—')}</td>
                    <td className="text-sm text-muted">{fmt.dateTime(t.updatedAt)}</td>
                    <td className="text-sm">{escapeHtml(t.subject)}</td>
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