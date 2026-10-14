// scheduler — RFQ §2(c) leave digest schedules.
//
// Two jobs, each fired by a self-rescheduling setTimeout (not setInterval
// — that would drift). Each tick re-reads the hour from app_config so
// an admin's edit on /admin/email takes effect on the NEXT tick.
//
// Idempotency is enforced by digest_runs inside runLeaveDigest /
// runWeeklyLeaveReport — re-entry on the same (job, date) is a no-op,
// so server restarts don't double-send.
//
// Shutdown: both timers are cleared on SIGTERM / SIGINT. No resources
// other than the two timers are held.

import { getConfigValue } from './appConfig.ts';
import { runLeaveDigest, runWeeklyLeaveReport } from './digest.ts';

// Bun's `setTimeout` returns a `Timer`, not the NodeJS-flavored Timeout
// that `NodeJS.Timeout` would suggest. Use the runtime-neutral
// `ReturnType<typeof setTimeout>` so the same code type-checks under
// both runtimes and under CI's `bun run`/Node fallback.
const timers: ReturnType<typeof setTimeout>[] = [];

export function startScheduler(): void {
  // Daily tick (configurable hour; default 08:00).
  scheduleDaily();
  // Weekly Monday tick (configurable hour; default 08:00 on Monday).
  scheduleWeekly();

  process.on('SIGTERM', stopScheduler);
  process.on('SIGINT', stopScheduler);
  console.log('[scheduler] started — daily leave digest + weekly Monday leave report');
}

function stopScheduler(): void {
  for (const t of timers.splice(0)) clearTimeout(t);
  console.log('[scheduler] stopped');
}

function scheduleDaily(): void {
  void (async () => {
    try {
      const hour = await readHour('LEAVE_DIGEST_HOUR');
      const ms = msUntilNextHour(hour);
      console.log(`[scheduler] next daily leave digest at ${formatAt(Date.now() + ms)} (LEAVE_DIGEST_HOUR=${hour})`);
      timers.push(setTimeout(async () => {
        try {
          await runLeaveDigest();
        } catch (e: any) {
          console.error('[scheduler] daily digest crashed:', e);
        } finally {
          scheduleDaily();
        }
      }, ms));
    } catch (e: any) {
      console.error('[scheduler] scheduleDaily failed:', e);
    }
  })();
}

function scheduleWeekly(): void {
  void (async () => {
    try {
      const hour = await readHour('WEEKLY_LEAVE_REPORT_HOUR');
      const ms = msUntilNextMonday(hour);
      console.log(`[scheduler] next weekly leave report at ${formatAt(Date.now() + ms)} (WEEKLY_LEAVE_REPORT_HOUR=${hour})`);
      timers.push(setTimeout(async () => {
        try {
          await runWeeklyLeaveReport();
        } catch (e: any) {
          console.error('[scheduler] weekly digest crashed:', e);
        } finally {
          scheduleWeekly();
        }
      }, ms));
    } catch (e: any) {
      console.error('[scheduler] scheduleWeekly failed:', e);
    }
  })();
}

async function readHour(key: string): Promise<number> {
  const v = await getConfigValue(key).catch(() => null);
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 23) return 8;
  return Math.floor(n);
}

function msUntilNextHour(hour: number): number {
  const now = new Date();
  const next = new Date(now.getTime());
  next.setUTCHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

function msUntilNextMonday(hour: number): number {
  const now = new Date();
  const next = new Date(now.getTime());
  // 0 = Sun, 1 = Mon … 6 = Sat — we want Monday in UTC. If today is
  // Monday and the configured hour is still in the future, fire today;
  // else jump to next Monday.
  next.setUTCHours(hour, 0, 0, 0);
  const dayOfWeek = next.getUTCDay();
  const daysUntilMonday = (1 - dayOfWeek + 7) % 7;
  next.setUTCDate(next.getUTCDate() + daysUntilMonday);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 7);
  return next.getTime() - now.getTime();
}

function formatAt(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}