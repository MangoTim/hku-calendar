// UsersContext — exposes a unified user directory spanning seed USERS,
// LS-created local users, and admin-managed SSO users (loaded from the
// backend on mount). Pages that previously did `USERS.find(u.id === X)`
// now do `users.findById(X)`, which never collides on id 1–21 the way
// the seed-only lookup did for SSO-only identities like Tim Wong.
import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../lib/types';
import { UserAdmin } from '../lib/userAdmin';
import { SsoUsers } from '../lib/api/ssoUsers';
import { useAuth } from './AuthContext';

interface UsersCtx {
  /** Merged list: seed USERS (with overrides) + LS-created + SSO. */
  users: User[];
  /** Convenience: search by numeric id across all sources. */
  findById: (id: number | null | undefined) => User | undefined;
  /** Case-insensitive email match across all sources. */
  findByEmail: (email: string | null | undefined) => User | undefined;
  /** True while the SSO allowlist fetch is in flight. */
  loading: boolean;
  /** Force a re-read of the SSO allowlist (e.g. after admin CRUD). */
  reload: () => Promise<void>;
}

const Ctx = createContext<UsersCtx | null>(null);

export function UsersProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [ssoUsers, setSsoUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      // `directory` (not `list`) — the directory endpoint is open to any
      // signed-in user so a non-admin SSO user (USER / TASK_MANAGER /
      // AUDITOR) still sees their colleagues in the people pickers on
      // Tasks / Leave / Bookings. `list` is admin-gated and would 403.
      const r = await SsoUsers.directory();
      setSsoUsers(r.users);
    } catch {
      // Directory fetch can fail before sign-in (no session cookie yet);
      // we silently fall back to seed+LS users. Pages that need SSO users
      // can check `loading` for pending state — `reload()` re-fetches when
      // the session is established (see the session effect below).
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch the directory whenever the session userId changes — covers
  // the bootstrap case where the very first directory() call 401'd
  // because no session cookie was present yet (cold visit to /sso-finish,
  // or first paint of /login before the user picks an account).
  const sessionUserId = session?.userId ?? null;
  useEffect(() => { if (sessionUserId != null) reload(); }, [sessionUserId, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const users = useMemo<User[]>(() => {
    const seed = UserAdmin.all();
    // Stable order: seed first, LS-created next, SSO last. SSOs have ids
    // from the SERIAL sequence so they can collide with seed ids; we keep
    // the array order dense so a later `find` that wins on later positions
    // (SSO) takes precedence — this matters for id collisions.
    return [...seed, ...ssoUsers];
  }, [ssoUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  const findById = useCallback((id: number | null | undefined): User | undefined => {
    if (id == null) return undefined;
    // SSO list placed AFTER seed in `users` so the SSO entry wins on a
    // colliding id — that's the whole point of this context (Tim Wong at
    // sso_users.id=1 should resolve to the SSO row, not Prof. Alan Wong
    // at USERS[0].id=1).
    return users.find(u => u.id === id);
  }, [users]);

  const findByEmail = useCallback((email: string | null | undefined): User | undefined => {
    if (!email) return undefined;
    const lower = email.toLowerCase();
    return users.find(u => (u.email ?? '').toLowerCase() === lower);
  }, [users]);

  const value = useMemo<UsersCtx>(() => ({ users, findById, findByEmail, loading, reload }), [users, findById, findByEmail, loading, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUsers(): UsersCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUsers must be used inside <UsersProvider>');
  return v;
}
