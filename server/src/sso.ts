// HKU SSO via Microsoft Entra ID (Azure AD). Phase 7b — minimal stub:
//   - GET /api/sso/login     → if AZURE_TENANT_ID + AZURE_CLIENT_ID +
//                              SSO_REDIRECT_URI are set, redirects to the
//                              Azure AD /authorize endpoint (Auth Code +
//                              client_secret flow). Otherwise returns a
//                              friendly 503 HTML page so the front-end
//                              button doesn't 404.
//   - GET /api/sso/callback  → reserved for the real implementation
//                              (code-for-token exchange, JWKS verify,
//                              set session cookie, redirect to dashboard).
// Until Eric registers the redirect URI on the Azure AD app and grants
// admin consent, the env vars are left unset and the 503 page is what the
// user / their teammate will see. Once they are, no code change is needed
// here — just set the env vars in server/.env and the same endpoint does
// the real redirect.

import type { Express } from 'express';

const TENANT       = process.env.AZURE_TENANT_ID;
const CLIENT_ID    = process.env.AZURE_CLIENT_ID;
const REDIRECT_URI = process.env.SSO_REDIRECT_URI;
const POST_LOGIN   = process.env.SSO_POST_LOGIN_REDIRECT || '/dashboard';

export function initSso(app: Express): void {
  app.get('/api/sso/login', (req, res) => {
    if (!TENANT || !CLIENT_ID || !REDIRECT_URI) {
      res.status(503).send(pendingHtml());
      return;
    }
    // Real Azure AD redirect (Auth Code + client_secret, server-side flow).
    const state = randomState();
    res.cookie('sso_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 5 * 60 * 1000
    });
    const url = new URL(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', 'openid profile email User.Read');
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  });

  app.get('/api/sso/callback', (_req, res) => {
    // TODO(Phase 7b): exchange ?code for tokens (server/src/sso.ts POST to
    // /token endpoint with client_secret), verify id_token signature via
    // JWKS at https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys,
    // map oid → internal user, set a session cookie, redirect to POST_LOGIN.
    res.status(501).send('SSO callback not implemented yet — see Phase 7b plan.');
  });
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function pendingHtml(): string {
  // Self-contained 503 page (no app bundle dependency) so the click target
  // never 404s and always explains what's pending.
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
