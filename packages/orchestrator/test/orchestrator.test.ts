import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunner, RunProjectSessionResult } from '@claude-hub/agent-runner';
import { HubPaths, Store } from '@claude-hub/core';
import { Orchestrator } from '../src/orchestrator.js';

const mockRun = vi.fn<AgentRunner['runProjectSession']>();
const runner: AgentRunner = {
  runProjectSession: mockRun,
};

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
    orchestrator = new Orchestrator(
      store,
      {
        workdir: root,
        claudeMcpConfigPath: '/fake/mcp-config.json',
        timeoutMs: 5000,
      },
      runner,
    );
    mockRun.mockReset();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns text from a successful CC run', async () => {
    mockRun.mockResolvedValue({
      ok: true,
      provider: 'claude',
      sessionId: 'sess-1',
      text: 'hello world',
      durationMs: 100,
      raw: {} as never,
    });

    const result = await orchestrator.handle(makeMsg('say hello'));
    expect(result).toEqual({ ok: true, text: 'hello world' });
  });

  it('persists the session id per conversation for resume', async () => {
    mockRun.mockResolvedValue({
      ok: true,
      provider: 'claude',
      sessionId: 'sess-abc',
      text: 'first',
      durationMs: 50,
      raw: {} as never,
    });

    await orchestrator.handle(makeMsg('turn 1'));
    const state = store.orchestrator();
    expect(state.channelSessions['claude:discord:user-1']).toBe('sess-abc');

    // Second call should pass the session id for resume.
    mockRun.mockResolvedValue({
      ok: true,
      provider: 'claude',
      sessionId: 'sess-abc',
      text: 'second',
      durationMs: 50,
      raw: {} as never,
    });
    await orchestrator.handle(makeMsg('turn 2'));
    expect(mockRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 'sess-abc' }),
    );
  });

  it('keeps separate sessions for different conversations', async () => {
    mockRun
      .mockResolvedValueOnce({
        ok: true, provider: 'claude', sessionId: 'sess-A', text: 'a', durationMs: 10, raw: {} as never,
      })
      .mockResolvedValueOnce({
        ok: true, provider: 'claude', sessionId: 'sess-B', text: 'b', durationMs: 10, raw: {} as never,
      });

    await orchestrator.handle(makeMsg('hi', 'alice'));
    await orchestrator.handle(makeMsg('hi', 'bob'));

    const sessions = store.orchestrator().channelSessions;
    expect(sessions['claude:discord:alice']).toBe('sess-A');
    expect(sessions['claude:discord:bob']).toBe('sess-B');
  });

  it('returns ok:false on CC failure and records the error', async () => {
    mockRun.mockResolvedValue({
      ok: false,
      provider: 'claude',
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
    mockRun.mockImplementation(async () => {
      const idx = callIndex++;
      // Simulate variable latency — first call takes longer.
      await new Promise((r) => setTimeout(r, idx === 0 ? 50 : 10));
      order.push(idx);
      return {
        ok: true as const,
        provider: 'claude' as const,
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

  it('passes Claude MCP args and timeoutMs to the agent runner', async () => {
    mockRun.mockResolvedValue({
      ok: true, provider: 'claude', sessionId: 's', text: 'ok', durationMs: 10, raw: {} as never,
    });

    await orchestrator.handle(makeMsg('test'));

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'claude',
        extraArgs: ['--mcp-config', '/fake/mcp-config.json'],
        timeoutMs: 5000,
      }),
    );
  });

  it('does not pass Claude MCP args for Cursor sessions', async () => {
    await store.update('config', { ...store.config(), defaultProvider: 'cursor' });
    mockRun.mockResolvedValue({
      ok: true,
      provider: 'cursor',
      sessionId: 'cursor-s',
      text: 'ok',
      durationMs: 10,
      raw: {} as never,
    });

    await orchestrator.handle(makeMsg('test'));

    expect(mockRun).toHaveBeenCalledWith(
      expect.not.objectContaining({ extraArgs: expect.any(Array) }),
    );
    expect(store.orchestrator().channelSessions['cursor:discord:user-1']).toBe('cursor-s');
  });
});
