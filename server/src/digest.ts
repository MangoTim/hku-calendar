// digest — RFQ §2(c) "Generates and sends a daily leave report via email"
//
// Two job entry points, both exported so the scheduler AND the admin
// "send now" endpoint can call them with a chosen `now`:
//
//   runLeaveDigest(now)        — daily, per-team today's bookings + leave
//   runWeeklyLeaveReport(now)  — Monday, org-wide forward 14 days
//
// Idempotency is enforced by `digest_runs` (job_name, run_date) PK +
// INSERT ON CONFLICT DO NOTHING RETURNING. If the row was already
// claimed (e.g. by a manual-trigger earlier today), we return
// `{ ok: false, skipped: 'already-ran' }` without sending.
//
// Recipient list:
//   - SSO users with the relevant toggle = true (no flag stored server-side
//     today, so we fall back to the LEAVE_DIGEST_DEFAULT_RECIPIENT).
//   - LOCAL/DEMO users: we have no toggle state server-side either. Same
//     fallback applies. (See plan.md — Phase 2 mirror kept the FE prefs
//     LS-only to avoid a schema widening; the fallback recipient keeps
//     the demo delivering a digest to a known mailbox.)
//
// Once an opt-in mechanism ships (TODO: phase 3), replace the fallback
// below with a real query against the per-user table.

import { getPool } from './db.ts';
import { getConfigValue } from './appConfig.ts';
import { logAudit, logSystem } from './audit.ts';
import { sendLeaveDigest, sendWeeklyLeaveReport } from './email.ts';

export type DigestJob = 'DAILY_LEAVE_DIGEST' | 'WEEKLY_LEAVE_REPORT';

