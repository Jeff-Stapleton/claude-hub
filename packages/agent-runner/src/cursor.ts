import type { CursorProviderConfig } from '@claude-hub/core';
import { lastJsonObject, runProcess } from './process.js';
import { renderSkillPreamble } from './toolMaterializer.js';
import type { RunProjectSessionOptions, RunProjectSessionResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

interface CursorResultEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  error?: string;
  session_id?: string;
  duration_ms?: number;
  total_cost_usd?: number;
}

export async function runCursorProjectSession(
  config: CursorProviderConfig,
  opts: RunProjectSessionOptions,
): Promise<RunProjectSessionResult> {
  if (!config.enabled) {
    return { ok: false, provider: 'cursor', error: 'Cursor CLI provider is disabled' };
  }

  const command = config.cliPath?.trim() ? config.cliPath : 'agent';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = buildCursorArgs(config, opts);
  const proc = await runProcess({ command, args, cwd: opts.cwd, timeoutMs });

  if (proc.spawnError) {
    return {
      ok: false,
      provider: 'cursor',
      error: `spawn failed: ${proc.spawnError}`,
      stderr: proc.stderr,
      exitCode: proc.exitCode,
    };
  }

  if (proc.timedOut) {
    return {
      ok: false,
      provider: 'cursor',
      error: `timed out after ${timeoutMs}ms`,
      stdout: proc.stdout,
      stderr: proc.stderr,
      exitCode: proc.exitCode,
    };
  }

  const parsed = parseCursorEnvelope(proc.stdout);
  if (!parsed) {
    return {
      ok: false,
      provider: 'cursor',
      error:
        proc.exitCode === 0
          ? 'cursor agent exited cleanly but stdout was not a JSON result envelope'
          : `cursor agent exited with code ${proc.exitCode}`,
      stdout: proc.stdout,
      stderr: proc.stderr,
      exitCode: proc.exitCode,
    };
  }

  if (parsed.is_error || parsed.subtype === 'error') {
    return {
      ok: false,
      provider: 'cursor',
      error: parsed.error ?? parsed.result ?? `cursor agent reported subtype=${parsed.subtype}`,
      stdout: proc.stdout,
      stderr: proc.stderr,
      exitCode: proc.exitCode,
    };
  }

  const sessionId = parsed.session_id;
  if (!sessionId) {
    return {
      ok: false,
      provider: 'cursor',
      error: 'cursor agent result missing session_id',
      stdout: proc.stdout,
      stderr: proc.stderr,
      exitCode: proc.exitCode,
    };
  }

  return {
    ok: true,
    provider: 'cursor',
    sessionId,
    text: parsed.result ?? '',
    durationMs: parsed.duration_ms ?? 0,
    ...(parsed.total_cost_usd !== undefined ? { costUsd: parsed.total_cost_usd } : {}),
    raw: parsed,
  };
}

export function buildCursorArgs(
  config: CursorProviderConfig,
  opts: RunProjectSessionOptions,
): string[] {
  const args = ['-p', '--output-format', 'json', '--model', config.model, '--workspace', opts.cwd];

  if (opts.sessionId) args.push('--resume', opts.sessionId);
  if (config.force) args.push('--force');
  if (config.trust) args.push('--trust');
  if (config.approveMcps) args.push('--approve-mcps');
  if (config.sandbox) args.push('--sandbox', config.sandbox);
  if (opts.extraArgs) args.push(...opts.extraArgs);

  // Cursor has no per-run skill-loading flag, so assigned skills ride in as
  // a prompt preamble. Assigned MCP servers are skipped: the only discovery
  // path is <workspace>/.cursor/mcp.json, and writing into the user's repo
  // is not acceptable — v1 documents that MCP applies to claude runs only.
  if (opts.tools?.mcpServers.length) {
    console.warn(
      `[agent-runner] cursor run ignoring ${opts.tools.mcpServers.length} assigned MCP server(s); MCP assignment is claude-only`,
    );
  }
  const preamble = opts.tools ? renderSkillPreamble(opts.tools.skills) : '';
  args.push(preamble + opts.prompt);

  return args;
}

function parseCursorEnvelope(stdout: string): CursorResultEnvelope | null {
  const parsed = lastJsonObject(stdout);
  if (!isRecord(parsed)) return null;

  const result = parsed as CursorResultEnvelope;
  if (typeof result.result !== 'string' && typeof result.error !== 'string') return null;
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
