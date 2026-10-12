// Admin → SSO: configurable + testable.
// Mirrors the AdminDatabase card-grid pattern. Source of truth for the
// Microsoft Entra config is the singleton row in `sso_config` (managed
// here), with env vars as bootstrap fallback handled in server/src/sso.ts.
//
// Cards:
//   1. Mode (LOCAL / MIXED / SSO)
//   2. Directory mode (DEMO / GRAPH — search & provision deferred to next phase)
//   3. Microsoft Entra settings (tenant / authority / client / secret)
//   4. Test connection (3-step scoreboard via /api/sso/test)
//   5. Last test summary (read-only, mirrors what Card 4 just persisted)
//
// The plaintext secret never leaves the API server — the FE shows the
// masked form (last 4 chars). To overwrite the secret, type into the
// password field. To keep the existing secret, leave the field blank.
//
// Authorization: this page is wrapped in <RequireRole allow=isAdmin> in
// App.tsx — the Sidebar / route guard hides the menu link for non-ADMIN
// users. The /api/sso/config* endpoints themselves have no API-layer auth
// (parity with /api/db/* and /api/holidays — the frontend gate is the
// demo's gate).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { fmt, escapeHtml } from '../lib/app';
import {
  SsoConfig,
  type SsoConfigView,
  type SsoConfigInput,
  type SsoMode,
  type SsoDirectoryMode
} from '../lib/api/ssoConfig';

