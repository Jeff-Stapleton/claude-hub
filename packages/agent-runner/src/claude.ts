import { spawnProjectSession } from '@claude-hub/cc-runner';
import type { ClaudeProviderConfig } from '@claude-hub/core';
import { materializeClaudeTools } from './toolMaterializer.js';
import type { RunProjectSessionOptions, RunProjectSessionResult } from './types.js';

export async function runClaudeProjectSession(
  config: ClaudeProviderConfig,
  opts: RunProjectSessionOptions,
): Promise<RunProjectSessionResult> {
  if (!config.enabled) {
    return { ok: false, provider: 'claude', error: 'Claude Code provider is disabled' };
  }

  // Tool assignments materialize into an ephemeral dir (--plugin-dir /
  // --mcp-config); it must outlive the spawn and is removed right after.
  const materialized = opts.tools ? await materializeClaudeTools(opts.tools) : undefined;
  const extraArgs = [...(opts.extraArgs ?? []), ...(materialized?.extraArgs ?? [])];

  let result;
  try {
    result = await spawnProjectSession({
      cwd: opts.cwd,
      prompt: opts.prompt,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      ...(config.cliPath ? { claudePath: config.cliPath } : {}),
      ...(config.dangerouslySkipPermissions !== undefined
        ? { dangerouslySkipPermissions: config.dangerouslySkipPermissions }
        : {}),
      ...(extraArgs.length > 0 ? { extraArgs } : {}),
    });
  } finally {
    await materialized?.cleanup();
  }

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