export interface RunDigestResult {
  ok: boolean;
  job: DigestJob;
  runDate: string;             // YYYY-MM-DD
  /** Set when the (job, run_date) PK already exists. */
  skipped?: 'already-ran';
  recipients: number;
  startedAt: string;
  finishedAt: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// runLeaveDigest
// ---------------------------------------------------------------------------
export async function runLeaveDigest(now: Date = new Date()): Promise<RunDigestResult> {
  const job: DigestJob = 'DAILY_LEAVE_DIGEST';
  const runDate = isoDate(now);
  const startedAt = new Date().toISOString();

  const claim = await claimRun(job, runDate);
  if (!claim.ok) {
    return { ok: false, job, runDate, skipped: 'already-ran', recipients: 0,
             startedAt, finishedAt: new Date().toISOString() };
  }

  try {
    const recipient = await recipientForJob(job);
    const { bookings, leave, bookingCount, leaveCount } =
      await loadTeamDigestData(now);

    if (!recipient) {
      await finishRun(job, runDate, 'EMPTY', 0, '');
      logSystem('WARN', 'digest',
        `${job} skipped — no recipient configured`,
        `Set LEAVE_DIGEST_DEFAULT_RECIPIENT in app_config to a real mailbox.`).catch(() => {});
      return { ok: true, job, runDate, recipients: 0, startedAt,
               finishedAt: new Date().toISOString() };
    }

    const team = recipient.team || '(no team)';
    const reservationsBlock = bookings.map(b =>
      `  ${b.start_time}–${b.end_time} · ${b.room_name || '(room #' + b.room_id + ')'} · ${b.booked_by_name}${b.purpose ? ` — ${b.purpose}` : ''}`
    ).join('\n');
    const leaveBlock = leave.map(l =>
      `  ${l.display_name} — ${l.type}${l.note ? ` (${l.note})` : ''}`
    ).join('\n');

    await sendLeaveDigest({
      to: recipient.email,
      displayName: recipient.display_name,
      team,
      date: runDate,
      totalBookings: bookingCount,
      totalLeave: leaveCount,
      teamReservations: reservationsBlock,
      teamLeave: leaveBlock
    });

    await finishRun(job, runDate, 'OK', 1, '');
    await logAudit({
      actorUsername: 'system:digest',
      actorUserId: null,
      actionType: 'EMAIL_DIGEST_SENT',
      resourceType: 'digest_runs',
      resourceId: runDate,
      summary: `daily leave digest sent to ${recipient.email} (team=${team}, ${bookingCount} bookings, ${leaveCount} on leave)`,
      ipAddress: 'scheduler',
      success: true
    });
    logSystem('INFO', 'digest',
      `daily leave digest sent to ${recipient.email}`,
      `team=${team} bookings=${bookingCount} leave=${leaveCount}`).catch(() => {});

    return { ok: true, job, runDate, recipients: 1, startedAt,
             finishedAt: new Date().toISOString() };
  } catch (e: any) {
    const msg = (e as Error)?.message || String(e);
    await finishRun(job, runDate, 'FAILED', 0, msg);
    await logAudit({
      actorUsername: 'system:digest',
      actorUserId: null,
      actionType: 'EMAIL_DIGEST_FAILED',
      resourceType: 'digest_runs',
      resourceId: runDate,
      summary: `daily leave digest FAILED: ${msg}`,
      ipAddress: 'scheduler',
      success: false
    });
    logSystem('ERROR', 'digest',
      `daily leave digest failed`, msg).catch(() => {});
    return { ok: false, job, runDate, recipients: 0, startedAt,
             finishedAt: new Date().toISOString(), error: msg };
  }
}

// ---------------------------------------------------------------------------
// runWeeklyLeaveReport
// ---------------------------------------------------------------------------
export async function runWeeklyLeaveReport(now: Date = new Date()): Promise<RunDigestResult> {
  const job: DigestJob = 'WEEKLY_LEAVE_REPORT';
  const runDate = isoDate(now);
  const startedAt = new Date().toISOString();

  const claim = await claimRun(job, runDate);
  if (!claim.ok) {
    return { ok: false, job, runDate, skipped: 'already-ran', recipients: 0,
             startedAt, finishedAt: new Date().toISOString() };
  }

  try {
    const recipient = await recipientForJob(job);
    const { grouped, total } = await loadWeeklyLeaveData(now);

    if (!recipient) {
      await finishRun(job, runDate, 'EMPTY', 0, '');
      logSystem('WARN', 'digest',
        `${job} skipped — no recipient configured`,
        `Set LEAVE_DIGEST_DEFAULT_RECIPIENT in app_config to a real mailbox.`).catch(() => {});
      return { ok: true, job, runDate, recipients: 0, startedAt,
               finishedAt: new Date().toISOString() };
    }

    const block = grouped.map(g => {
      const lines = g.entries.map(e =>
        `  ${e.display_name} (${e.team}) — ${e.type}${e.note ? ` (${e.note})` : ''}`
      ).join('\n');
      return `${g.date} (${g.count})\n${lines}`;
    }).join('\n');

    const fromDate = isoDate(now);
    const toDate   = isoDate(addDays(now, 13));

    await sendWeeklyLeaveReport({
      to: recipient.email,
      displayName: recipient.display_name,
      fromDate, toDate,
      totalLeave: total,
      leaveByDate: block
    });

    await finishRun(job, runDate, 'OK', 1, '');
    await logAudit({
      actorUsername: 'system:digest',
      actorUserId: null,
      actionType: 'EMAIL_WEEKLY_LEAVE_SENT',
      resourceType: 'digest_runs',
      resourceId: runDate,
      summary: `weekly leave report sent to ${recipient.email} (window=${fromDate}..${toDate}, ${total} records)`,
      ipAddress: 'scheduler',
      success: true
    });
    logSystem('INFO', 'digest',
      `weekly leave report sent to ${recipient.email}`,
      `window=${fromDate}..${toDate} records=${total}`).catch(() => {});

    return { ok: true, job, runDate, recipients: 1, startedAt,
             finishedAt: new Date().toISOString() };
  } catch (e: any) {
    const msg = (e as Error)?.message || String(e);
    await finishRun(job, runDate, 'FAILED', 0, msg);
    await logAudit({
      actorUsername: 'system:digest',
      actorUserId: null,
      actionType: 'EMAIL_WEEKLY_LEAVE_FAILED',
      resourceType: 'digest_runs',
      resourceId: runDate,
      summary: `weekly leave report FAILED: ${msg}`,
      ipAddress: 'scheduler',
      success: false
    });
    logSystem('ERROR', 'digest',
      `weekly leave report failed`, msg).catch(() => {});
    return { ok: false, job, runDate, recipients: 0, startedAt,
             finishedAt: new Date().toISOString(), error: msg };
  }
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------
//
// Today we don't store per-user opt-in flags server-side — the Profile
// preferences are LS-only. To make the demo deliver a digest without
// SSO opt-in, fall back to LEAVE_DIGEST_DEFAULT_RECIPIENT, seeded on
// first boot to tim.wong@rainbowtech.com.hk. Admins edit it on
// /admin/email.
//
// When the opt-in flags move server-side (TODO), replace this with a
// query against the user-prefs table joined to sso_users.
async function recipientForJob(_job: DigestJob): Promise<{ email: string; display_name: string; team: string } | null> {
  const fallback = (await getConfigValue('LEAVE_DIGEST_DEFAULT_RECIPIENT').catch(() => null)) || '';
  const email = fallback.trim().toLowerCase();
  if (!email) return null;
  // Best-effort: look the recipient up in sso_users by email. If the
  // row exists we get a real display name + team; otherwise we derive
  // a friendly name from the local part of the email (e.g.
  // "tim.wong" → "Tim Wong") so the greeting reads naturally.
  try {
    const { findSsoUserByEmail } = await import('./ssoUsers.ts');
    const u = await findSsoUserByEmail(email);
    if (u && u.enabled) {
      return { email, display_name: u.displayName, team: u.team || 'ENGG Intranet' };
    }
  } catch { /* fall through to local-part fallback */ }
  const local = email.split('@')[0] || '';
  const derived = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ') || 'there';
  return { email, display_name: derived, team: 'ENGG Intranet' };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------
interface BookingRow {
  start_time: string;
  end_time: string;
  room_name: string;
  room_id: number;
  booked_by_name: string;
  purpose: string;
}

interface LeaveRow {
  type: string;
  note: string;
  display_name: string;
  team: string;
}

async function loadTeamDigestData(now: Date): Promise<{
  bookings: BookingRow[]; leave: LeaveRow[];
  bookingCount: number; leaveCount: number;
}> {
  const date = isoDate(now);
  // Bookings: any booking on `date` whose status is CONFIRMED. The team
  // column is denormalised at mirror time so the digest doesn't need
  // to JOIN through users — keeps the query cheap.
  const b = await getPool().query<BookingRow>(
    `SELECT start_time, end_time, room_name, room_id, booked_by_name, purpose
       FROM booking_records
      WHERE status = 'CONFIRMED' AND date = $1
      ORDER BY start_time ASC`,
    [date]
  );
  // Leave: any APPROVED leave that overlaps `date`. leave_records.start_date
  // is inclusive; end_date is inclusive (a 1-day leave has start_date = end_date).
  const l = await getPool().query<LeaveRow>(
    `SELECT type, note, display_name, team
       FROM leave_records
      WHERE status = 'APPROVED' AND start_date <= $1 AND end_date >= $1
      ORDER BY display_name ASC`,
    [date]
  );
  return { bookings: b.rows, leave: l.rows, bookingCount: b.rowCount ?? 0, leaveCount: l.rowCount ?? 0 };
}

async function loadWeeklyLeaveData(now: Date): Promise<{
  grouped: { date: string; count: number; entries: LeaveRow[] }[];
  total: number;
}> {
  const from = isoDate(now);
  const to   = isoDate(addDays(now, 13));
  const r = await getPool().query<LeaveRow & { start_date: string }>(
    `SELECT start_date::text AS start_date, type, note, display_name, team
       FROM leave_records
      WHERE status = 'APPROVED' AND start_date >= $1 AND start_date <= $2
      ORDER BY start_date ASC, display_name ASC`,
    [from, to]
  );
  const byDate = new Map<string, LeaveRow[]>();
  for (const row of r.rows) {
    const arr = byDate.get(row.start_date) ?? [];
    arr.push(row);
    byDate.set(row.start_date, arr);
  }
  const grouped = Array.from(byDate.entries()).map(([date, entries]) => ({
    date, count: entries.length, entries
  }));
  return { grouped, total: r.rowCount ?? 0 };
}

// ---------------------------------------------------------------------------
// digest_runs idempotency
// ---------------------------------------------------------------------------
async function claimRun(job: DigestJob, runDate: string): Promise<{ ok: boolean }> {
  const r = await getPool().query(
    `INSERT INTO digest_runs (job_name, run_date, status)
     VALUES ($1, $2, 'STARTED')
     ON CONFLICT (job_name, run_date) DO NOTHING
     RETURNING job_name`,
    [job, runDate]
  );
  return { ok: (r.rowCount ?? 0) > 0 };
}

async function finishRun(
  job: DigestJob,
  runDate: string,
  status: 'OK' | 'EMPTY' | 'FAILED',
  recipientsCount: number,
  error: string
): Promise<void> {
  try {
    await getPool().query(
      `UPDATE digest_runs
          SET finished_at = NOW(),
              status = $3,
              recipients_count = $4,
              error = $5
        WHERE job_name = $1 AND run_date = $2`,
      [job, runDate, status, recipientsCount, error]
    );
  } catch (e) {
    logSystem('ERROR', 'digest',
      `failed to update digest_runs for ${job}@${runDate}`,
      (e as Error).message).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d.getTime());
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

// ---------------------------------------------------------------------------
// Last-run introspection — used by /admin/email to show "last sent at"
// ---------------------------------------------------------------------------
export async function lastRun(job: DigestJob): Promise<{
  run_date: string; status: string; finished_at: string | null;
  recipients_count: number; error: string;
} | null> {
  const r = await getPool().query(
    `SELECT run_date::text AS run_date, status, finished_at,
            recipients_count, error
       FROM digest_runs
      WHERE job_name = $1
      ORDER BY run_date DESC LIMIT 1`,
    [job]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    run_date: row.run_date,
    status: row.status,
    finished_at: row.finished_at instanceof Date ? row.finished_at.toISOString() : (row.finished_at ?? null),
    recipients_count: row.recipients_count ?? 0,
    error: row.error ?? ''
  };
}