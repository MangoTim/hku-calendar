// SMTP email helper. Used by /api/email/* routes to send transactional
// emails out via the local Postfix relay on the .105 VM (127.0.0.1:25,
// no auth). Postfix is configured on the VM to relay to the real SMTP
// host for outbound; this module just hands a message to localhost and
// lets Postfix do the rest.
//
// Templates live in the `email_templates` table (seeded on first boot).
// Subject + body are interpolated with {{variable}} tokens at send time
// — see server/src/emailTemplates.ts for the supported variable list.
// If a template row is missing the renderer falls back to a built-in
// default so a missing DB row never breaks a booking save.
//
// Lazy-init the transporter on first use so module import never blocks
// boot if SMTP_HOST is wrong. Connection failures are returned to the
// caller (which logs to system_logs + audit) — the calling request
// never fails because of email.

import nodemailer, { type Transporter } from 'nodemailer';
import { getEmailTemplate, renderTemplate, type EmailTemplate } from './emailTemplates.ts';
import { getConfigValue } from './appConfig.ts';

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

export async function smtpConfig() {
  // IT team email: admins can override the env-baked address at runtime via
  // /admin/support. Falls back to IT_TEAM_EMAIL env var (or the build's
  // hardcoded default) when the DB row is empty so a fresh deploy with no
  // prior admin edit still works.
  const dbItTeam = await getConfigValue('IT_TEAM_EMAIL').catch(() => null);
  const itTeamEmail =
    (dbItTeam && dbItTeam.trim()) ||
    process.env.IT_TEAM_EMAIL ||
    'tim.wong@systex.com.hk';
  return {
    host: process.env.SMTP_HOST || '127.0.0.1',
    port: Number(process.env.SMTP_PORT || 25),
    from: process.env.SMTP_FROM || 'ENGG Intranet <noreply@intranet.engg.hku.hk>',
    itTeamEmail
  };
}

/** Best-effort send. Returns the nodemailer info on success, throws on
 *  failure. Caller is expected to log + audit, NOT to fail the request. */
export async function sendMail(msg: EmailMessage): Promise<{ messageId: string }> {
  const t = transporter();
  const cfg = await smtpConfig();
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
 *  uses the editable `IT_SUPPORT` template from email_templates; falls
 *  back to a built-in default if the row is missing or empty. */
export async function sendItSupportEmail(b: ItSupportBooking): Promise<{ messageId: string }> {
  const cfg = await smtpConfig();
  const tmpl = await loadTemplate('IT_SUPPORT', b);
  const subject = renderTemplate(tmpl.subject, {
    ref: b.ref, date: b.date, startTime: b.startTime, endTime: b.endTime, room: b.room
  });
  const text = renderTemplate(tmpl.bodyText, {
    ref: b.ref, date: b.date, startTime: b.startTime, endTime: b.endTime, room: b.room,
    purpose: b.purpose || '(none)',
    supportRequests: b.supportRequests || '(none — booker ticked IT support without a note)',
    bookerName: b.booker.name, bookerEmail: b.booker.email, bookerTeam: b.booker.team
  });
  const html = tmpl.bodyHtml
    ? renderTemplate(tmpl.bodyHtml, {
        ref: b.ref, date: b.date, startTime: b.startTime, endTime: b.endTime, room: b.room,
        purpose: b.purpose || '(none)',
        supportRequests: b.supportRequests || '(none — booker ticked IT support without a note)',
        bookerName: b.booker.name, bookerEmail: b.booker.email, bookerTeam: b.booker.team
      })
    : textToHtml(text);
  return sendMail({
    to: cfg.itTeamEmail,
    subject,
    text,
    html,
    replyTo: b.booker.email || undefined
  });
}

/** Render the IT_SUPPORT template with a given booking. Used by the
 *  admin preview endpoint. Returns {subject, text, html} so the admin
 *  UI can show all three side-by-side. */
export async function renderItSupportTemplate(b: ItSupportBooking): Promise<{ subject: string; text: string; html: string }> {
  const tmpl = await loadTemplate('IT_SUPPORT', b);
  const subject = renderTemplate(tmpl.subject, {
    ref: b.ref, date: b.date, startTime: b.startTime, endTime: b.endTime, room: b.room
  });
  const text = renderTemplate(tmpl.bodyText, {
    ref: b.ref, date: b.date, startTime: b.startTime, endTime: b.endTime, room: b.room,
    purpose: b.purpose || '(none)',
    supportRequests: b.supportRequests || '(none — booker ticked IT support without a note)',
    bookerName: b.booker.name, bookerEmail: b.booker.email, bookerTeam: b.booker.team
  });
  const html = tmpl.bodyHtml
    ? renderTemplate(tmpl.bodyHtml, {
        ref: b.ref, date: b.date, startTime: b.startTime, endTime: b.endTime, room: b.room,
        purpose: b.purpose || '(none)',
        supportRequests: b.supportRequests || '(none — booker ticked IT support without a note)',
        bookerName: b.booker.name, bookerEmail: b.booker.email, bookerTeam: b.booker.team
      })
    : textToHtml(text);
  return { subject, text, html };
}

// ---------- internal helpers ----------

/** Load the named template from the DB. If the row is missing or the
 *  body is empty, return the built-in default so the caller always
 *  has something renderable. The default matches the original hardcoded
 *  IT-support email so deployments that pre-date the template table
 *  still send the right thing. */
async function loadTemplate(code: string, _b: ItSupportBooking): Promise<EmailTemplate> {
  try {
    const t = await getEmailTemplate(code);
    if (t && t.bodyText && t.subject) return t;
  } catch { /* fall through to default */ }
  return {
    code,
    subject: '[IT support] {{ref}} — {{date}} {{startTime}}–{{endTime}} · {{room}}',
    bodyText: [
      'A room booking has been flagged for IT support.',
      '',
      'Booking reference : {{ref}}',
      'Date              : {{date}}',
      'Time              : {{startTime}} – {{endTime}}',
      'Room              : {{room}}',
      'Purpose           : {{purpose}}',
      '',
      'Booker',
      '  Name            : {{bookerName}}',
      '  Email           : {{bookerEmail}}',
      '  Team            : {{bookerTeam}}',
      '',
      'Support request',
      '  {{supportRequests}}',
      '',
      'Reply to this email to contact the booker directly.'
    ].join('\n'),
    bodyHtml: null,
    description: 'Built-in default (DB template missing)',
    updatedAt: new Date(0).toISOString()
  };
}

/** Minimal text-to-HTML conversion: escape HTML, preserve paragraphs.
 *  Used when an admin has only edited body_text and left body_html
 *  blank. The output is plain but readable; admins who want fancier
 *  formatting can fill in body_html explicitly. */
function textToHtml(text: string): string {
  const paragraphs = text.split(/\n{2,}/).map(p =>
    `<p style="margin:0 0 12px;line-height:1.5">${escapeHtmlInline(p).replace(/\n/g, '<br>')}</p>`
  );
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">${paragraphs.join('')}</body></html>`;
}

function escapeHtmlInline(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
}
