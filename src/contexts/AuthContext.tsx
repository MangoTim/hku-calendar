// AuthContext — wraps the static Session helpers in a React context
// so any component can read the current user, sign in, or sign out.
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Session, ROLE } from '../lib/app';
import type { Session as SessionType, User, Role } from '../lib/types';
import { USERS } from '../lib/data';

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
  const [session, setSession] = useState<SessionType | null>(() => Session.get());

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

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
