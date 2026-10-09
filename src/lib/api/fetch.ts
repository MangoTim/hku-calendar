// Shared fetch helper for the /api/* endpoints. Throws on non-2xx with a
// useful message that includes the HTTP method, path, and status code.
export async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  if (!r.ok) {
    // Try to extract a structured error message from the response body.
    let detail = '';
    try {
      const j = await r.json();
      detail = typeof j?.error === 'string' ? `: ${j.error}` : '';
    } catch { /* not JSON */ }
    throw new Error(`${init?.method || 'GET'} ${path} → ${r.status}${detail}`);
  }
  if (r.status === 204) return undefined as unknown as T;
  return r.json();
}
