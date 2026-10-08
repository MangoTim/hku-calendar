// Audit + System Logs — remote API client (proxied to :8092 via vite.config).
import type { AuditEvent, SystemLog } from './types';

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  if (!r.ok) throw new Error(`${init?.method || 'GET'} ${path} → ${r.status}`);
  return r.json();
}

export const AuditEvents = {
  async all(): Promise<AuditEvent[]> {
    return jsonFetch<AuditEvent[]>('/api/audit-events');
  },
  async create(partial: Omit<AuditEvent, 'id' | 'createdAt'>): Promise<AuditEvent> {
    return jsonFetch<AuditEvent>('/api/audit-events', { method: 'POST', body: JSON.stringify(partial) });
  }
};

export const SystemLogs = {
  async all(): Promise<SystemLog[]> {
    return jsonFetch<SystemLog[]>('/api/system-logs');
  },
  async create(partial: Omit<SystemLog, 'id' | 'createdAt'>): Promise<SystemLog> {
    return jsonFetch<SystemLog>('/api/system-logs', { method: 'POST', body: JSON.stringify(partial) });
  },
  async setResolved(id: number, resolved: boolean): Promise<SystemLog> {
    return jsonFetch<SystemLog>(`/api/system-logs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved })
    });
  }
};

// Health-check helper for the System status row.
export async function apiHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await fetch('/health');
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    const j = await r.json();
    return j?.db === 'ok' ? { ok: true, detail: `${j.status} · db ${j.db}` } : { ok: false, detail: 'no db' };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}