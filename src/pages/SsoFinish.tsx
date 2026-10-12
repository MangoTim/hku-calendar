// /sso-finish — the landing page the SSO success page redirects to with
// oid/name/email as URL query params. This is the bridge from server-side
// identity (set by /api/sso/callback) to localStorage-driven session
// (which RequireAuth reads).
//
// Flow:
//   1. /api/sso/callback renders successHtml (HTML page)
//   2. Inline <script> in successHtml calls /api/auth/session — gets the
//      verified user from the cookie that *just* got set on this response
//   3. Script window-replaces to /sso-finish?oid=…&name=…&email=…&return=/dashboard
//   4. This component:
//      a. If session already set (AuthProvider bootstrap won the race),
//         navigate to `return` — no further work.
//      b. Otherwise reads /api/auth/session again for the email
//      c. Looks up the email against the admin-controlled sso_users
//         allowlist via /api/sso/users/lookup
//      d. If a row matches and is enabled → sign in as that row
//      e. If no row matches → "No account registered" page
//      f. If row matches but enabled=false → "Account disabled" page
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { SsoUsers } from '../lib/api/ssoUsers';
import { Session } from '../lib/app';

type SsoError = {
  email: string;
  name: string;
  oid: string;
  reason?: 'not-registered' | 'disabled';
};

export function SsoFinish() {
  const [searchParams] = useSearchParams();
  const { session, signIn } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<SsoError | null>(null);

  useEffect(() => {
    // If the AuthProvider bootstrap already populated localStorage (because
    // the same email maps to an enabled sso_users row), just continue to the
    // return URL — no need to sign in again.
    if (session) {
      nav(searchParams.get('return') || '/dashboard', { replace: true });
      return;
    }

    (async () => {
      let ssoEmail = '';
      let ssoName = '';
      let ssoOid = '';
      try {
        const r = await fetch('/api/auth/session');
        const { user } = await r.json() as { user: { oid: string; name: string; email: string; source: 'sso' } | null };
        if (!user || user.source !== 'sso') {
          // Not a real SSO session — bounce to /login instead of silently
          // granting anything.
          nav('/login', { replace: true });
          return;
        }
        ssoEmail = user.email;
        ssoName  = user.name;
        ssoOid   = user.oid;
      } catch {
        nav('/login', { replace: true });
        return;
      }

      if (!ssoEmail) {
        // ID token had no email — can't match against the allowlist.
        setError({ email: '', name: ssoName, oid: ssoOid, reason: 'not-registered' });
        return;
      }

      try {
        const { user: local } = await SsoUsers.lookup(ssoEmail);
        if (!local) {
          setError({ email: ssoEmail, name: ssoName, oid: ssoOid, reason: 'not-registered' });
          return;
        }
        if (!local.enabled) {
          setError({ email: ssoEmail, name: ssoName, oid: ssoOid, reason: 'disabled' });
          return;
        }
        // Defensive: AuthProvider's bootstrap effect may have already
        // signed us in during the awaits above. If so, just navigate —
        // calling signIn(local.id) would re-look-up by id in USERS and
        // potentially collide with a seed user sharing that serial.
        if (Session.get()) {
          nav(searchParams.get('return') || '/dashboard', { replace: true });
          return;
        }
        signIn(local.id);
        nav(searchParams.get('return') || '/dashboard', { replace: true });
      } catch {
        // Lookup itself failed (500 etc.) — treat as not-registered so the
        // user isn't silently signed in by an attacker who crashed the
        // lookup endpoint.
        setError({ email: ssoEmail, name: ssoName, oid: ssoOid, reason: 'not-registered' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    const isDisabled = error.reason === 'disabled';
    return (
      <div style={{ padding: 48, fontFamily: 'system-ui', color: '#64748b', textAlign: 'center', background: '#0f172a', minHeight: '100vh' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>{isDisabled ? '🚫' : '🔒'}</div>
        <div style={{ fontSize: 18, color: '#e2e8f0', marginBottom: 8 }}>
          {isDisabled ? 'Account is disabled' : 'No account is registered for your sign-in'}
        </div>
        <div style={{ marginBottom: 4 }}>
          Signed in as <code style={{ color: '#94a3b8' }}>{error.name || '(no name)'}</code>
        </div>
        {error.email && (
          <div style={{ marginBottom: 16 }}>
            <code style={{ color: '#94a3b8' }}>{error.email}</code>
          </div>
        )}
        <div style={{ fontSize: 13, color: '#64748b', maxWidth: 480, margin: '0 auto 20px' }}>
          {isDisabled
            ? 'An administrator has disabled your account. Contact them to re-enable access, then try again.'
            : 'An administrator must add your email to the SSO allowlist on /admin/users before you can sign in. Pick a different sign-in method below, or ask your administrator for access.'}
        </div>
        <button
          className="btn"
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