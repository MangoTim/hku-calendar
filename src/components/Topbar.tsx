// Topbar — user info + sign out. Mirrors app.js renderTopbar.
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fmt } from '../lib/app';

export function Topbar({ title }: { title: string }) {
  const { session, signOut } = useAuth();
  const nav = useNavigate();

  if (!session) return null;

  const onSignOut = () => {
    signOut();
    nav('/login', { replace: true });
  };

  return (
    <header className="app__topbar">
      <div className="topbar__title">{title}</div>
      <div className="topbar__user">
        <div className="meta">
          <span>{session.displayName}</span>
          <span className="role-tag">{session.team} · {fmt.role(session.role)}</span>
        </div>
        <span className="avatar" title={session.username}>{fmt.initials(session.displayName)}</span>
        <button className="btn btn--ghost btn--sm" onClick={onSignOut} title="Sign out">
          Sign out
        </button>
      </div>
    </header>
  );
}
