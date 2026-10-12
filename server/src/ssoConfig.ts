// SSO config — singleton row in `sso_config` (PK=1). Read/written by
// /admin/sso, consumed by /api/sso/login + /api/sso/callback via the
// `getEffectiveSso()` helper in sso.ts (which adds env-var bootstrap
// fallback for cold-boot scenarios before the row exists).
//
// testSsoConnection() runs 3 informational checks against Microsoft public
// endpoints. The result is a step-by-step pass/fail list; the flag `ok`
// collapses to a single GOOD/FAIL summary for the FE badge.

import { getPool } from './db.ts';

export type SsoMode = 'LOCAL' | 'MIXED' | 'SSO';
export type DirectoryMode = 'DEMO' | 'GRAPH';

export interface SsoDbConfig {
  id: 1;
  mode: SsoMode;
  directoryMode: DirectoryMode;
  tenantId: string;
  authorityUrl: string;
  clientId: string;
  /** Plaintext. Never returned to the FE — masked client-side before send. */
  clientSecret: string;
  lastTestedAt: string | null;
  lastTestResult: 'GOOD' | 'FAIL' | null;
  lastTestSteps: string[] | null;
}

export interface SsoConfigInput {
  mode: SsoMode;
  directoryMode: DirectoryMode;
  tenantId: string;
  authorityUrl: string;
  clientId: string;
  /** Optional on PUT — empty/missing keeps the existing secret in DB. */
  clientSecret?: string;
}

const ROW: SsoDbConfig = {
  id: 1,
  mode: 'LOCAL',
  directoryMode: 'DEMO',
  tenantId: '',
  authorityUrl: '',
  clientId: '',
  clientSecret: '',
  lastTestedAt: null,
  lastTestResult: null,
  lastTestSteps: null
};

/** Fetches the singleton row. Returns safe defaults if not seeded yet —
 *  callers (sso.ts → getEffectiveSso) layer env-var fallback on top. */
export async function getSsoConfig(): Promise<SsoDbConfig> {
  const r = await getPool().query('SELECT * FROM sso_config WHERE id = 1');
  if (r.rowCount === 0) return { ...ROW };
  return rowToConfig(r.rows[0]);
}

export async function saveSsoConfig(
  input: SsoConfigInput,
  updatedBy: number | null
): Promise<SsoDbConfig> {
  const wantSecret = typeof input.clientSecret === 'string' && input.clientSecret.length > 0;
  if (wantSecret) {
    await getPool().query(
      `UPDATE sso_config
       SET mode=$1, directory_mode=$2, tenant_id=$3, authority_url=$4,
           client_id=$5, client_secret=$6, updated_at=NOW(), updated_by=$7
       WHERE id=1`,
      [input.mode, input.directoryMode, input.tenantId, input.authorityUrl,
       input.clientId, input.clientSecret!, updatedBy]
    );
  } else {
    await getPool().query(
      `UPDATE sso_config
       SET mode=$1, directory_mode=$2, tenant_id=$3, authority_url=$4,
           client_id=$5, updated_at=NOW(), updated_by=$6
       WHERE id=1`,
      [input.mode, input.directoryMode, input.tenantId, input.authorityUrl,
       input.clientId, updatedBy]
    );
  }
  // Admin edits must take effect on the next /api/sso/* hit without an
  // API restart. sso.ts owns the cache; we clear it lazily via dynamic
  // import to avoid a circular module reference at load time.
  try {
    const { invalidateEffectiveSso } = await import('./sso.ts');
    invalidateEffectiveSso();
  } catch { /* sso.ts not importable in some test setups — cache will expire by itself */ }
  return getSsoConfig();
}

/** Returns { ok, steps[] } where ok=true iff every step is ✓.
 *  Also persists lastTestedAt + lastTestResult + lastTestSteps so the UI's
 *  "Last test summary" card can show the most recent run across reloads. */
