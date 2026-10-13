// FE wrapper for the /api/email/* endpoints. BookingForm calls
// sendItSupport after a successful save when the form has itSupport=true.
import { jsonFetch } from './fetch';

export interface EmailConfig {
  itTeamEmail: string;
  smtpHost: string;
  smtpPort: number;
  from: string;
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

export const EmailApi = {
  config: (): Promise<EmailConfig> => jsonFetch<EmailConfig>('/api/email/config'),
  sendItSupport: (payload: ItSupportPayload): Promise<{ ok: true; messageId: string }> =>
    jsonFetch<{ ok: true; messageId: string }>('/api/email/it-support', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  test: (to: string): Promise<{ ok: true; messageId: string }> =>
    jsonFetch<{ ok: true; messageId: string }>('/api/email/test', {
      method: 'POST',
      body: JSON.stringify({ to })
    })
};
