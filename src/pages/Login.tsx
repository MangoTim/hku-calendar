// Login page — dark split-panel style (RHAI chatbot style).
// Markup mirrors static login.html so style.css applies unchanged.
import { useState, useMemo } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { USERS } from '../lib/data';
import { fmt } from '../lib/app';

// Stable color hash for the avatar circle on each user row.
const AVATAR_PALETTE = [
  '#10b981', '#3b82f6', '#8b5cf6', '#ec4899',
  '#f59e0b', '#06b6d4', '#84cc16', '#ef4444'
];
function avatarColor(name: string | undefined | null): string {
  let h = 0;
  for (const c of String(name || '')) h = ((h * 31) + c.charCodeAt(0)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

export function Login() {
  const { session, signIn } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [pickedId, setPickedId] = useState<number | null>(null);

  // Already logged in → bounce to dashboard
  if (session) return <Navigate to="/dashboard" replace />;

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const sorted = [...USERS].sort((a, b) => a.id - b.id);
    if (!term) return sorted;
    return sorted.filter(u =>
      u.username.toLowerCase().includes(term) ||
      u.displayName.toLowerCase().includes(term) ||
      u.team.toLowerCase().includes(term) ||
      u.title.toLowerCase().includes(term)
    );
  }, [q]);

  const picked = pickedId ? USERS.find(u => u.id === pickedId) ?? null : null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickedId) return;
    const s = signIn(pickedId);
    if (s) nav('/dashboard', { replace: true });
  };

  // Enter in the search box → pick first row if none picked yet
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (pickedId) {
        onSubmit(e as unknown as React.FormEvent);
      } else if (list.length > 0) {
        setPickedId(list[0].id);
      }
    }
  };

  return (
    <div className="login-overlay">
      <div className="login-split">

        {/* ── Left: brand + tagline ─────────────────────────────── */}
        <aside className="login-left">
          <div className="login-left-bg"></div>
          <div className="login-left-grid"></div>

          <div className="login-left-content">
            <div>
              <div className="login-brand">
                <span className="dot"></span> HKU <span className="tld">/ ENGG Intranet</span>
              </div>
            </div>

            <div>
              <h1 className="login-tagline">
                Your faculty workspace,<br/><em>ready when you are.</em>
              </h1>
              <p className="login-subtitle">
                Conference room booking, informal leave, task assignments,
                announcements and notifications — all in one place for the
                HKU Faculty of Engineering Office.
              </p>
            </div>

            <div>
              <div className="login-stats">
                <div className="login-stat">
                  <div className="num">~100</div>
                  <div className="lbl">Staff supported</div>
                </div>
                <div className="login-stat">
                  <div className="num">14</div>
                  <div className="lbl">Modules</div>
                </div>
                <div className="login-stat">
                  <div className="num">4</div>
                  <div className="lbl">User roles</div>
                </div>
              </div>
              <div className="login-left-foot" style={{ marginTop: 24 }}>
                HKU Faculty of Engineering · v0928 demo · Single-user
              </div>
            </div>
          </div>
        </aside>

        {/* ── Right: sign-in card ──────────────────────────────── */}
        <main className="login-right">
          <section className="login-card" aria-labelledby="loginTitle">
            <h2 id="loginTitle">Sign in</h2>
            <p className="login-sub">Welcome back — sign in with HKU Single Sign-On to continue.</p>

            <input
              id="userSearch"
              className="login-search"
              type="text"
              placeholder="Search by name, username or team…"
              autoComplete="off"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              autoFocus
            />

            <div
              className="login-user-list"
              role="listbox"
              aria-label="Demo users"
            >
              {list.length === 0 ? (
                <div
                  className="empty"
                  style={{ color: '#6b7280', background: 'transparent', borderColor: '#243447' }}
                >
                  No users match "{q}"
                </div>
              ) : list.map(u => {
                const ini = fmt.initials(u.displayName);
                const color = avatarColor(u.username);
                const isSel = pickedId === u.id;
                return (
                  <div
                    key={u.id}
                    role="option"
                    aria-selected={isSel}
                    className="login-user-row"
                    onClick={() => setPickedId(u.id)}
                    style={isSel ? { borderColor: '#00a884', background: 'rgba(0,168,132,0.10)' } : undefined}
                  >
                    <span className="avatar" style={{ background: color }}>{ini}</span>
                    <div className="meta">
                      <div className="name">
                        {u.displayName}{' '}
                        <span style={{ color: '#6b7280', fontWeight: 400 }}>({u.username})</span>
                      </div>
                      <div className="sub">{u.title} · {u.team}</div>
                    </div>
                    <span className={`role-pill ${u.role}`}>{fmt.role(u.role)}</span>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="login-submit"
              disabled={!pickedId}
              onClick={onSubmit}
            >
              {picked ? `Sign in as ${picked.displayName.split(' ').slice(-1)[0]}` : 'Sign in with HKU SSO'}
            </button>

            <p className="login-tip">
              Tip: try <strong>it_lead</strong> · <strong>oa_lead</strong> · <strong>oa1</strong> · <strong>auditor1</strong>
            </p>
          </section>
        </main>

      </div>
    </div>
  );
}