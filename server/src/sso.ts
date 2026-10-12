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

const REDIRECT_URI  = process.env.SSO_REDIRECT_URI;
const POST_LOGIN    = process.env.SSO_POST_LOGIN_REDIRECT || '/dashboard';
const COOKIE_SECRET = process.env.SSO_COOKIE_SECRET || 'dev-only-not-secure-change-me';

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

    const { code, state, error: azureError, error_description } = req.query as Record<string, string | undefined>;

    // 1. Azure-side errors (user declined, consent missing, etc.)
    if (azureError) {
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
        res.status(500).send(errorHtml('Token exchange failed', `${r.status} ${r.statusText}\n\n${body.slice(0, 500)}`));
        return;
      }
      tokens = await r.json() as typeof tokens;
    } catch (e: any) {
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
    const sessionSecret = new TextEncoder().encode(COOKIE_SECRET);
    const sessionJwt = await new jose.SignJWT(sessionPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(sessionSecret);
    setCookie(res, 'sso_session', sessionJwt, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 8 * 60 * 60 * 1000,
      path: '/'
    });

    // Record the Azure OID onto the matching sso_users row (if any). Fire-
    // and-forget — a missing match (or DB error) doesn't affect this login.
    recordSsoOidByEmail(email, oid).catch(() => { /* no-op */ });

    // 7. Render the success page. For a fully wired demo, redirect to
    // POST_LOGIN instead — but the user wanted to "see whether SSO works"
    // first, so the explicit confirmation page is more useful.
    res.send(successHtml({
      name,
      email,
      oid,
      tenant: cfg.tenantId,
      expires: new Date((payload.exp as number) * 1000).toISOString(),
      postLoginUrl: POST_LOGIN
    }));
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
      const sessionSecret = new TextEncoder().encode(COOKIE_SECRET);
      const { payload } = await jose.jwtVerify(token, sessionSecret, {
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

function successHtml(u: {
  name: string; email: string; oid: string; tenant: string;
  expires: string; postLoginUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>HKU SSO — signed in</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { max-width: 560px; background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
    h1 { margin: 0 0 12px; color: #6ee7b7; font-size: 24px; }
    p { color: #cbd5e1; line-height: 1.55; }
    dl { display: grid; grid-template-columns: 120px 1fr; gap: 8px 16px; margin: 20px 0; }
    dt { color: #94a3b8; font-size: 13px; }
    dd { margin: 0; color: #f1f5f9; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 4px; color: #e0e7ff; font-size: 13px; }
    a.btn { display: inline-block; margin-top: 16px; padding: 10px 18px; background: #00a884; color: #0f172a; border-radius: 6px; text-decoration: none; font-weight: 600; }
    a.btn:hover { background: #00c896; }
    .footer { margin-top: 24px; font-size: 13px; color: #94a3b8; border-top: 1px solid #334155; padding-top: 16px; }
  </style>
  <script>
    // Bridge the verified identity onto the manual Continue button instead
    // of auto-navigating. Previously this called location.replace() to jump
    // straight to /sso-finish, but users reported the success card flashing
    // past in ~1 second without the chance to read/click it. Now the card
    // stays put; clicking Continue passes the oid/name/email + return URL
    // through /sso-finish, which re-validates the cookie and signs the user
    // in.
    //
    // JSON.stringify() here keeps Microsoft's JWT payload values safe to
    // concatenate into JS source — escapeHtml already kept them safe in
    // the HTML above. The /sso-finish React route uses the params
    // diagnostically only; it re-validates the cookie via /api/auth/session
    // before doing anything privileged.
    window.addEventListener('DOMContentLoaded', function () {
      fetch('/api/auth/session').then(function (r) { return r.json(); }).then(function (data) {
        var user = data && data.user;
        if (!user || user.source !== 'sso') return;
        var params = new URLSearchParams({
          oid: user.oid || '',
          name: user.name || '',
          email: user.email || '',
          return: ${JSON.stringify(u.postLoginUrl)}
        });
        var cont = document.getElementById('sso-continue');
        if (cont) cont.href = '/sso-finish?' + params.toString();
      }).catch(function () { /* leave Continue at its static href */ });
    });
  </script>
</head>
<body>
  <div class="card">
    <h1>✅ SSO sign-in successful</h1>
    <p>You are signed in via Microsoft Entra ID. The ID token signature was verified against the Azure AD JWKS endpoint, and a signed session cookie (<code>sso_session</code>) is now set on this domain.</p>
    <dl>
      <dt>Display name</dt><dd>${escapeHtml(u.name)}</dd>
      <dt>Email</dt><dd>${escapeHtml(u.email || '—')}</dd>
      <dt>Azure OID</dt><dd><code>${escapeHtml(u.oid)}</code></dd>
      <dt>Tenant</dt><dd><code>${escapeHtml(u.tenant)}</code></dd>
      <dt>ID token expires</dt><dd><code>${escapeHtml(u.expires)}</code></dd>
    </dl>
    <a class="btn" id="sso-continue" href="${escapeHtml(u.postLoginUrl)}">→ Continue to ${escapeHtml(u.postLoginUrl)}</a>
    <div class="footer">
      Round-trip complete: <code>/api/sso/login</code> → Azure AD → <code>/api/sso/callback</code> (code exchanged, ID token verified, session cookie set).<br />
      Click <strong>Continue</strong> to finish signing in.
    </div>
  </div>
</body>
</html>`;
}
