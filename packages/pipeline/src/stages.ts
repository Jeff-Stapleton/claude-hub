import type { AgentRunner, RunToolAssignments } from '@claude-hub/agent-runner';
import {
  render,
  type AgentProviderId,
  type PipelineStageId,
  type Project,
  type StageConfig,
  type Store,
  type WorkItem,
} from '@claude-hub/core';
import { runCommands } from './commands.js';
import {
  DEFAULT_STAGE_TEMPLATES,
  MONITOR_FAIL_MARKER,
  MONITOR_PASS_MARKER,
  TEST_FAIL_MARKER,
} from './defaults.js';

/** Live WorkItem stage output cap; full text goes to JSONL history. */
export const STAGE_OUTPUT_LIMIT = 32_000;

/** Stages where `commands` are honored and an explicit template is optional. */
const COMMAND_STAGES: ReadonlySet<PipelineStageId> = new Set(['test', 'deploy', 'monitor']);

export interface ExecuteStageDeps {
  store: Store;
  agentRunner: AgentRunner;
  /** Fallback when the stage config has no timeoutMs. */
  defaultTimeoutMs?: number;
}

export interface ExecuteStageResult {
  ok: boolean;
  /** Combined agent text + command log (untruncated). */
  output: string;
  /** The rendered prompt, when an agent run happened. */
  prompt?: string;
  error?: string;
  /** Provider session id to persist on the item, when an agent run happened. */
  session?: { provider: AgentProviderId; sessionId: string };
}

/**
 * Executes one stage of a work item: an agent run (templated), then shell
 * commands for test/deploy/monitor stages. Both must succeed. A stage on a
 * command-capable station configured with commands but no explicit template
 * runs commands only.
 *
 * Pure with respect to the store — the caller persists all state changes.
 */
export async function executeStage(
  deps: ExecuteStageDeps,
  item: WorkItem,
  stageId: PipelineStageId,
  cfg: StageConfig,
  project: Project,
): Promise<ExecuteStageResult> {
  const projectPath = project.path;
  const timeoutMs = cfg.timeoutMs ?? deps.defaultTimeoutMs ?? deps.store.config().triggerTimeoutMs;
  const hasCommands = COMMAND_STAGES.has(stageId) && (cfg.commands?.length ?? 0) > 0;
  // Commands-only stations skip the agent run unless a template is set.
  const runAgent = cfg.promptTemplate !== undefined || !hasCommands;

  const outputs: string[] = [];
  let prompt: string | undefined;
  let session: ExecuteStageResult['session'];

  if (runAgent) {
    const template = cfg.promptTemplate ?? DEFAULT_STAGE_TEMPLATES[stageId];
    const rendered = render(template, buildContext(item));
    prompt = buildProjectPreamble(project) + rendered;
    const provider = cfg.provider ?? deps.store.config().defaultProvider;
    const sessionId = item.sessions?.[provider];

    const result = await deps.agentRunner.runProjectSession({
      provider,
      cwd: projectPath,
      prompt,
      ...(sessionId !== undefined ? { sessionId } : {}),
      timeoutMs,
      tools: resolveToolAssignments(deps.store, stageId, cfg, project),
    });

    if (!result.ok) {
      return {
        ok: false,
        output: outputs.join('\n'),
        prompt,
        error: result.error,
      };
    }

    outputs.push(result.text);
    session = { provider, sessionId: result.sessionId };

    const markerError = checkResultMarker(stageId, result.text);
    if (markerError) {
      return { ok: false, output: outputs.join('\n\n'), prompt, error: markerError, session };
    }
  }

  if (hasCommands) {
    const cmdResult = await runCommands(cfg.commands ?? [], { cwd: projectPath, timeoutMs });
    outputs.push(cmdResult.output);
    if (!cmdResult.ok) {
      const reason = cmdResult.timedOut
        ? `command timed out: ${cmdResult.failedCommand}`
        : `command failed (exit ${cmdResult.exitCode}): ${cmdResult.failedCommand}`;
      return {
        ok: false,
        output: outputs.join('\n\n'),
        ...(prompt !== undefined ? { prompt } : {}),
        error: reason,
        ...(session ? { session } : {}),
      };
    }
  }

  return {
    ok: true,
    output: outputs.join('\n\n'),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(session ? { session } : {}),
  };
}

