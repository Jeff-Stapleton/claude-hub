import type { AgentRunner } from '@claude-hub/agent-runner';
import type { Project, ProjectMonitorCheck, Store } from '@claude-hub/core';
import { isAbsolute, relative, resolve } from 'node:path';
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

/**
 * A heartbeat tick (or the final stop() observation) arriving this much late
 * means the host slept/suspended mid-check — on a laptop, Power Nap freezes
 * the whole process, so every timeout in flight fires late on wake and a
 * healthy target reads as timed out.
 */
export const SUSPENSION_GAP_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 1_000;

export interface CheckRunResult {
  ok: boolean;
  /** Truncated to CHECK_OUTPUT_LIMIT. */
  output: string;
  error?: string;
  durationMs: number;
  /** The host appears to have slept during the run — timings are unreliable. */
  suspended: boolean;
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
 *
 * A failure observed while the host slept mid-check is unverifiable, so it
 * is re-run once immediately (this code executing proves the host is awake
 * now). A second suspended failure returns as-is with `suspended: true` and
 * the scheduler records it as inconclusive instead of a fail.
 */
export async function runProjectCheck(
  deps: ProjectCheckDeps,
  project: Project,
  check: ProjectMonitorCheck,
): Promise<CheckRunResult> {
  const first = await runCheckAttempt(deps, project, check);
  if (first.ok || !first.suspended) return first;
  return runCheckAttempt(deps, project, check);
}

async function runCheckAttempt(
  deps: ProjectCheckDeps,
  project: Project,
  check: ProjectMonitorCheck,
): Promise<CheckRunResult> {
  const detector = startSuspensionDetector();
  // runCheckOnce never throws — its own catch converts errors to a result.
  const res = await runCheckOnce(deps, project, check);
  return { ...res, suspended: detector.stop() };
}

/**
 * Wall-clock heartbeat. Comparing hrtime to Date.now() would be simpler but
 * assumes the monotonic clock pauses during sleep, which varies by platform;
 * a late-arriving timer tick has no such ambiguity. The gap is also checked
 * at stop() so a sleep near the end of a check is caught even if no further
 * heartbeat fires.
 */
function startSuspensionDetector(): { stop(): boolean } {
  let last = Date.now();
  let suspended = false;
  const observe = (): void => {
    const now = Date.now();
    if (now - last > SUSPENSION_GAP_MS) suspended = true;
    last = now;
  };
  const timer = setInterval(observe, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return {
    stop(): boolean {
      clearInterval(timer);
      observe();
      return suspended;
    },
  };
}

async function runCheckOnce(
  deps: ProjectCheckDeps,
  project: Project,
  check: ProjectMonitorCheck,
): Promise<Omit<CheckRunResult, 'suspended'>> {
  const started = Date.now();
  try {
    switch (check.type) {
      case 'http':
        return await runHttpCheck(check.url, check.expectedStatus, check.timeoutMs, started);
      case 'command': {
        const cwd = resolveCommandCwd(project.path, check.cwd);
        const result = await runCommands([check.command], {
          cwd,
          timeoutMs: check.timeoutMs ?? DEFAULT_COMMAND_CHECK_TIMEOUT_MS,
        });
        const error = result.timedOut
          ? `command timed out: ${check.command}`
          : result.ok
            ? undefined
            : `command failed (exit ${result.exitCode})`;
        return {
          ok: result.ok,
          output: truncateCheckOutput(`cwd: ${cwd}\n${result.output}`),
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
): Promise<Omit<CheckRunResult, 'suspended'>> {
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
): Promise<Omit<CheckRunResult, 'suspended'>> {
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
  const verdict = checkResultMarker('strict', result.text);
  // WAIT has no meaning for a project check — treat it as a failure so a
  // misconfigured prompt surfaces instead of silently passing.
  const error =
    verdict.verdict === 'fail'
      ? verdict.error
      : verdict.verdict === 'wait'
        ? 'agent reported MACHINE_RESULT: WAIT — WAIT is only valid inside a machine monitor loop'
        : undefined;
  return {
    ok: error === undefined,
    output: truncateCheckOutput(result.text),
    ...(error !== undefined ? { error } : {}),
    durationMs: Date.now() - started,
  };
}

function truncateCheckOutput(text: string): string {
  if (text.length <= CHECK_OUTPUT_LIMIT) return text;
  return text.slice(0, CHECK_OUTPUT_LIMIT) + '\n… [truncated]';
}

function resolveCommandCwd(projectPath: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd.trim() === '') return projectPath;
  if (isAbsolute(cwd)) throw new Error('command cwd must be relative to the project root');
  const resolved = resolve(projectPath, cwd);
  const rel = relative(projectPath, resolved);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new Error('command cwd cannot leave the project root');
  }
  return resolved;
}
