// Admin rooms — list + edit + new + delete.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Rooms } from '../lib/rooms';
import { escapeHtml } from '../lib/app';

export function AdminRooms() {
  const [, setRev] = useState(0);
  const list = Rooms.all();

  const onDelete = (id: number) => {
    if (!confirm('Delete this room?')) return;
    Rooms.remove(id);
    setRev(v => v + 1);
  };

  const onToggleActive = (id: number, currentActive: boolean) => {
    Rooms.update(id, { active: !currentActive });
    setRev(v => v + 1);
  };

  return (
    <AppShell title="Rooms">
      <div className="page-header">
        <div>
          <h1>Rooms</h1>
          <div className="page-header__sub">{list.length} total · {Rooms.active().length} active</div>
        </div>
        <div className="page-header__actions">
          <Link className="btn btn--primary" to="/admin/rooms/new">+ Add room</Link>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card empty">No rooms yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table table--hover" aria-label="Rooms">
              <thead>
                <tr>
                  <th>Name</th><th>Building</th><th>Max seats</th>
                  <th>Status</th><th>Notes</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id}>
                    <td><strong>{escapeHtml(r.name)}</strong></td>
                    <td>{escapeHtml(r.building)}</td>
                    <td>{r.maxSeats}</td>
                    <td>
                      {r.active
                        ? <span className="badge badge--success">Active</span>
                        : <span className="badge badge--muted">Inactive</span>}
                    </td>
                    <td className="text-muted">{escapeHtml(r.notes || '—')}</td>
                    <td className="actions">
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => onToggleActive(r.id, r.active)}
                      >
                        {r.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <Link className="btn btn--ghost btn--sm" to={`/admin/rooms/${r.id}/edit`}>Edit</Link>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => onDelete(r.id)}
                        style={{ color: 'var(--color-danger)' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}