import type { AgentProviderId, AgentProviderConfig, McpTransport } from '@claude-hub/core';

export type { AgentProviderConfig, AgentProviderId, McpTransport } from '@claude-hub/core';

/** A toolbox skill resolved to its full content for one run. */
export interface ResolvedSkill {
  name: string;
  description: string;
  body: string;
}

/** A toolbox MCP server resolved to its full (secret-bearing) transport. */
export interface ResolvedMcpServer {
  name: string;
  transport: McpTransport;
}

export interface RunToolAssignments {
  skills: ResolvedSkill[];
  mcpServers: ResolvedMcpServer[];
}

export interface RunProjectSessionOptions {
  /** Provider to execute. Defaults to the configured default provider. */
  provider?: AgentProviderId;
  /** Working directory for the agent session. */
  cwd: string;
  /** Prompt text passed to the provider CLI. */
  prompt: string;
  /** Provider session/chat id to resume. */
  sessionId?: string;
  /** Per-run timeout in milliseconds. */
  timeoutMs?: number;
  /** Provider-specific extra args appended before the prompt. */
  extraArgs?: string[];
  /**
   * Hub toolbox tools this run may use. Present-but-empty means deny by
   * default (claude runs get --strict-mcp-config so no ambient MCP config
   * leaks in); absent preserves legacy behavior for orchestrator/trigger
   * runs that don't participate in the toolbox.
   */
  tools?: RunToolAssignments;
}

export type RunProjectSessionResult =
  | {
      ok: true;
      provider: AgentProviderId;
      sessionId: string;
      text: string;
      durationMs: number;
      costUsd?: number;
      raw: unknown;
    }
  | {
      ok: false;
      provider: AgentProviderId;
      error: string;
      stdout?: string;
      stderr?: string;
      exitCode?: number | null;
    };

export interface AgentRunnerConfig {
  defaultProvider: AgentProviderId;
  providers: Record<AgentProviderId, AgentProviderConfig>;
}

export interface AgentRunner {
  runProjectSession(opts: RunProjectSessionOptions): Promise<RunProjectSessionResult>;
}
