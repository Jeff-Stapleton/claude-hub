import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubPaths, Store } from '@claude-hub/core';
import { Orchestrator } from '../src/orchestrator.js';

// Mock cc-runner so we don't spawn real claude processes.
vi.mock('@claude-hub/cc-runner', () => ({
  spawnProjectSession: vi.fn(),
}));
import { spawnProjectSession } from '@claude-hub/cc-runner';
const mockSpawn = vi.mocked(spawnProjectSession);

function makeMsg(text: string, conversationId = 'user-1') {
  return {
    channelId: 'discord',
    conversationId,
    user: 'tester',
    text,
    receivedAt: new Date().toISOString(),
  };
}

describe('Orchestrator', () => {
  let root: string;
  let store: Store;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orch-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    orchestrator = new Orchestrator(store, {
      workdir: root,
      mcpConfigPath: '/fake/mcp-config.json',
      timeoutMs: 5000,
    });
    mockSpawn.mockReset();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns text from a successful CC run', async () => {
    mockSpawn.mockResolvedValue({
      ok: true,
      sessionId: 'sess-1',
      text: 'hello world',
      durationMs: 100,
      raw: {} as never,
    });

    const result = await orchestrator.handle(makeMsg('say hello'));
    expect(result).toEqual({ ok: true, text: 'hello world' });
  });

  it('persists the session id per conversation for resume', async () => {
    mockSpawn.mockResolvedValue({
      ok: true,
      sessionId: 'sess-abc',
      text: 'first',
      durationMs: 50,
      raw: {} as never,
    });

    await orchestrator.handle(makeMsg('turn 1'));
    const state = store.orchestrator();
    expect(state.channelSessions['discord:user-1']).toBe('sess-abc');

    // Second call should pass the session id for resume.
    mockSpawn.mockResolvedValue({
      ok: true,
      sessionId: 'sess-abc',
      text: 'second',
      durationMs: 50,
      raw: {} as never,
    });
    await orchestrator.handle(makeMsg('turn 2'));
    expect(mockSpawn).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 'sess-abc' }),
    );
  });

  it('keeps separate sessions for different conversations', async () => {
    mockSpawn
      .mockResolvedValueOnce({
        ok: true, sessionId: 'sess-A', text: 'a', durationMs: 10, raw: {} as never,
      })
      .mockResolvedValueOnce({
        ok: true, sessionId: 'sess-B', text: 'b', durationMs: 10, raw: {} as never,
      });

    await orchestrator.handle(makeMsg('hi', 'alice'));
    await orchestrator.handle(makeMsg('hi', 'bob'));

    const sessions = store.orchestrator().channelSessions;
    expect(sessions['discord:alice']).toBe('sess-A');
    expect(sessions['discord:bob']).toBe('sess-B');
  });

  it('returns ok:false on CC failure and records the error', async () => {
    mockSpawn.mockResolvedValue({
      ok: false,
      error: 'boom',
      stderr: 'stack trace',
      exitCode: 1,
    });

    const result = await orchestrator.handle(makeMsg('break'));
    expect(result).toEqual({ ok: false, error: 'boom' });
    expect(store.orchestrator().status).toBe('error');
    expect(store.orchestrator().lastError).toBe('boom');
  });

  it('serializes messages for the same conversation', async () => {
    // Track the order spawn calls resolve in.
    const order: number[] = [];
    let callIndex = 0;
    mockSpawn.mockImplementation(async () => {
      const idx = callIndex++;
      // Simulate variable latency — first call takes longer.
      await new Promise((r) => setTimeout(r, idx === 0 ? 50 : 10));
      order.push(idx);
      return {
        ok: true as const,
        sessionId: `s-${idx}`,
        text: `r-${idx}`,
        durationMs: 10,
        raw: {} as never,
      };
    });

    // Fire two messages for the same conversation concurrently.
    const [r1, r2] = await Promise.all([
      orchestrator.handle(makeMsg('first', 'same')),
      orchestrator.handle(makeMsg('second', 'same')),
    ]);

    // Both should succeed and execute IN ORDER despite the first taking
    // longer, because the per-conversation queue serializes them.
    expect(r1).toEqual({ ok: true, text: 'r-0' });
    expect(r2).toEqual({ ok: true, text: 'r-1' });
    expect(order).toEqual([0, 1]);
  });

  it('passes mcpConfigPath and timeoutMs to cc-runner', async () => {
    mockSpawn.mockResolvedValue({
      ok: true, sessionId: 's', text: 'ok', durationMs: 10, raw: {} as never,
    });

    await orchestrator.handle(makeMsg('test'));

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        extraArgs: ['--mcp-config', '/fake/mcp-config.json'],
        timeoutMs: 5000,
      }),
    );
  });
});
