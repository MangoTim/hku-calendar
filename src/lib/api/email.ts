// FE wrapper for the /api/email/* endpoints. BookingForm calls
// sendItSupport after a successful save when the form has itSupport=true.
import { jsonFetch } from './fetch';

export interface EmailConfig {
  itTeamEmail: string;
  smtpHost: string;
  smtpPort: number;
  from: string;
  /** 'db' = admin override in app_config; 'env' = container -e flag;
   *  'default' = neither set, build default used. */
  source?: 'db' | 'env' | 'default';
}

export interface ItSupportPayload {
  ref: string;
  date: string;
  startTime: string;
  endTime: string;
  room: string;
  purpose: string;
  supportRequests: string;
  booker: { name: string; email: string; team: string };
}

export interface EmailTemplate {
  code: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  description: string;
  updatedAt: string;
}

export interface EmailTemplateVariable {
  name: string;
  description: string;
}

export interface ItSupportPreviewPayload {
  ref: string;
  date: string;
  startTime: string;
  endTime: string;
  room: string;
  purpose: string;
  supportRequests: string;
  booker: { name: string; email: string; team: string };
}

export const EmailApi = {
  config: (): Promise<EmailConfig> => jsonFetch<EmailConfig>('/api/email/config'),
  updateConfig: (itTeamEmail: string): Promise<{ itTeamEmail: string; source: 'db' }> =>
    jsonFetch<{ itTeamEmail: string; source: 'db' }>('/api/email/config', {
      method: 'PUT',
      body: JSON.stringify({ itTeamEmail })
    }),
  sendItSupport: (payload: ItSupportPayload): Promise<{ ok: true; messageId: string }> =>
    jsonFetch<{ ok: true; messageId: string }>('/api/email/it-support', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  test: (to: string): Promise<{ ok: true; messageId: string }> =>
    jsonFetch<{ ok: true; messageId: string }>('/api/email/test', {
      method: 'POST',
      body: JSON.stringify({ to })
    }),
  // Admin template CRUD
  listTemplates: (): Promise<{ templates: EmailTemplate[]; variables: EmailTemplateVariable[] }> =>
    jsonFetch('/api/email/templates'),
  getTemplate: (code: string): Promise<{ template: EmailTemplate }> =>
    jsonFetch(`/api/email/templates/${encodeURIComponent(code)}`),
  updateTemplate: (code: string, input: { subject: string; bodyText: string; bodyHtml?: string | null; description?: string }): Promise<{ template: EmailTemplate }> =>
    jsonFetch(`/api/email/templates/${encodeURIComponent(code)}`, {
      method: 'PUT',
      body: JSON.stringify(input)
    }),
  previewTemplate: (code: string, payload: ItSupportPreviewPayload): Promise<{ subject: string; text: string; html: string }> =>
    jsonFetch(`/api/email/templates/${encodeURIComponent(code)}/preview`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
};
