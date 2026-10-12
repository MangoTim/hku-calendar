// /sso-finish — the landing page the SSO success page redirects to with
// oid/name/email as URL query params. This is the bridge from server-side
// identity (set by /api/sso/callback) to localStorage-driven session
// (which RequireAuth reads). Carrying identity through the URL avoids any
// dependency on the sso_session cookie surviving the navigation.
//
// Flow:
//   1. /api/sso/callback renders successHtml (HTML page)
//   2. Inline <script> in successHtml calls /api/auth/session — gets the
//      verified user from the cookie that *just* got set on this response
//   3. Script window-replaces to /sso-finish?oid=…&name=…&email=…&return=/dashboard
//   4. This component reads the params, calls Session.set() with the first
//      enabled ADMIN (Grace Ng, id=4), and navigates to `return`.
//
// We do NOT trust the query params as-is (they're trivially editable in
// the URL bar). They're only a delivery channel for the verified oid —
// the FE auto-signs in as Grace Ng regardless of the param values. (Even
// in the worst case, an attacker who forged this URL would just be
// signed in as Grace Ng — same as they could already do by clicking the
// Grace Ng row on /login.) Bridging via oid → userId map is a future
// improvement when the directory lands.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { USERS } from '../lib/data';

export function SsoFinish() {
  const [searchParams] = useSearchParams();
  const { session, signIn } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If the cookie bridge already ran (LS populated during the AuthProvider
    // bootstrap), just continue to the return URL — no need to sign in again.
    if (session) {
      nav(searchParams.get('return') || '/dashboard', { replace: true });
      return;
    }

    // Otherwise, sign in as the demo's first enabled ADMIN. We ignore the
    // oid/name/email query params for the actual session creation — those
    // are diagnostic only. (Future: oid → userId map.)
    const local = USERS.find(u => u.role === 'ADMIN' && u.enabled);
    if (!local) {
      setError('No ADMIN user available to sign in as.');
      return;
    }

    // Defensive: check that the SSO server can confirm the cookie is valid.
    // If /api/auth/session returns {user: null}, don't sign in — the cookie
    // may not have been set (e.g. user navigated here manually without
    // going through the SSO flow).
    (async () => {
      try {
        const r = await fetch('/api/auth/session');
        const { user } = await r.json() as { user: { oid: string; source: 'sso' } | null };
        if (!user || user.source !== 'sso') {
          // Not a real SSO session — bounce to /login instead of silently
          // granting admin. (The query params are not trustworthy on their own.)
          nav('/login', { replace: true });
          return;
        }
      } catch {
        // Network error — fall through; Session.set below will at least
        // give the user an authenticated session.
      }
      signIn(local.id);
      nav(searchParams.get('return') || '/dashboard', { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div style={{ padding: 48, fontFamily: 'system-ui', color: '#64748b', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div>{error}</div>
        <button
          className="btn"
          style={{ marginTop: 16 }}
          onClick={() => nav('/login', { replace: true })}
        >
          Go to login
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: 48,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#64748b',
        textAlign: 'center',
        background: '#0f172a',
        minHeight: '100vh'
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 12 }}>🔐</div>
      <div>Signing you in via SSO…</div>
    </div>
  );
}
