// Bookings mirror client — best-effort POST/DELETE to /api/bookings so the
// leave-digest scheduler (server/src/scheduler.ts) sees fresh room
// bookings even when no browser is open. LS remains the source of truth on
// the client; this is a one-way mirror for the server-side email pipeline.
//
// All methods swallow errors so a network blip never blocks a save. The
// scheduler tolerates drift (digest_runs logs WARN when the mirror falls
// behind, but the email still goes out with whatever's in DB).
import { jsonFetch } from './fetch';
import { Session } from '../app';
import { USERS, ROOMS } from '../data';
import type { Booking } from '../types';

export const BookingMirror = {
  /** Upsert a booking row by ref. Server uses `ref` as the primary key so
   *  FE edits/cancels naturally land on the same row. */
  async upsert(b: Booking): Promise<void> {
    try {
      const session = Session.get();
      const booker = USERS.find(u => u.id === Number(b.bookedById));
      const room = ROOMS.find(r => r.id === Number(b.roomId));
      await jsonFetch('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          ref: b.ref,
          room_id: b.roomId,
          room_name: room?.name || '',
          booked_by_id: b.bookedById,
          booked_by_source: session?.source || (booker?.source ?? 'LOCAL'),
          booked_by_name: booker?.displayName || session?.displayName || '',
          booked_by_email: booker?.email || session?.email || '',
          booked_by_team: booker?.team || session?.team || '',
          date: b.date,
          start_time: b.startTime,
          end_time: b.endTime,
          purpose: b.purpose,
          status: b.status,
          support_requests: b.supportRequests || '',
          it_support: !!b.itSupport,
          team: booker?.team || session?.team || ''
        })
      });
    } catch {
      // Best-effort: swallow so a network failure never blocks a save.
    }
  },

  /** Soft-delete via DELETE /api/bookings/:ref — server flips status to
   *  CANCELLED and advances updated_at. */
  async cancel(ref: string): Promise<void> {
    try {
      await jsonFetch(`/api/bookings/${encodeURIComponent(ref)}`, { method: 'DELETE' });
    } catch {
      // Best-effort.
    }
  }
};
