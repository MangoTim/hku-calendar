// Announcement detail — read-only view. Shows title/body/file/poster.
import { useState, useEffect } from 'react';
import { Link, useSearchParams, useParams } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { Announcements } from '../lib/announcements';
import { USERS } from '../lib/data';
import { fmt, escapeHtml } from '../lib/app';

export function AnnouncementDetail() {
  const { ROLE } = useAuth();
  const [params] = useSearchParams();
  const justCreated = params.get('justCreated') === '1';
  const pathParams = useParams<{ id: string }>();
  const [, setRev] = useState(0);

  // Bounce a re-render after mount so justCreated alert flashes once.
  useEffect(() => {
    if (justCreated) setRev(v => v + 1);
  }, [justCreated]);

  const id = pathParams.id ? Number(pathParams.id) : null;
  const a = id != null ? Announcements.byId(id) : undefined;

  if (!a) {
    return (
      <AppShell title="Announcement">
        <div className="page-header">
          <h1>Announcement not found</h1>
          <Link className="btn" to="/announcements">← Back</Link>
        </div>
      </AppShell>
    );
  }

  const poster = USERS.find(u => u.id === a.postedById);
  const canDelete = ROLE.canAssignTasks();

  const onDelete = () => {
    if (!confirm('Delete this announcement?')) return;
    Announcements.remove(a.id);
    window.location.href = '/announcements';
  };

  return (
    <AppShell title="Announcement">
      <div className="page-header">
        <div>
          <h1>{escapeHtml(a.title)}</h1>
          <div className="page-header__sub">
            #{a.id} · posted {fmt.dateTime(a.createdAt)} by {escapeHtml(poster?.displayName || '—')} ({escapeHtml(poster?.team || '')})
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/announcements">← Back</Link>
          {canDelete && (
            <button className="btn btn--danger" onClick={onDelete}>Delete</button>
          )}
        </div>
      </div>

      {justCreated && (
        <div className="alert alert--success" role="status">
          ✅ Announcement posted — visible to all staff.
        </div>
      )}

      <section className="card">
        <div style={{ whiteSpace: 'pre-wrap' }}>{escapeHtml(a.body)}</div>
        {a.fileUrl && (
          <div className="text-sm" style={{ marginTop: 'var(--space-4)' }}>
            📎 <a href={a.fileUrl} target="_blank" rel="noopener noreferrer">
              {escapeHtml(a.fileLabel || a.fileUrl)}
            </a>
          </div>
        )}
      </section>
    </AppShell>
  );
}