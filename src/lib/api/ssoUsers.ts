// SSO allowlist client — wraps the 5 endpoints that back /admin/users'
// SSO-user section. `lookup(email)` is the read-only endpoint used by the
// FE bridge to map an Azure ID-token email to a local account.
//
// Admin endpoints (`list/create/update/remove`) require a valid sso_session
// cookie belonging to an ADMIN-role row in sso_users (gated by the server's
// requireAdmin middleware). The cookie travels automatically with same-origin
// jsonFetch calls.
import { jsonFetch } from './fetch';
import type { User } from '../types';

export interface SsoUserView extends User {
  /** Last-seen Azure OID. Server populates this on every successful login. */
  oid?: string;
}

export type SsoUserInput = Pick<SsoUserView, 'email' | 'displayName' | 'role' | 'team' | 'title' | 'enabled'> & {
  username?: string;
};

export const SsoUsers = {
  async list(): Promise<{ users: SsoUserView[] }> {
    return jsonFetch<{ users: SsoUserView[] }>('/api/sso/users');
  },

  /** Read-only directory of all SSO users, open to any signed-in user
   *  (not admin-gated). Used by the people pickers on Tasks / Leave /
   *  Bookings pages so a non-admin user (e.g. a USER-role SSO row) still
   *  sees their colleagues in the Assignee dropdown. Same payload shape
   *  as `list()`. */
  async directory(): Promise<{ users: SsoUserView[] }> {
    return jsonFetch<{ users: SsoUserView[] }>('/api/sso/users/directory');
  },

  async lookup(email: string): Promise<{ user: SsoUserView | null }> {
    return jsonFetch<{ user: SsoUserView | null }>(
      `/api/sso/users/lookup?email=${encodeURIComponent(email)}`
    );
  },

  async create(input: SsoUserInput): Promise<{ user: SsoUserView }> {
    return jsonFetch<{ user: SsoUserView }>('/api/sso/users', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },

  async update(id: number, input: Partial<SsoUserInput>): Promise<{ user: SsoUserView }> {
    return jsonFetch<{ user: SsoUserView }>(`/api/sso/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  },

  async remove(id: number): Promise<{ ok: true }> {
    return jsonFetch<{ ok: true }>(`/api/sso/users/${id}`, { method: 'DELETE' });
  },

  /** Self-service profile update (RFQ §2(d) — "Allows users to manage
   *  their own profile settings"). Open to any SSO-signed-in user; only
   *  mutates their own sso_users row (displayName / title / team /
   *  email). role / enabled / username remain admin-only — the server
   *  endpoint rejects them with 403 if a non-admin tries to send them.
   *
   *  Throws on 409 (email already registered) so the FE can surface a
   *  friendly toast. */
  async updateMe(input: Partial<Pick<SsoUserInput, 'displayName' | 'title' | 'team' | 'email'>>): Promise<{ user: SsoUserView }> {
    return jsonFetch<{ user: SsoUserView }>('/api/sso/users/me', {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  }
};