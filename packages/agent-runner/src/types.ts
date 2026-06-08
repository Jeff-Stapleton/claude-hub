import type { AgentProviderId, AgentProviderConfig } from '@claude-hub/core';

export type { AgentProviderConfig, AgentProviderId } from '@claude-hub/core';

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
