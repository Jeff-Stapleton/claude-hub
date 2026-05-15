import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api.js';

interface CapturedCall {
  url: string;
  init: RequestInit | undefined;
}

let calls: CapturedCall[];
let nextResponse: { ok: boolean; status?: number; statusText?: string; body?: string };

beforeEach(() => {
  calls = [];
  nextResponse = { ok: true, body: '{}' };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const ok = nextResponse.ok;
      return Promise.resolve({
        ok,
        status: nextResponse.status ?? (ok ? 200 : 400),
        statusText: nextResponse.statusText ?? (ok ? 'OK' : 'Bad Request'),
        text: () => Promise.resolve(nextResponse.body ?? ''),
        json: () => Promise.resolve(JSON.parse(nextResponse.body ?? '{}')),
      } as Response);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web api client', () => {
  it('does NOT set content-type when there is no body (regression: DELETE bug)', async () => {
    // The req() wrapper used to unconditionally set Content-Type:
    // application/json, which made Fastify reject bodyless DELETEs with
    // FST_ERR_CTP_EMPTY_JSON_BODY (fixed in commit 7d1832b).
    await api.deleteTrigger('trig-1');
    const headers = new Headers(calls.at(-1)?.init?.headers ?? {});
    expect(headers.has('content-type')).toBe(false);
  });

  it('sets content-type application/json when a body is sent', async () => {
    await api.addProject({ path: '/x' });
    const headers = new Headers(calls.at(-1)?.init?.headers ?? {});
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('deleteTrigger issues DELETE to the URL-encoded path', async () => {
    await api.deleteTrigger('abc 123');
    const call = calls.at(-1);
    expect(call?.init?.method).toBe('DELETE');
    expect(call?.url).toBe('/api/triggers/abc%20123');
    expect(call?.init?.body).toBeUndefined();
  });

  it('deleteProject also issues a bodyless DELETE without content-type', async () => {
    await api.deleteProject('proj-9');
    const call = calls.at(-1);
    expect(call?.init?.method).toBe('DELETE');
    expect(call?.init?.body).toBeUndefined();
    const headers = new Headers(call?.init?.headers ?? {});
    expect(headers.has('content-type')).toBe(false);
  });

  it('throws an Error including status code and response body on non-2xx', async () => {
    nextResponse = { ok: false, status: 400, statusText: 'Bad Request', body: '{"error":"nope"}' };
    await expect(api.addProject({ path: '/x' })).rejects.toThrow(/400[\s\S]*nope/);
  });
});
