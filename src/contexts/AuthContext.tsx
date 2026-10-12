// AuthContext — wraps the static Session helpers in a React context
// so any component can read the current user, sign in, or sign out.
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
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

