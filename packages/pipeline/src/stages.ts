import type { AgentRunner, RunToolAssignments } from '@claude-hub/agent-runner';
import {
  render,
  type AgentProviderId,
  type McpTransport,
  type PipelineMachine,
  type Project,
  type Store,
  type WorkItem,
} from '@claude-hub/core';
import { runCommands } from './commands.js';
import {
  LEGACY_FAIL_MARKERS,
  LEGACY_PASS_MARKERS,
  MACHINE_FAIL_MARKER,
  MACHINE_PASS_MARKER,
  findMachineTemplate,
} from './defaults.js';

/** Live WorkItem stage output cap; full text goes to JSONL history. */
export const STAGE_OUTPUT_LIMIT = 32_000;

export interface ExecuteStageDeps {
  store: Store;
  agentRunner: AgentRunner;
  /** Fallback when the machine config has no timeoutMs. */
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
 * Executes one machine of a work item: an agent run (templated), then the
 * machine's shell commands, if any. Both must succeed. A machine configured
 * with commands but no prompt template (own or via its template) runs
 * commands only.
 *
 * Pure with respect to the store — the caller persists all state changes.
 */
export async function executeMachine(
  deps: ExecuteStageDeps,
  item: WorkItem,
  machine: PipelineMachine,
  machines: readonly PipelineMachine[],
  project: Project,
): Promise<ExecuteStageResult> {
  const projectPath = project.path;
  const timeoutMs =
    machine.timeoutMs ?? deps.defaultTimeoutMs ?? deps.store.config().triggerTimeoutMs;
  const hasCommands = (machine.commands?.length ?? 0) > 0;
  const template =
    machine.promptTemplate ?? findMachineTemplate(deps.store, machine.templateId)?.promptTemplate;
  if (template === undefined && !hasCommands) {
    return {
      ok: false,
      output: '',
      error: `machine "${machine.key}" has no prompt template and no commands`,
    };
  }
  // Commands-only machines skip the agent run.
  const runAgent = template !== undefined;

  const outputs: string[] = [];
  let prompt: string | undefined;
  let session: ExecuteStageResult['session'];
  const tools = resolveToolAssignments(deps.store, machine, project);

  if (runAgent) {
    const rendered = render(template, buildContext(item, machine, machines));
    prompt = buildProjectPreamble(project) + rendered;
    const provider = machine.provider ?? deps.store.config().defaultProvider;
    const sessionId = item.sessions?.[provider];

    const result = await deps.agentRunner.runProjectSession({
      provider,
      cwd: projectPath,
      prompt,
      ...(sessionId !== undefined ? { sessionId } : {}),
      timeoutMs,
      tools,
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

    const markerError = checkResultMarker(machine.resultCheck, result.text);
    if (markerError) {
      return { ok: false, output: outputs.join('\n\n'), prompt, error: markerError, session };
    }
  }

  if (hasCommands) {
    const cmdResult = await runCommands(machine.commands ?? [], {
      cwd: projectPath,
      timeoutMs,
      ...(tools.env !== undefined ? { env: tools.env } : {}),
    });
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
 * Project name/vision/context rendered ahead of every machine prompt so each
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
 * The slice of a machine (or project-monitor check) that tool resolution
 * needs; `key` is only used to label warnings.
 */
export interface ToolAssignmentOwner {
  key: string;
  skills?: string[];
  mcpServers?: string[];
  requiredEnv?: string[];
}

/**
 * Resolves toolbox assignments (ids) to full definitions for the agent
 * runner: the union of project-level assignments (shared by every machine
 * in the lane) and the machine's own. Always returns a payload —
 * present-but-empty keeps runs deny-by-default (strict MCP config). Ids
 * whose tool has since been deleted are dropped with a warning rather than
 * failing the machine.
 *
 * The machine's own requiredEnv (its "variables") joins the assigned tools'
 * required keys, so those vault values reach the run env too.
 */
export function resolveToolAssignments(
  store: Store,
  machine: ToolAssignmentOwner,
  project: Project,
): RunToolAssignments {
  const toolbox = store.toolbox();
  const skillIds = [...new Set([...(project.skills ?? []), ...(machine.skills ?? [])])];
  const serverIds = [...new Set([...(project.mcpServers ?? []), ...(machine.mcpServers ?? [])])];
  const skills: RunToolAssignments['skills'] = [];
  const requiredKeys = new Set<string>(machine.requiredEnv ?? []);
  for (const id of skillIds) {
    const skill = toolbox.skills.find((s) => s.id === id);
    if (!skill) {
      console.warn(`[pipeline] machine "${machine.key}": assigned skill ${id} no longer exists`);
      continue;
    }
    for (const key of skill.requiredEnv ?? []) requiredKeys.add(key);
    skills.push({ name: skill.name, description: skill.description, body: skill.body });
  }
  const servers: { name: string; transport: McpTransport; requiredEnv: string[] }[] = [];
  for (const id of serverIds) {
    const server = toolbox.mcpServers.find((m) => m.id === id);
    if (!server) {
      console.warn(
        `[pipeline] machine "${machine.key}": assigned MCP server ${id} no longer exists`,
      );
      continue;
    }
    for (const key of server.requiredEnv ?? []) requiredKeys.add(key);
    servers.push({
      name: server.name,
      transport: server.transport,
      requiredEnv: server.requiredEnv ?? [],
    });
  }

  // Vault values for the required keys only — an unassigned tool's secrets
  // never reach the run. Unset keys warn but don't fail the machine: the
  // vault lamp is the pre-run signal, and a hard fail would punish optional
  // integrations.
  const env: Record<string, string> = {};
  const vault = store.vault();
  for (const key of requiredKeys) {
    const entry = vault.find((e) => e.key === key);
    if (entry?.value == null) {
      console.warn(
        `[pipeline] machine "${machine.key}": required vault key ${key} is ` +
          `${entry ? 'unset' : 'missing'} — run continues without it`,
      );
      continue;
    }
    env[key] = entry.value;
  }

  const mcpServers: RunToolAssignments['mcpServers'] = servers.map((s) => ({
    name: s.name,
    transport: resolveTransportSecrets(s.transport, s.requiredEnv, env),
  }));
  return { skills, mcpServers, ...(Object.keys(env).length > 0 ? { env } : {}) };
}

/**
 * Resolves a server's transport against vault values: required keys are
 * injected into stdio env (stored literal env wins as an override), and
 * `${KEY}` placeholders in stdio env values / http header values are
 * substituted for keys the server declared in requiredEnv. Unset keys leave
 * placeholders untouched so failures are visible in the run, not silent.
 */
export function resolveTransportSecrets(
  transport: McpTransport,
  requiredEnv: string[],
  vaultValues: Record<string, string>,
): McpTransport {
  const substitute = (value: string): string =>
    value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (match, key: string) =>
      requiredEnv.includes(key) && vaultValues[key] !== undefined ? vaultValues[key] : match,
    );
  if (transport.type === 'stdio') {
    const env: Record<string, string> = {};
    for (const key of requiredEnv) {
      const value = vaultValues[key];
      if (value !== undefined) env[key] = value;
    }
    for (const [key, value] of Object.entries(transport.env ?? {})) {
      env[key] = substitute(value);
    }
    return {
      type: 'stdio',
      command: transport.command,
      ...(transport.args !== undefined ? { args: transport.args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }
  const headers = Object.fromEntries(
    Object.entries(transport.headers ?? {}).map(([name, value]) => [name, substitute(value)]),
  );
  return {
    type: 'http',
    url: transport.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

/**
 * Template context for machine prompts: the request, every recorded
 * machine's (truncated) output keyed by machine key
 * (`{{stages.<key>.output}}`), and `previous` — the nearest preceding
 * machine in line order with a non-empty recorded output, so a
 * commands-only machine in between doesn't blank the context.
 */
export function buildContext(
  item: WorkItem,
  machine: PipelineMachine,
  machines: readonly PipelineMachine[],
): Record<string, unknown> {
  const stages: Record<string, { output: string }> = {};
  for (const [key, result] of Object.entries(item.stages)) {
    stages[key] = { output: result.output ?? '' };
  }
  const idx = machines.findIndex((m) => m.key === machine.key);
  let previous = { output: '' };
  for (let i = idx - 1; i >= 0; i--) {
    const out = item.stages[machines[i]!.key]?.output;
    if (out) {
      previous = { output: out };
      break;
    }
  }
  return { request: item.request, title: item.title, source: item.source, stages, previous };
}

/**
 * resultCheck machines self-report via marker lines. 'strict' requires an
 * explicit PASS (an unattended health check must be unambiguous); 'lenient'
 * fails only on an explicit FAIL, so custom templates without the marker
 * convention still work. Legacy TEST_RESULT/MONITOR_RESULT markers are
 * honored for prompts migrated from pre-v7 stores.
 */
export function checkResultMarker(
  mode: 'strict' | 'lenient' | undefined,
  text: string,
): string | undefined {
  if (!mode) return undefined;
  const failed =
    text.includes(MACHINE_FAIL_MARKER) || LEGACY_FAIL_MARKERS.some((m) => text.includes(m));
  if (failed) return `machine reported ${MACHINE_FAIL_MARKER}`;
  if (mode === 'strict') {
    const passed =
      text.includes(MACHINE_PASS_MARKER) || LEGACY_PASS_MARKERS.some((m) => text.includes(m));
    if (!passed) return `machine did not report ${MACHINE_PASS_MARKER}`;
  }
  return undefined;
}

export function truncateOutput(text: string): string {
  if (text.length <= STAGE_OUTPUT_LIMIT) return text;
  return text.slice(0, STAGE_OUTPUT_LIMIT) + '\n… [truncated; full output in history]';
}
