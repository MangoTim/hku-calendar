// SMTP email helper. Used by /api/email/* routes to send transactional
// emails out via the local Postfix relay on the .105 VM (127.0.0.1:25,
// no auth). Postfix is configured on the VM to relay to the real SMTP
// host for outbound; this module just hands a message to localhost and
// lets Postfix do the rest.
//
// Lazy-init the transporter on first use so module import never blocks
// boot if SMTP_HOST is wrong. Connection failures are returned to the
// caller (which logs to system_logs + audit) — the calling request
// never fails because of email.

import nodemailer, { type Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Optional Reply-To header — used for the IT-support email so IT can
   *  reply directly to the booker instead of the From address. */
  replyTo?: string;
}

export interface ItSupportBooking {
  ref: string;
  date: string;
  startTime: string;
  endTime: string;
  room: string;
  purpose: string;
  supportRequests: string;
  booker: {
    name: string;
    email: string;
    team: string;
  };
}

let _transporter: Transporter | null = null;
function transporter(): Transporter {
  if (_transporter) return _transporter;
  const host = process.env.SMTP_HOST || '127.0.0.1';
  const port = Number(process.env.SMTP_PORT || 25);
  const secure = port === 465;          // SMTPS only for port 465
  const auth = process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' }
    : undefined;
  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    // Local Postfix on 127.0.0.1:25 needs no auth and no TLS handshake.
    ignoreTLS: port === 25,
    auth
  });
  return _transporter;
}

export function smtpConfig() {
  return {
    host: process.env.SMTP_HOST || '127.0.0.1',
    port: Number(process.env.SMTP_PORT || 25),
    from: process.env.SMTP_FROM || 'ENGG Intranet <noreply@intranet.engg.hku.hk>',
    itTeamEmail: process.env.IT_TEAM_EMAIL || 'tim.wong@systex.com.hk'
  };
}

/** Best-effort send. Returns the nodemailer info on success, throws on
 *  failure. Caller is expected to log + audit, NOT to fail the request. */
export async function sendMail(msg: EmailMessage): Promise<{ messageId: string }> {
  const t = transporter();
  const cfg = smtpConfig();
  const info = await t.sendMail({
    from: cfg.from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    replyTo: msg.replyTo
  });
  return { messageId: String(info.messageId || '') };
}

/** Format and send the IT-support notification for a booking. The body
 *  includes all the detail an IT responder needs to start working the
 *  request: who, when, where, what they need, and how to reply. */
export async function sendItSupportEmail(b: ItSupportBooking): Promise<{ messageId: string }> {
  const cfg = smtpConfig();
  const subject = `[IT support] ${b.ref} — ${b.date} ${b.startTime}–${b.endTime} · ${b.room}`;
  const text = [
    `A room booking has been flagged for IT support.`,
    ``,
    `Booking reference : ${b.ref}`,
    `Date              : ${b.date}`,
    `Time              : ${b.startTime} – ${b.endTime}`,
    `Room              : ${b.room}`,
    `Purpose           : ${b.purpose || '(none)'}`,
    ``,
    `Booker`,
    `  Name            : ${b.booker.name}`,
    `  Email           : ${b.booker.email}`,
    `  Team            : ${b.booker.team}`,
    ``,
    `Support request`,
    `  ${(b.supportRequests || '').split('\n').join('\n  ') || '(none — booker ticked IT support without a note)'}`,
    ``,
    `Reply to this email to contact the booker directly.`
  ].join('\n');
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;line-height:1.5">
<h2 style="margin:0 0 16px">IT support requested for a room booking</h2>
<table style="border-collapse:collapse;margin:0 0 16px">
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Reference</td><td><strong>${esc(b.ref)}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Date</td><td>${esc(b.date)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Time</td><td>${esc(b.startTime)} – ${esc(b.endTime)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Room</td><td>${esc(b.room)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Purpose</td><td>${esc(b.purpose || '(none)')}</td></tr>
</table>
<h3 style="margin:16px 0 4px">Booker</h3>
<table style="border-collapse:collapse;margin:0 0 16px">
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Name</td><td>${esc(b.booker.name)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Email</td><td><a href="mailto:${esc(b.booker.email)}">${esc(b.booker.email)}</a></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Team</td><td>${esc(b.booker.team)}</td></tr>
</table>
<h3 style="margin:16px 0 4px">Support request</h3>
<pre style="background:#f1f5f9;padding:12px;border-radius:6px;white-space:pre-wrap;font-family:inherit">${esc(b.supportRequests || '(none — booker ticked IT support without a note)')}</pre>
<p style="color:#64748b;font-size:12px;margin-top:24px">Reply to this email to contact the booker directly.</p>
</body></html>`;
  return sendMail({
    to: cfg.itTeamEmail,
    subject,
    text,
    html,
    replyTo: b.booker.email || undefined
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
}