export async function testSsoConnection(): Promise<{ ok: boolean; steps: string[] }> {
  const cfg = await getSsoConfig();
  const steps: string[] = [];
  let ok = true;

  // ---- Step 1: tenant reachable via OpenID configuration discovery ----
  if (!cfg.tenantId) {
    steps.push('✗ Tenant reachable — tenant ID is empty (set it in Entra settings → Save)');
    ok = false;
  } else {
    try {
      const url = `https://login.microsoftonline.com/${cfg.tenantId}/v2.0/.well-known/openid-configuration`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
      const j = await r.json() as { issuer?: string; authorization_endpoint?: string };
      if (!j.issuer || !j.issuer.includes(cfg.tenantId)) {
        throw new Error(`issuer mismatch (got "${j.issuer || '—'}")`);
      }
      steps.push(`✓ Tenant reachable — ${j.issuer}`);
    } catch (e: any) {
      steps.push(`✗ Tenant reachable — ${(e as Error).message}`);
      ok = false;
    }
  }

  // ---- Step 2: client ID present (cheap proxy: openid config carries the
  // tenant-bound endpoints the registered client_id points to; a fully
  // strict check needs an Auth Code round-trip, deferred to the next phase) ----
  if (!ok || !cfg.tenantId) {
    steps.push('✗ Client ID present — skipped (step 1 failed or tenant empty)');
    ok = false;
  } else {
    try {
      const url = `https://login.microsoftonline.com/${cfg.tenantId}/v2.0/.well-known/openid-configuration`;
      const r = await fetch(url);
      const j = await r.json() as { authorization_endpoint?: string };
      if (j.authorization_endpoint && j.authorization_endpoint.includes('login.microsoftonline.com/') &&
          j.authorization_endpoint.includes(cfg.tenantId)) {
        steps.push(`✓ Client ID present — authorization_endpoint bound to tenant ${cfg.tenantId.slice(0, 8)}…`);
      } else {
        steps.push('✗ Client ID present — no tenant-bound authorization_endpoint');
        ok = false;
      }
    } catch (e: any) {
      steps.push(`✗ Client ID present — ${(e as Error).message}`);
      ok = false;
    }
  }

  // ---- Step 3: client secret valid via token endpoint (refresh_token grant
  // with a fake refresh_token). Microsoft returns:
  //   invalid_client — credentials wrong
  //   invalid_grant  — credentials accepted, but the grant is bogus
  // We treat invalid_grant as ✓. ----
  if (!ok || !cfg.tenantId || !cfg.clientId || !cfg.clientSecret) {
    const missing = [];
    if (!cfg.tenantId) missing.push('tenant');
    if (!cfg.clientId) missing.push('clientId');
    if (!cfg.clientSecret) missing.push('clientSecret');
    steps.push(`✗ Client secret valid — skipped (missing: ${missing.join(', ')})`);
    ok = false;
  } else {
    try {
      const url = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: 'fake-token-for-test-only'
        })
      });
      const body = await r.json().catch(() => ({} as any)) as { error?: string; error_description?: string };
      if (body.error === 'invalid_grant') {
        steps.push('✓ Client secret valid — Azure accepted credentials (invalid_grant on fake token = expected)');
      } else if (body.error === 'invalid_client') {
        steps.push(`✗ Client secret valid — invalid_client (Azure rejected client_id/client_secret)`);
        ok = false;
      } else if (body.error) {
        steps.push(`? Client secret valid — unexpected Azure response: ${body.error}${body.error_description ? ' — ' + body.error_description : ''}`);
      } else if (!r.ok) {
        steps.push(`✗ Client secret valid — token endpoint HTTP ${r.status}`);
        ok = false;
      } else {
        steps.push('? Client secret valid — token endpoint returned success (unexpected)');
      }
    } catch (e: any) {
      steps.push(`✗ Client secret valid — network error: ${(e as Error).message}`);
      ok = false;
    }
  }

  // ---- Persist result ----
  await getPool().query(
    `UPDATE sso_config
     SET last_tested_at = NOW(), last_test_result = $1, last_test_steps = $2::jsonb
     WHERE id = 1`,
    [ok ? 'GOOD' : 'FAIL', JSON.stringify(steps)]
  );

  return { ok, steps };
}

// ---------- helpers ----------
function rowToConfig(r: any): SsoDbConfig {
  // last_tested_at: TIMESTAMPTZ → Date in pg → ISO string for FE
  const testedAt = r.last_tested_at instanceof Date ? r.last_tested_at.toISOString() : r.last_tested_at;
  return {
    id: 1,
    mode: r.mode,
    directoryMode: r.directory_mode,
    tenantId: r.tenant_id ?? '',
    authorityUrl: r.authority_url ?? '',
    clientId: r.client_id ?? '',
    clientSecret: r.client_secret ?? '',
    lastTestedAt: testedAt ?? null,
    lastTestResult: r.last_test_result ?? null,
    // pg returns JSONB as already-parsed objects; coerce to string[] for the FE
    lastTestSteps: Array.isArray(r.last_test_steps) ? (r.last_test_steps as string[]) : null
  };
}
