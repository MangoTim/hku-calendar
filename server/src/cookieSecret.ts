// Single source of truth for the secret used to sign + verify sso_session
// and local_admin cookies. Both sso.ts (signs in /api/sso/callback) and
// index.ts (verifies in requireSignedIn / requireAdmin / sso/admin
// routes) import this so the default literal lives in exactly one place.
//
// Without this, the two modules used to ship with different default
// literals ('dev-only-not-secure-change-me' vs 'demo-sso-cookie-secret-
// change-me') — a cookie signed by sso.ts would fail verification in
// index.ts when SSO_COOKIE_SECRET was unset, so SSO-signed-in admins
// could sign in (via /api/auth/session, which uses sso.ts's secret) but
// couldn't reach the admin API (which uses index.ts's). Symptom: every
// admin CRUD endpoint returned 401 for SSO admins.
//
// Production must set SSO_COOKIE_SECRET. The default here only exists
// so dev / test setups boot without crashing.

export const COOKIE_SECRET: Uint8Array = new TextEncoder().encode(
  process.env.SSO_COOKIE_SECRET || 'dev-only-not-secure-change-me'
);
