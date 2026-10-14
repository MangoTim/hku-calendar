// Leave mirror client — best-effort POST/DELETE to /api/leave so the
// leave-digest scheduler (server/src/scheduler.ts) sees fresh leave
// records even when no browser is open. LS remains the source of truth
// on the client; this is a one-way mirror for the server-side email
// pipeline.
//
// All methods swallow errors so a network blip never blocks a save.
import { jsonFetch } from './fetch';
import { Session } from '../app';
import { USERS } from '../data';

interface LeaveMirrorInput {
  user_source: 'LOCAL' | 'DEMO' | 'SSO';
  user_id: number;
  type: string;
  start_date: string;
  end_date: string;
  note: string;
  status: 'APPROVED' | 'CANCELLED';
  team: string;
  display_name: string;
}

export const LeaveMirror = {
  /** Upsert a leave row keyed by (user_source, user_id, start_date, type).
   *  Server uses those four as the natural key so re-saves / edits collapse
   *  onto the same row without an explicit id. */
  async upsert(input: {
    userId: number;
    type: string;
    startDate: string;
    endDate: string;
    note: string;
    status: 'APPROVED' | 'CANCELLED';
  }): Promise<void> {
    try {
      const session = Session.get();
      const user = USERS.find(u => u.id === Number(input.userId));
      const payload: LeaveMirrorInput = {
        user_source: session?.source || (user?.source ?? 'LOCAL'),
        user_id: Number(input.userId),
        type: input.type,
        start_date: input.startDate,
        end_date: input.endDate,
        note: input.note || '',
        status: input.status,
        team: user?.team || session?.team || '',
        display_name: user?.displayName || session?.displayName || ''
      };
      await jsonFetch('/api/leave', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    } catch {
      // Best-effort: swallow so a network failure never blocks a save.
    }
  },

  /** Soft-delete via DELETE /api/leave — server flips status to CANCELLED. */
  async cancel(input: {
    userId: number;
    type: string;
    startDate: string;
  }): Promise<void> {
    try {
      const session = Session.get();
      const user = USERS.find(u => u.id === Number(input.userId));
      await jsonFetch('/api/leave', {
        method: 'DELETE',
        body: JSON.stringify({
          user_source: session?.source || (user?.source ?? 'LOCAL'),
          user_id: Number(input.userId),
          start_date: input.startDate,
          type: input.type
        })
      });
    } catch {
      // Best-effort.
    }
  }
};