/**
 * Project name/vision/context rendered ahead of every stage prompt so each
 * machine works with the project's guiding intent. Provider-agnostic (plain
 * prompt text), and empty for migrated projects with no vision or context —
 * those runs behave exactly as before.
 */
export function buildProjectPreamble(project: Project): string {
  // Tolerate pre-v5 shapes (no vision field) that can linger in fixtures
  // or stores created through the legacy add_project path.
  const vision = (project.vision ?? '').trim();
  const context = project.context?.trim() ?? '';
  if (!vision && !context) return '';
  const parts = [`# Project: ${project.name}`];
  if (vision) parts.push(`## Vision\n\n${vision}`);
  if (context) parts.push(`## Project context\n\n${context}`);
  return parts.join('\n\n') + '\n\n---\n\n';
}

/**
 * Resolves toolbox assignments (ids) to full definitions for the agent
 * runner: the union of project-level assignments (shared by every machine
 * in the lane) and the stage's own. Always returns a payload —
 * present-but-empty keeps runs deny-by-default (strict MCP config). Ids
 * whose tool has since been deleted are dropped with a warning rather than
 * failing the stage.
 */
function resolveToolAssignments(
  store: Store,
  stageId: PipelineStageId,
  cfg: StageConfig,
  project: Project,
): RunToolAssignments {
  const toolbox = store.toolbox();
  const skillIds = [...new Set([...(project.skills ?? []), ...(cfg.skills ?? [])])];
  const serverIds = [...new Set([...(project.mcpServers ?? []), ...(cfg.mcpServers ?? [])])];
  const skills: RunToolAssignments['skills'] = [];
  for (const id of skillIds) {
    const skill = toolbox.skills.find((s) => s.id === id);
    if (!skill) {
      console.warn(`[pipeline] stage "${stageId}": assigned skill ${id} no longer exists`);
      continue;
    }
    skills.push({ name: skill.name, description: skill.description, body: skill.body });
  }
  const mcpServers: RunToolAssignments['mcpServers'] = [];
  for (const id of serverIds) {
    const server = toolbox.mcpServers.find((m) => m.id === id);
    if (!server) {
      console.warn(`[pipeline] stage "${stageId}": assigned MCP server ${id} no longer exists`);
      continue;
    }
    mcpServers.push({ name: server.name, transport: server.transport });
  }
  return { skills, mcpServers };
}

/**
 * Template context for stage prompts: the request plus every prior stage's
 * (truncated) output, so templates can reference `{{stages.spec.output}}`.
 */
export function buildContext(item: WorkItem): Record<string, unknown> {
  const stages: Record<string, { output: string }> = {};
  for (const [id, result] of Object.entries(item.stages)) {
    stages[id] = { output: result.output ?? '' };
  }
  return { request: item.request, title: item.title, source: item.source, stages };
}

/**
 * The test and monitor agents self-report via marker lines. Monitor is
 * strict (missing marker = fail — an unattended health check must be
 * unambiguous); test is lenient so custom templates without the marker
 * convention still work.
 */
function checkResultMarker(stageId: PipelineStageId, text: string): string | undefined {
  if (stageId === 'monitor') {
    if (text.includes(MONITOR_FAIL_MARKER)) return 'monitor check reported FAIL';
    if (!text.includes(MONITOR_PASS_MARKER)) return 'monitor check did not report MONITOR_RESULT: PASS';
    return undefined;
  }
  if (stageId === 'test' && text.includes(TEST_FAIL_MARKER)) {
    return 'validation agent reported TEST_RESULT: FAIL';
  }
  return undefined;
}

export function truncateOutput(text: string): string {
  if (text.length <= STAGE_OUTPUT_LIMIT) return text;
  return text.slice(0, STAGE_OUTPUT_LIMIT) + '\n… [truncated; full output in history]';
}