export function AdminSso() {
  const [cfg, setCfg] = useState<SsoConfigView | null>(null);
  const [edit, setEdit] = useState<SsoConfigInput | null>(null);
  const [editSecret, setEditSecret] = useState<string>('');
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testRun, setTestRun] = useState<{ ok: boolean; steps: string[]; at: string } | null>(null);

  const load = async () => {
    try {
      const c = await SsoConfig.get();
      setCfg(c);
      setEdit({
        mode: c.mode,
        directoryMode: c.directoryMode,
        tenantId: c.tenantId,
        authorityUrl: c.authorityUrl,
        clientId: c.clientId
      });
      setEditSecret('');
    } catch (e: any) {
      setSaveMsg({ kind: 'err', text: `Load failed: ${e?.message || 'unknown'}` });
    }
  };

  useEffect(() => { load(); }, []);

  const onSave = async () => {
    if (!edit) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: SsoConfigInput = { ...edit };
      // Send the secret only if the user typed a new value. An empty string
      // signals "keep existing" to the server (see saveSsoConfig in
      // server/src/ssoConfig.ts).
      if (editSecret.trim()) payload.clientSecret = editSecret;
      await SsoConfig.save(payload);
      setSaveMsg({ kind: 'ok', text: 'Saved.' });
      setEditSecret('');
      await load();
    } catch (e: any) {
      setSaveMsg({ kind: 'err', text: `Save failed: ${e?.message || 'unknown'}` });
    } finally {
      setSaving(false);
    }
  };

  const onRunTest = async () => {
    setTesting(true);
    setTestRun(null);
    try {
      const r = await SsoConfig.test();
      setTestRun({ ok: r.ok, steps: r.steps, at: new Date().toISOString() });
      // The server persisted last_tested_at + last_test_result + last_test_steps;
      // refresh cfg so Card 5 reflects the new values.
      await load();
    } catch (e: any) {
      setTestRun({ ok: false, steps: [`✗ Network error — ${e?.message || 'unknown'}`], at: new Date().toISOString() });
    } finally {
      setTesting(false);
    }
  };

  return (
    <AppShell title="Identity & SSO">
      <div className="page-header">
        <div>
          <h1>Identity & SSO</h1>
          <div className="page-header__sub">
            Microsoft Entra ID configuration for staff sign-in. Stored in <code>sso_config</code> (singleton row).
            Edit Entra settings → <strong>Save</strong> → optionally <strong>Run test</strong>.
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/admin">← Back to admin</Link>
        </div>
      </div>

      {saveMsg && (
        <div
          className={`alert ${saveMsg.kind === 'ok' ? 'alert--success' : 'alert--danger'}`}
          role="status"
        >
          {saveMsg.kind === 'ok' ? '✓' : '⚠️'} {escapeHtml(saveMsg.text)}
        </div>
      )}

      {/* ---------- Card 1 — Mode ---------- */}
      <section className="card">
        <div className="card__head">
          <div>
            <h2 style={{ margin: 0 }}>Mode</h2>
            <div className="card__sub">
              How staff sign-in is handled. Persists on <strong>Save</strong> in Card 3.
            </div>
          </div>
        </div>
        {edit && (
          <SegmentPill<SsoMode>
            value={edit.mode}
            options={[
              { value: 'LOCAL', label: 'LOCAL', hint: 'Seeded users only. No Microsoft involvement.' },
              { value: 'MIXED', label: 'MIXED', hint: 'Seeded users + SSO lookup fall-through. Recommended for migration.' },
              { value: 'SSO',   label: 'SSO',   hint: 'Microsoft Entra only. Seeded users cannot sign in.' }
            ]}
            onChange={(v) => setEdit({ ...edit, mode: v })}
          />
        )}
      </section>

      {/* ---------- Card 2 — Directory ---------- */}
      <section className="card" style={{ marginTop: 'var(--space-3)' }}>
        <div className="card__head">
          <div>
            <h2 style={{ margin: 0 }}>Directory mode</h2>
            <div className="card__sub">
              Where staff are looked up. <em>Search &amp; provision</em> is a follow-up phase — the toggle here only
              persists the choice for now.
            </div>
          </div>
        </div>
        {edit && (
          <SegmentPill<SsoDirectoryMode>
            value={edit.directoryMode}
            options={[
              { value: 'DEMO', label: 'DEMO', hint: 'In-memory seed list of HKU staff.' },
              { value: 'GRAPH', label: 'GRAPH', hint: 'Microsoft Graph (requires app-only auth — deferred).' }
            ]}
            onChange={(v) => setEdit({ ...edit, directoryMode: v })}
          />
        )}
      </section>

      {/* ---------- Card 3 — Entra settings ---------- */}
      <section className="card" style={{ marginTop: 'var(--space-3)' }}>
        <div className="card__head">
          <div>
            <h2 style={{ margin: 0 }}>Microsoft Entra settings</h2>
            <div className="card__sub">
              Tenant / authority / client come from the Azure Portal app registration. The
              client secret is stored server-side and masked on read.
            </div>
          </div>
        </div>

        {edit ? (
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', rowGap: 'var(--space-2)', columnGap: 'var(--space-3)' }}>
            <label htmlFor="tenantId" className="text-muted text-sm" style={{ alignSelf: 'center' }}>Tenant ID</label>
            <input
              id="tenantId"
              className="form__input"
              type="text"
              value={edit.tenantId}
              placeholder="GUID from Azure Portal → App registrations → Overview"
              onChange={(e) => setEdit({ ...edit, tenantId: e.target.value })}
            />

            <label htmlFor="authorityUrl" className="text-muted text-sm" style={{ alignSelf: 'center' }}>Authority URL</label>
            <input
              id="authorityUrl"
              className="form__input"
              type="text"
              value={edit.authorityUrl}
              placeholder="https://login.microsoftonline.com/{tenant-id}"
              onChange={(e) => setEdit({ ...edit, authorityUrl: e.target.value })}
            />

            <label htmlFor="clientId" className="text-muted text-sm" style={{ alignSelf: 'center' }}>Client ID</label>
            <input
              id="clientId"
              className="form__input"
              type="text"
              value={edit.clientId}
              placeholder="Application (client) ID"
              onChange={(e) => setEdit({ ...edit, clientId: e.target.value })}
            />

            <label htmlFor="clientSecret" className="text-muted text-sm" style={{ alignSelf: 'center' }}>Client secret</label>
            <div>
              <input
                id="clientSecret"
                className="form__input"
                type="password"
                value={editSecret}
                placeholder={cfg?.clientSecretMasked || '(not set)'}
                onChange={(e) => setEditSecret(e.target.value)}
                autoComplete="off"
              />
              <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                Type a new value to overwrite. Leave blank to keep the existing secret stored in
                <code> sso_config</code>. The placeholder shows the last 4 chars of the stored value.
              </div>
            </div>
          </div>
        ) : (
          <div className="alert alert--info" role="status">Loading…</div>
        )}

        <div className="btn-row" style={{ marginTop: 'var(--space-3)' }}>
          <button
            className="btn"
            onClick={onSave}
            disabled={!edit || saving}
            title="Persist mode + directory mode + Entra settings to sso_config"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <span className="text-muted text-sm">
            SSO_REDIRECT_URI is set via env (not editable here) — it's the public URL where Azure will
            redirect back, registered in the Azure AD app.
          </span>
        </div>
      </section>

      {/* ---------- Card 4 — Test connection ---------- */}
      <section className="card" style={{ marginTop: 'var(--space-3)' }}>
        <div className="card__head" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <div>
            <h2 style={{ margin: 0 }}>Test connection</h2>
            <div className="card__sub">
              Three informational checks against Microsoft public endpoints. The result is
              persisted to <code>last_test_result</code> so the summary card below can show it.
            </div>
          </div>
          <div className="btn-row" style={{ marginLeft: 'auto' }}>
            {testRun && (
              <span className={`badge ${testRun.ok ? 'badge--success' : 'badge--danger'}`}>
                {testRun.ok ? '✓ GOOD' : '✗ FAIL'}
              </span>
            )}
            <button
              className="btn btn--sm"
              onClick={onRunTest}
              disabled={testing}
              title="Run the 3-step scoreboard against Microsoft public endpoints"
            >
              {testing ? 'Running…' : '▶ Run test'}
            </button>
          </div>
        </div>

        {testRun ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {testRun.steps.map((step, i) => (
              <li key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0, marginTop: 2 }} className={
                  step.startsWith('✓') ? 'badge badge--success'
                  : step.startsWith('✗') ? 'badge badge--danger'
                  : 'badge badge--warning'
                }>
                  {step.startsWith('✓') ? '✓' : step.startsWith('✗') ? '✗' : '?'}
                </span>
                <span className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{escapeHtml(step.replace(/^[✓✗?]\s*/, ''))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="alert alert--info" role="status">
            Click <strong>Run test</strong> to run the scoreboard. Checks: <em>tenant reachable</em> (openid-configuration),
            <em> client ID present</em> (tenant-bound authorization_endpoint), <em>client secret valid</em> (token endpoint with fake refresh_token).
          </div>
        )}
      </section>

      {/* ---------- Card 5 — Last test summary ---------- */}
      {cfg && (cfg.lastTestedAt || cfg.lastTestSteps) && (
        <section className="card" style={{ marginTop: 'var(--space-3)' }}>
          <div className="card__head">
            <div>
              <h2 style={{ margin: 0 }}>Last test summary</h2>
              <div className="card__sub">
                Most recent run persisted to <code>last_test_result</code> + <code>last_test_steps</code>.
              </div>
            </div>
            {cfg.lastTestResult && (
              <span
                className={`badge ${cfg.lastTestResult === 'GOOD' ? 'badge--success' : 'badge--danger'}`}
                style={{ marginLeft: 'auto' }}
              >
                {cfg.lastTestResult === 'GOOD' ? '✓ GOOD' : '✗ FAIL'}
              </span>
            )}
          </div>
          <dl
            className="kv-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '180px 1fr',
              rowGap: 'var(--space-2)',
              columnGap: 'var(--space-3)',
              margin: 0
            }}
          >
            <dt className="text-muted text-sm">Tested at</dt>
            <dd style={{ margin: 0 }}>
              {cfg.lastTestedAt
                ? <span className="text-sm">{fmt.dateTime(cfg.lastTestedAt)}</span>
                : <span className="text-muted text-sm">never</span>}
            </dd>
            <dt className="text-muted text-sm">Steps</dt>
            <dd style={{ margin: 0 }}>
              {cfg.lastTestSteps && cfg.lastTestSteps.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {cfg.lastTestSteps.map((step, i) => (
                    <li key={i} className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{escapeHtml(step)}</li>
                  ))}
                </ul>
              ) : <span className="text-muted text-sm">—</span>}
            </dd>
          </dl>
        </section>
      )}

    </AppShell>
  );
}

// ---------- helpers ----------
interface SegmentOption<T extends string> {
  value: T;
  label: string;
  hint: string;
}

function SegmentPill<T extends string>({
  value, options, onChange
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`btn ${active ? '' : 'btn--ghost'}`}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            title={opt.hint}
            style={{
              borderColor: active ? 'var(--color-primary, #0ea5e9)' : undefined,
              backgroundColor: active ? 'var(--color-primary, #0ea5e9)' : undefined,
              color: active ? '#fff' : undefined
            }}
          >
            {active ? '● ' : '○ '}{opt.label}
            <span style={{ display: 'block', fontSize: 11, opacity: 0.85, fontWeight: 400 }}>
              {opt.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
