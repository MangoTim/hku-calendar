// AuthContext — wraps the static Session helpers in a React context
// so any component can read the current user, sign in, or sign out.
import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Session, ROLE } from '../lib/app';
import type { Session as SessionType, User, Role } from '../lib/types';
import { UserAdmin, getProfileOverride } from '../lib/userAdmin';
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
            // them through. `row` itself carries all the fields we need,
            // so the seed-array fallback is best-effort.
            const hydrated: User = {
              ...(UserAdmin.byId(row.id) ?? row),
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
      const localUser = UserAdmin.byId(session.userId);
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
    // UserAdmin.all() covers both the seed array and any LS-created local
    // users (1000+ ids), so admin-created demo users are also pickable from
    // the /login picker without colliding with SSO ids 1–21.
    const user = UserAdmin.byId(Number(userId));
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

  const value = useMemo<AuthCtx>(() => {
    // Profile overrides — RFQ §2(d): users manage their own profile
    // settings (displayName/title/team) via /profile. We store these in
    // LS keyed by user.id and apply them on top of the session-derived
    // User view so every page reflects the latest edit without a reload.
    const profileOverride = session ? getProfileOverride(session.userId) : undefined;
    return {
    session,
    // Derive the User view from the session fields directly instead of
    // re-looking-up `session.userId` in USERS. SSO `sso_users` rows use
    // the same SERIAL sequence as the seed USERS array (both start at 1),
    // so a colliding id would otherwise pull a *seed* user — e.g. an SSO
    // Tim Wong (sso_users.id=1) would render as Prof. Alan Wong
    // (USERS[0].id=1) in any page reading user.displayName / user.team.
    // Session already carries displayName/team/title/role/source/email, so
    // we just rebuild a User view from those. Digest flags aren't carried
    // in the session; Profile reads them via LS overrides keyed by id.
    user: session ? {
      id: session.userId,
      username: session.username,
      displayName: profileOverride?.displayName ?? session.displayName,
      role: session.role,
      team: profileOverride?.team ?? session.team,
      title: profileOverride?.title ?? session.title,
      source: session.source,
      email: session.email,
      enabled: true,
      morningTeamDigestEnabled: true,
      mondayTwoWeekLeaveReportEnabled: false
    } : null,
    signIn,
    signOut,
    hasRole,
    ROLE
    };
  }, [session, signIn, signOut, hasRole]);

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

