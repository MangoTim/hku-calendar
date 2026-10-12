// AuthContext — wraps the static Session helpers in a React context
// so any component can read the current user, sign in, or sign out.
import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Session, ROLE } from '../lib/app';
import type { Session as SessionType, User, Role } from '../lib/types';
import { USERS } from '../lib/data';
import { SsoUsers } from '../lib/api/ssoUsers';

interface AuthCtx {
  session: SessionType | null;
  user: User | null;
  signIn: (userId: number) => SessionType | null;
  signOut: () => void;
  hasRole: (...roles: Role[]) => boolean;
  ROLE: typeof ROLE;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initial render: read localStorage. If empty, hold children behind a
  // one-tick "Signing you in…" gate so we can probe /api/auth/session for
  // an SSO cookie (set by /api/sso/callback) before any RequireAuth gates
  // bounce the user back to /login. If localStorage already has a session
  // (the common path: user picked from /login), gate is off — no flash.
  const [session, setSession] = useState<SessionType | null>(() => Session.get());
  const [bootstrapping, setBootstrapping] = useState<boolean>(() => Session.get() === null);

  // SSO bootstrap: runs once on mount. If /api/auth/session returns a user
  // (proving the sso_session cookie is valid), look up the email in the
  // admin-controlled sso_users allowlist and sign in as that row. If the
  // email isn't registered, fall through to /login (RequireAuth will
  // bounce automatically once the gate clears).
  useEffect(() => {
    if (Session.get()) {
      // Already signed in via the local picker — no SSO probe needed.
      setBootstrapping(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const r = await fetch('/api/auth/session');
        const { user } = await r.json() as { user: { oid: string; name: string; email: string; source: 'sso' } | null };
        if (!active) return;
        if (user && user.source === 'sso' && user.email) {
          const { user: row } = await SsoUsers.lookup(user.email);
          if (!active) return;
          if (row && row.enabled) {
            // Hydrate the local USERS array with fields the DB row has
            // but the bundle doesn't (email, oid) so Session.set carries
            // them through.
            const hydrated: User = {
              ...USERS.find(u => u.id === row.id) ?? row,
              ...row
            };
            const s = Session.set(hydrated);
            setSession(s);
          }
        }
      } catch {
        // No cookie, network error, server down — fall through to the
        // /login picker as usual.
      } finally {
        if (active) setBootstrapping(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // Keep state in sync if other tabs modify the session
  useEffect(() => {
    const onStorage = () => setSession(Session.get());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Mint / clear the `local_admin` cookie that mirrors a LOCAL/DEMO admin
   *  session onto the API server, so /api/sso/users (admin CRUD) works
   *  without an SSO cookie. SSO-signed-in users already have sso_session,
   *  so the SSO path in requireAdmin handles them — we only need to mint
   *  this for /login picker sign-ins. */
  const lastCookieUserIdRef = useRef<number | null>(null);
  useEffect(() => {
    const mintOrClear = async () => {
      if (!session) {
        // Sign-out: best-effort clear.
        if (lastCookieUserIdRef.current !== null) {
          lastCookieUserIdRef.current = null;
          fetch('/api/sso/local-admin-logout', { method: 'POST' }).catch(() => { /* no-op */ });
        }
        return;
      }
      const localUser = USERS.find(u => u.id === session.userId);
      const wantAdminCookie =
        localUser &&
        (localUser.source === 'LOCAL' || localUser.source === 'DEMO') &&
        localUser.role === 'ADMIN' &&
        localUser.enabled !== false;
      if (!wantAdminCookie) {
        if (lastCookieUserIdRef.current !== null) {
          lastCookieUserIdRef.current = null;
          fetch('/api/sso/local-admin-logout', { method: 'POST' }).catch(() => { /* no-op */ });
        }
        return;
      }
      // Skip the round-trip if the cookie is already on this user.
      if (lastCookieUserIdRef.current === localUser.id) return;
      lastCookieUserIdRef.current = localUser.id;
      try {
        await fetch('/api/sso/local-admin-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: localUser.id,
            role: localUser.role,
            source: localUser.source,
            enabled: localUser.enabled !== false
          })
        });
      } catch { /* network down — admin gate will 401 next request */ }
    };
    mintOrClear();
  }, [session]);

  const signIn = useCallback((userId: number) => {
    const user = USERS.find(u => u.id === Number(userId));
    if (!user || !user.enabled) return null;
    const s = Session.set(user);
    setSession(s);
    return s;
  }, []);

  const signOut = useCallback(() => {
    Session.clear();
    setSession(null);
    // Best-effort: also clear the server-side sso_session cookie so a
    // subsequent reload doesn't silently re-bootstrap via the SSO path.
    // Local-only demo — failures here are invisible to the user.
    fetch('/api/sso/logout', { method: 'POST' }).catch(() => { /* ignore */ });
  }, []);

  const hasRole = useCallback((...roles: Role[]) => {
    if (!session) return false;
    return roles.includes(session.role);
  }, [session]);

  const value = useMemo<AuthCtx>(() => ({
    session,
    user: session ? USERS.find(u => u.id === session.userId) ?? null : null,
    signIn,
    signOut,
    hasRole,
    ROLE
  }), [session, signIn, signOut, hasRole]);

  // During SSO bootstrap, render a small placeholder instead of children.
  // This prevents RequireAuth from evaluating `session` as null on the
  // first render (which would bounce to /login before the fetch resolves).
  if (bootstrapping) {
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
        <div>Signing you in…</div>
      </div>
    );
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

