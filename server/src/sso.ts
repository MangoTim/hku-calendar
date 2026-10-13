// HKU SSO via Microsoft Entra ID (Azure AD). Phase 7b — full round-trip:
//   - GET /api/sso/login     → if all config is available, 302-redirects to
//                              the Azure AD /authorize endpoint (Auth Code +
//                              client_secret flow). Otherwise returns a
//                              friendly 503 HTML page so the front-end
//                              button doesn't 404.
//   - GET /api/sso/callback  → exchanges ?code for tokens, verifies the
//                              id_token signature against the Azure AD
//                              JWKS endpoint, renders a "you're signed in
//                              as <name>" success page. Sets a server-side
//                              session cookie so a follow-up
//                              GET /api/auth/session can return the user.
//
// Config source-of-truth: the singleton row in `sso_config` (managed by
// /admin/sso). The env vars AZURE_TENANT_ID / AZURE_CLIENT_ID /
// AZURE_CLIENT_SECRET bootstrap the row on first boot and are used as a
// fallback if the DB row is empty (cold deploy). After admins save via the
// UI, env vars are ignored.
//
// SSO_REDIRECT_URI stays env-only — it's the public-facing URL where the
// container is reachable, registered in Azure AD. Admins should never edit
// this through the UI.

import type { Express, Request } from 'express';
import * as jose from 'jose';
import { getSsoConfig, type SsoDbConfig } from './ssoConfig.ts';
import { recordSsoOidByEmail } from './ssoUsers.ts';
import { COOKIE_SECRET } from './cookieSecret.ts';
import { logAudit, logSystem } from './audit.ts';

const REDIRECT_URI  = process.env.SSO_REDIRECT_URI;
const POST_LOGIN    = process.env.SSO_POST_LOGIN_REDIRECT || '/dashboard';

/** Lazy-cached effective SSO config. Cleared on /api/sso/config PUT so
 *  admin edits take effect without restarting the API. */
let _effective: SsoDbConfig | null = null;
async function effective(): Promise<SsoDbConfig> {
  if (_effective) return _effective;
  const db = await getSsoConfig();
  // Env fallback only if the DB row has nothing useful. The DB-seeded
  // row (in db.ts:seedIfEmpty) already prefers env values, so this
  // fallback only fires when the row is genuinely empty.
  if (!db.tenantId)    db.tenantId    = process.env.AZURE_TENANT_ID || '';
  if (!db.clientId)    db.clientId    = process.env.AZURE_CLIENT_ID || '';
  if (!db.clientSecret) db.clientSecret = process.env.AZURE_CLIENT_SECRET || '';
  if (db.tenantId && !db.authorityUrl) {
    db.authorityUrl = `https://login.microsoftonline.com/${db.tenantId}`;
  }
  _effective = db;
  return _effective;
}

/** Called by saveSsoConfig() after a successful admin PUT. Forces the next
 *  /api/sso/* request to re-read from DB. Safe to call from any context. */
export function invalidateEffectiveSso(): void { _effective = null; }

