// Announcement new — TASK_MANAGER/ADMIN only.
// No edit page; announcements are immutable once posted (matches static behaviour).
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { Announcements } from '../lib/announcements';
import { escapeHtml } from '../lib/app';

export function AnnouncementNew() {
  const { user, ROLE } = useAuth();
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [fileLabel, setFileLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!ROLE.canAssignTasks()) {
    return (
      <AppShell title="New announcement">
        <div className="alert alert--danger" role="alert">
          ⚠️ Only Task Manager / Administrator can post announcements.
        </div>
        <Link className="btn" to="/announcements">← Back</Link>
      </AppShell>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const input = {
      title,
      body,
      fileUrl: fileUrl.trim(),
      fileLabel: fileLabel.trim(),
      postedById: user!.id
    };
    const v = Announcements.validate(input);
    if (!v.ok) { setError(v.error); return; }
    const a = Announcements.create(input);
    nav(`/announcements/${a.id}?justCreated=1`, { replace: true });
  };

  return (
    <AppShell title="New announcement">
      <div className="page-header">
        <div>
          <h1>New announcement</h1>
          <div className="page-header__sub">
            Posts immediately · announcements are visible to all staff on the dashboard and <Link to="/announcements">/announcements</Link>
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to="/announcements">← Back</Link>
        </div>
      </div>

      {error && (
        <div className="alert alert--danger" role="alert">⚠️ {escapeHtml(error)}</div>
      )}

      <form className="form card" onSubmit={onSubmit} noValidate>
        <div className="form__row">
          <label className="form__label" htmlFor="title">Title</label>
          <input
            id="title"
            type="text"
            className="form__input"
            required
            maxLength={200}
            placeholder="IT maintenance window — 2026-10-12"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="body">Body</label>
          <textarea
            id="body"
            className="form__textarea"
            required
            maxLength={4000}
            rows={8}
            placeholder="What's the announcement? Be specific about dates, impact, and any action required."
            value={body}
            onChange={e => setBody(e.target.value)}
          />
        </div>

        <div className="form__row form__row--2">
          <div className="form__row">
            <label className="form__label" htmlFor="fileUrl">Attachment URL (optional)</label>
            <input
              id="fileUrl"
              type="url"
              className="form__input"
              maxLength={500}
              placeholder="https://intranet.engg.hku.hk/files/maintenance.pdf"
              value={fileUrl}
              onChange={e => setFileUrl(e.target.value)}
            />
          </div>
          <div className="form__row">
            <label className="form__label" htmlFor="fileLabel">Attachment label</label>
            <input
              id="fileLabel"
              type="text"
              className="form__input"
              maxLength={200}
              placeholder="Maintenance plan (PDF)"
              value={fileLabel}
              onChange={e => setFileLabel(e.target.value)}
            />
          </div>
        </div>

        <div className="form__actions">
          <Link className="btn" to="/announcements">Cancel</Link>
          <button type="submit" className="btn btn--primary">Post announcement</button>
        </div>
      </form>
    </AppShell>
  );
}