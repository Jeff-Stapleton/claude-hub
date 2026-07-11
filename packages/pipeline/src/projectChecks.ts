import type { AgentRunner } from '@claude-hub/agent-runner';
import type { Project, ProjectMonitorCheck, Store } from '@claude-hub/core';
import { runCommands } from './commands.js';
import { MACHINE_FAIL_MARKER, MACHINE_PASS_MARKER } from './defaults.js';
import { buildProjectPreamble, checkResultMarker, resolveToolAssignments } from './stages.js';

/**
 * Stored check output cap. Deliberately much tighter than STAGE_OUTPUT_LIMIT:
 * the latest output of every check rides each WS fat-patch, and project
 * checks keep no JSONL history to fall back on.
 */
export const CHECK_OUTPUT_LIMIT = 4_000;

export const DEFAULT_HTTP_CHECK_TIMEOUT_MS = 10_000;
export const DEFAULT_COMMAND_CHECK_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_AGENT_CHECK_TIMEOUT_MS = 30 * 60_000;

export interface CheckRunResult {
  ok: boolean;
  /** Truncated to CHECK_OUTPUT_LIMIT. */
  output: string;
  error?: string;
  durationMs: number;
}

export interface ProjectCheckDeps {
  store: Store;
  agentRunner: AgentRunner;
}

/**
 * Runs one project-monitor check. Unlike executeMachine this is not tied to
 * a work item: there is no template context, no session resume (every agent
 * check is a fresh run so context never accretes), and no JSONL history —
 * the truncated result on the monitor entity is the record.
 */
export async function runProjectCheck(
  deps: ProjectCheckDeps,
  project: Project,
  check: ProjectMonitorCheck,
): Promise<CheckRunResult> {
  const started = Date.now();
  try {
    switch (check.type) {
      case 'http':
        return await runHttpCheck(check.url, check.expectedStatus, check.timeoutMs, started);
      case 'command': {
        const result = await runCommands([check.command], {
          cwd: project.path,
          timeoutMs: check.timeoutMs ?? DEFAULT_COMMAND_CHECK_TIMEOUT_MS,
        });
        const error = result.timedOut
          ? `command timed out: ${check.command}`
          : result.ok
            ? undefined
            : `command failed (exit ${result.exitCode})`;
        return {
          ok: result.ok,
          output: truncateCheckOutput(result.output),
          ...(error !== undefined ? { error } : {}),
          durationMs: Date.now() - started,
        };
      }
      case 'agent':
        return await runAgentCheck(deps, project, check, started);
    }
  } catch (err) {
    return {
      ok: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

async function runHttpCheck(
  url: string,
  expectedStatus: number | undefined,
  timeoutMs: number | undefined,
  started: number,
): Promise<CheckRunResult> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_HTTP_CHECK_TIMEOUT_MS),
    redirect: 'follow',
  });
  // Release the connection without buffering the body.
  try {
    await res.body?.cancel();
  } catch {
    // A body that fails to cancel doesn't change the health verdict.
  }
  const ok = expectedStatus !== undefined ? res.status === expectedStatus : res.ok;
  return {
    ok,
    output: `HTTP ${res.status} ${res.statusText}`.trim(),
    ...(ok
      ? {}
      : { error: `expected ${expectedStatus ?? '2xx'}, got ${res.status}` }),
    durationMs: Date.now() - started,
  };
}

async function runAgentCheck(
  deps: ProjectCheckDeps,
  project: Project,
  check: Extract<ProjectMonitorCheck, { type: 'agent' }>,
  started: number,
): Promise<CheckRunResult> {
  const provider = check.provider ?? deps.store.config().defaultProvider;
  // Project-level skills/MCP servers apply via the union; the check itself
  // carries no tool assignments of its own.
  const tools = resolveToolAssignments(deps.store, { key: `monitor:${check.id}` }, project);
  const prompt =
    buildProjectPreamble(project) +
    'You are the continuous health monitor for this project, checking that ' +
    'the shipped application/service is healthy right now.\n\n' +
    `${check.prompt}\n\n` +
    `End your reply with exactly one line: ${MACHINE_PASS_MARKER} if everything ` +
    `is healthy, or ${MACHINE_FAIL_MARKER} with a short reason.`;

  const result = await deps.agentRunner.runProjectSession({
    provider,
    cwd: project.path,
    prompt,
    timeoutMs: check.timeoutMs ?? DEFAULT_AGENT_CHECK_TIMEOUT_MS,
    tools,
  });
  if (!result.ok) {
    return { ok: false, output: '', error: result.error, durationMs: Date.now() - started };
  }
  const markerError = checkResultMarker('strict', result.text);
  return {
    ok: markerError === undefined,
    output: truncateCheckOutput(result.text),
    ...(markerError !== undefined ? { error: markerError } : {}),
    durationMs: Date.now() - started,
  };
}

function truncateCheckOutput(text: string): string {
  if (text.length <= CHECK_OUTPUT_LIMIT) return text;
  return text.slice(0, CHECK_OUTPUT_LIMIT) + '\n… [truncated]';
}