export function initSso(app: Express): void {
  app.get('/api/sso/login', async (req, res) => {
    const cfg = await effective();
    const configured = Boolean(cfg.tenantId && cfg.clientId && cfg.clientSecret && REDIRECT_URI);
    if (!configured) {
      res.status(503).send(pendingHtml());
      return;
    }
    // Real Azure AD redirect (Auth Code + client_secret, server-side flow).
    const state = randomState();
    setCookie(res, 'sso_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 5 * 60 * 1000
    });
    const url = new URL(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize`);
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', REDIRECT_URI!);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', 'openid profile email User.Read');
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  });

  app.get('/api/sso/callback', async (req, res) => {
    const cfg = await effective();
    const configured = Boolean(cfg.tenantId && cfg.clientId && cfg.clientSecret && REDIRECT_URI);
    if (!configured) {
      res.status(503).send('SSO not configured — see /api/sso/login for setup instructions.');
      return;
    }

    const ip = clientIp(req);
    const { code, state, error: azureError, error_description } = req.query as Record<string, string | undefined>;

    // 1. Azure-side errors (user declined, consent missing, etc.)
    if (azureError) {
      await logAudit({
        actorUsername: 'anonymous',
        actorUserId: null,
        actionType: 'SSO_LOGIN_FAILURE',
        resourceType: 'sso',
        summary: `Azure returned ${azureError}${error_description ? ` — ${error_description}` : ''}`,
        ipAddress: ip,
        success: false
      });
      res.status(400).send(errorHtml(
        'Azure returned an error',
        `${azureError}${error_description ? ` — ${error_description}` : ''}`
      ));
      return;
    }

    if (!code || !state) {
      res.status(400).send(errorHtml('Missing parameters', 'Both ?code and ?state are required.'));
      return;
    }

    // 2. CSRF guard — state must match the cookie set at /api/sso/login.
    const cookieState = readCookie(req, 'sso_state');
    if (!cookieState || cookieState !== state) {
      await logAudit({
        actorUsername: 'anonymous',
        actorUserId: null,
        actionType: 'SSO_LOGIN_FAILURE',
        resourceType: 'sso',
        summary: 'state mismatch (possible CSRF or stale request)',
        ipAddress: ip,
        success: false
      });
      res.status(400).send(errorHtml('State mismatch', 'The state parameter did not match the sso_state cookie. Possible CSRF attack or stale request — try signing in again.'));
      return;
    }
    // Single-use: clear the state cookie now that we've consumed it.
    clearCookie(res, 'sso_state');

    // 3. Exchange code for tokens.
    let tokens: { id_token: string; access_token?: string; expires_in?: number };
    try {
      const r = await fetch(
        `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            code,
            redirect_uri: REDIRECT_URI!,
            grant_type: 'authorization_code',
            scope: 'openid profile email User.Read'
          })
        }
      );
      if (!r.ok) {
        const body = await r.text();
        await logAudit({
          actorUsername: 'anonymous',
          actorUserId: null,
          actionType: 'SSO_LOGIN_FAILURE',
          resourceType: 'sso',
          summary: `token exchange failed: ${r.status} ${r.statusText}`,
          ipAddress: ip,
          success: false
        });
        res.status(500).send(errorHtml('Token exchange failed', `${r.status} ${r.statusText}\n\n${body.slice(0, 500)}`));
        return;
      }
      tokens = await r.json() as typeof tokens;
    } catch (e: any) {
      await logAudit({
        actorUsername: 'anonymous',
        actorUserId: null,
        actionType: 'SSO_LOGIN_FAILURE',
        resourceType: 'sso',
        summary: `token exchange network error: ${(e as Error).message}`,
        ipAddress: ip,
        success: false
      });
      res.status(500).send(errorHtml('Token exchange network error', (e as Error).message));
      return;
    }

    // 4. Verify the id_token signature + standard claims.
    // JWKS is cached by jose and refreshed on key rotation.
    const JWKS = jose.createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${cfg.tenantId}/discovery/v2.0/keys`)
    );
    let payload: jose.JWTPayload & { oid: string; name?: string; email?: string; preferred_username?: string };
    try {
      const verified = await jose.jwtVerify(tokens.id_token, JWKS, {
        issuer: `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`,
        audience: cfg.clientId
      });
      payload = verified.payload as typeof payload;
    } catch (e: any) {
      await logAudit({
        actorUsername: 'anonymous',
        actorUserId: null,
        actionType: 'SSO_LOGIN_FAILURE',
        resourceType: 'sso',
        summary: `id_token verification failed: ${(e as Error).message}`,
        ipAddress: ip,
        success: false
      });
      res.status(401).send(errorHtml('ID token verification failed', (e as Error).message));
      return;
    }

    // 5. Extract user info.
    const oid = payload.oid;
    const name = payload.name || payload.preferred_username || 'Unknown';
    const email = payload.email || payload.preferred_username || '';

    // 6. Set a signed session cookie so a follow-up GET /api/auth/session
    // can return the user to the frontend. JWS-signed with HMAC for
    // tamper-resistance (not for confidentiality — name/email aren't
    // sensitive in this demo).
    const sessionPayload = { oid, name, email, iat: Math.floor(Date.now() / 1000) };
    const sessionJwt = await new jose.SignJWT(sessionPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(COOKIE_SECRET);
    setCookie(res, 'sso_session', sessionJwt, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 8 * 60 * 60 * 1000,
      path: '/'
    });

    // Audit: Azure-side authentication succeeded and sso_session cookie
    // was issued. The FE bridge (SsoFinish) then performs the allowlist
    // check separately; we record the Azure-level success here so the
    // admin page shows who has been knocking at the door even when they
    // are not in the allowlist.
    await logAudit({
      actorUsername: email || 'unknown',
      actorUserId: null,
      actionType: 'SSO_LOGIN_SUCCESS',
      resourceType: 'sso',
      resourceId: oid,
      summary: `Azure SSO completed for ${email || 'unknown'} (oid=${oid})`,
      ipAddress: ip,
      success: true
    });

    // Record the Azure OID onto the matching sso_users row (if any). Fire-
    // and-forget — a missing match (or DB error) doesn't affect this login.
    recordSsoOidByEmail(email, oid).catch(() => { /* no-op */ });

    // Hand off to /sso-finish, which reads the cookie (set above) and
    // resolves the user via the sso_users allowlist:
    //   - allowed & enabled → sign in, redirect to POST_LOGIN
    //   - not in allowlist  → render the "No account is registered" page
    //   - in allowlist but disabled → render the "Account is disabled" page
    // No intermediate successHtml confirmation card — the bridge path
    // alone is the user-facing UX.
    res.redirect('/sso-finish');
  });

  // Used by the FE AuthContext to learn who (if anyone) is signed in via
  // the sso_session cookie. Returns 200 with {user: null} when no cookie.
  app.get('/api/auth/session', async (req, res) => {
    const token = readCookie(req, 'sso_session');
    if (!token) {
      res.json({ user: null });
      return;
    }
    try {
      const { payload } = await jose.jwtVerify(token, COOKIE_SECRET, {
        algorithms: ['HS256']
      });
      res.json({
        user: {
          oid: payload.oid,
          name: payload.name,
          email: payload.email,
          source: 'sso' as const
        }
      });
    } catch {
      // Stale / tampered cookie — clear it and return null.
      clearCookie(res, 'sso_session');
      res.json({ user: null });
    }
  });

  // Sign-out clears the cookie. The FE also needs to clear its own
  // localStorage session, but the SSO side is just this.
  app.post('/api/sso/logout', (_req, res) => {
    clearCookie(res, 'sso_session');
    res.json({ ok: true });
  });
}

// ---------- helpers ----------

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Minimal cookie helpers — avoid pulling in cookie-parser for two reads
// and two writes. Express 5's req.headers.cookie is the raw header.
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setCookie(res: any, name: string, value: string, opts: {
  httpOnly?: boolean; secure?: boolean; sameSite?: 'lax' | 'strict' | 'none';
  maxAge?: number; path?: string;
}): void {
  const segs = [`${name}=${encodeURIComponent(value)}`];
  if (opts.path) segs.push(`Path=${opts.path}`); else segs.push('Path=/');
  if (opts.maxAge != null) segs.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
  if (opts.httpOnly) segs.push('HttpOnly');
  if (opts.secure) segs.push('Secure');
  if (opts.sameSite) segs.push(`SameSite=${opts.sameSite[0].toUpperCase()}${opts.sameSite.slice(1)}`);
  res.append('Set-Cookie', segs.join('; '));
}

function clearCookie(res: any, name: string): void {
  res.append('Set-Cookie', `${name}=; Path=/; Max-Age=0`);
}

/** Client IP for audit logs. Trusts the first hop in X-Forwarded-For if
 *  present (the demo runs behind ngrok / a reverse proxy); otherwise
 *  falls back to the socket remote address. */
function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length > 0) return xff[0];
  return req.socket?.remoteAddress ?? '';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
}

function pendingHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>HKU SSO — setup in progress</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { max-width: 520px; background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
    h1 { margin: 0 0 12px; color: #f8fafc; font-size: 22px; }
    p { color: #cbd5e1; line-height: 1.55; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 4px; color: #f1f5f9; }
    a { color: #38bdf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .footer { margin-top: 24px; font-size: 13px; color: #94a3b8; border-top: 1px solid #334155; padding-top: 16px; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #f59e0b; color: #0f172a; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  </style>
</head>
<body>
  <div class="card">
    <h1><span class="pill">Pending</span> &nbsp; HKU SSO setup in progress</h1>
    <p>Real single sign-on is being configured with the HKU IT network team. The button works — the backend just isn't fully wired up yet.</p>
    <p>Until then, please use the <a href="/login">demo sign-in</a> on the main page.</p>
    <div class="footer">
      Phase 7b · awaiting Azure AD redirect URI registration + admin consent.<br />
      When ready, set <code>AZURE_TENANT_ID</code>, <code>AZURE_CLIENT_ID</code>, <code>AZURE_CLIENT_SECRET</code>, <code>SSO_REDIRECT_URI</code> in <code>server/.env</code> and this page will redirect to Microsoft instead.
    </div>
  </div>
</body>
</html>`;
}

function errorHtml(title: string, detail: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>HKU SSO — error</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { max-width: 640px; background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; }
    h1 { margin: 0 0 12px; color: #fca5a5; font-size: 22px; }
    pre { background: #0f172a; color: #fda4af; padding: 16px; border-radius: 6px; overflow: auto; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
    a { color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚠️ ${escapeHtml(title)}</h1>
    <pre>${escapeHtml(detail)}</pre>
    <p style="margin-top: 24px;"><a href="/api/sso/login">← Try signing in again</a> · <a href="/login">Use demo sign-in instead</a></p>
  </div>
</body>
</html>`;
}
