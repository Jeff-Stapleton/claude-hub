/**
 * Thin client for the hub's own HTTP API. Used by the MCP tools below so
 * MCP-originated mutations go through the same validation, persistence,
 * and WS-broadcast pipeline as UI mutations.
 *
 * Base URL comes from CLAUDE_HUB_URL; defaults to the standard loopback
 * port. Intentionally a single fetch wrapper — no retries, no streaming.
 * Hub is on loopback and startup-ordered before the orchestrator spawns.
 */

const DEFAULT_BASE = 'http://127.0.0.1:7878';

export class HubClient {
  readonly base: string;

  constructor(base?: string) {
    this.base = base ?? process.env.CLAUDE_HUB_URL ?? DEFAULT_BASE;
  }

  async get<T>(path: string): Promise<T> {
    return this.req<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    return this.req<T>(path, init);
  }

  async del<T>(path: string): Promise<T> {
    return this.req<T>(path, { method: 'DELETE' });
  }

  private async req<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`hub ${init.method} ${path} -> ${res.status}${text ? `: ${text}` : ''}`);
    }
    return (await res.json()) as T;
  }
}
