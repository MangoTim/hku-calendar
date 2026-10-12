// SSO admin client — wraps the 3 config endpoints exposed by the Express
// API server. Reuses jsonFetch from ./fetch.ts (same shape as Db, AuditEvents).
//
// The server never returns the plaintext `clientSecret` to the FE — only
// `clientSecretMasked` (last-4 of the stored value) so admins can verify
// "yes the same secret is still set" without us leaking it over the wire.
import { jsonFetch } from './fetch';

export type SsoMode = 'LOCAL' | 'MIXED' | 'SSO';
export type SsoDirectoryMode = 'DEMO' | 'GRAPH';

export interface SsoConfigView {
  mode: SsoMode;
  directoryMode: SsoDirectoryMode;
  tenantId: string;
  authorityUrl: string;
  clientId: string;
  clientSecretMasked: string;
  lastTestedAt: string | null;
  lastTestResult: 'GOOD' | 'FAIL' | null;
  lastTestSteps: string[] | null;
}

export interface SsoConfigInput {
  mode: SsoMode;
  directoryMode: SsoDirectoryMode;
  tenantId: string;
  authorityUrl: string;
  clientId: string;
  /** Empty/undefined → server keeps the existing stored secret. */
  clientSecret?: string;
}

export const SsoConfig = {
  async get(): Promise<SsoConfigView> {
    return jsonFetch<SsoConfigView>('/api/sso/config');
  },
  async save(input: SsoConfigInput): Promise<{ ok: true }> {
    return jsonFetch<{ ok: true }>('/api/sso/config', {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  },
  async test(): Promise<{ ok: boolean; steps: string[] }> {
    return jsonFetch<{ ok: boolean; steps: string[] }>('/api/sso/test', {
      method: 'POST'
    });
  }
};
