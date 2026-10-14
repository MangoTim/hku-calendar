// email_templates — admin-editable email templates.
//
// Each row stores the subject line, plain-text body, optional HTML body,
// and a human-readable description. The plain-text body is the source
// of truth; HTML is auto-generated from it if body_html is NULL.
//
// The template engine is intentionally minimal: a single regex pass
// replaces {{variable}} tokens. No conditionals, no loops, no helper
// functions — the use case is "compose a fixed-format email with a
// handful of fields". If a template later needs branching, swap this
// module for handlebars (or similar) without touching call sites.

import { getPool } from './db.ts';

export interface EmailTemplate {
  code: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  description: string;
  updatedAt: string;
}

export interface EmailTemplateInput {
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  description?: string;
}

const SELECT_COLS = `code, subject, body_text, body_html, description, updated_at`;

export async function listEmailTemplates(): Promise<EmailTemplate[]> {
  const r = await getPool().query(`SELECT ${SELECT_COLS} FROM email_templates ORDER BY code`);
  return r.rows.map(rowToTemplate);
}

export async function getEmailTemplate(code: string): Promise<EmailTemplate | null> {
  const r = await getPool().query(
    `SELECT ${SELECT_COLS} FROM email_templates WHERE code = $1 LIMIT 1`,
    [code]
  );
  if (r.rowCount === 0) return null;
  return rowToTemplate(r.rows[0]);
}

export async function updateEmailTemplate(
  code: string,
  input: EmailTemplateInput,
  updatedBy: number | null
): Promise<EmailTemplate | null> {
  const r = await getPool().query(
    `UPDATE email_templates
       SET subject     = $1,
           body_text   = $2,
           body_html   = $3,
           description = COALESCE($4, description),
           updated_at  = NOW(),
           updated_by  = $5
     WHERE code = $6
     RETURNING ${SELECT_COLS}`,
    [
      input.subject,
      input.bodyText,
      input.bodyHtml ?? null,
      input.description ?? null,
      updatedBy,
      code
    ]
  );
  if (r.rowCount === 0) return null;
  return rowToTemplate(r.rows[0]);
}

/** Substitute {{var}} tokens. Unknown variables are left as-is so the
 *  admin sees them in the preview / sent email and can fix the typo. */
export function renderTemplate(
  body: string,
  vars: Record<string, string | undefined | null>
): string {
  return body.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_m, name) => {
    const v = vars[name];
    return v == null ? `{{${name}}}` : String(v);
  });
}

/** List of variable names the current templates use. Surfaced in the
 *  admin UI so editors know what tokens are available. */
export const TEMPLATE_VARIABLES: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'ref',             description: 'Booking reference (e.g. RB-0017)' },
  { name: 'date',            description: 'Booking date in YYYY-MM-DD' },
  { name: 'startTime',       description: 'Start time in HH:MM' },
  { name: 'endTime',         description: 'End time in HH:MM' },
  { name: 'room',            description: 'Room name' },
  { name: 'purpose',         description: 'Booking purpose' },
  { name: 'supportRequests', description: 'Free-text IT support request (may be empty)' },
  { name: 'bookerName',      description: 'Display name of the user who made the booking' },
  { name: 'bookerEmail',     description: 'Email of the booker (Reply-To target)' },
  { name: 'bookerTeam',      description: 'Team of the booker' },
  // ---- LEAVE_DIGEST / WEEKLY_LEAVE_REPORT (RFQ §2(c)) ----
  { name: 'displayName',     description: 'Display name of the recipient (LEAVE_DIGEST, WEEKLY_LEAVE_REPORT)' },
  { name: 'team',            description: "Recipient's team (LEAVE_DIGEST)" },
  { name: 'totalBookings',   description: 'Count of bookings in the digest period (LEAVE_DIGEST)' },
  { name: 'totalLeave',      description: 'Count of leave records in the digest period (LEAVE_DIGEST, WEEKLY_LEAVE_REPORT)' },
  { name: 'fromDate',        description: 'Start date of the report window YYYY-MM-DD (WEEKLY_LEAVE_REPORT)' },
  { name: 'toDate',          description: 'End date of the report window YYYY-MM-DD (WEEKLY_LEAVE_REPORT)' }
];

// ---------- helpers ----------
function rowToTemplate(r: any): EmailTemplate {
  return {
    code: r.code,
    subject: r.subject,
    bodyText: r.body_text,
    bodyHtml: r.body_html ?? null,
    description: r.description ?? '',
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)
  };
}
