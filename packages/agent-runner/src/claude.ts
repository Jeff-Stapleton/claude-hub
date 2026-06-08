import { spawnProjectSession } from '@claude-hub/cc-runner';
import type { ClaudeProviderConfig } from '@claude-hub/core';
import type { RunProjectSessionOptions, RunProjectSessionResult } from './types.js';

export async function runClaudeProjectSession(
  config: ClaudeProviderConfig,
  opts: RunProjectSessionOptions,
): Promise<RunProjectSessionResult> {
  if (!config.enabled) {
    return { ok: false, provider: 'claude', error: 'Claude Code provider is disabled' };
  }

  const result = await spawnProjectSession({
    cwd: opts.cwd,
    prompt: opts.prompt,
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ...(config.cliPath ? { claudePath: config.cliPath } : {}),
    ...(config.dangerouslySkipPermissions !== undefined
      ? { dangerouslySkipPermissions: config.dangerouslySkipPermissions }
      : {}),
    ...(opts.extraArgs ? { extraArgs: opts.extraArgs } : {}),
  });

  if (!result.ok) {
    return { ...result, provider: 'claude' };
  }

  return {
    ok: true,
    provider: 'claude',
    sessionId: result.sessionId,
    text: result.text,
    durationMs: result.durationMs,
    ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
    raw: result.raw,
  };
}
