/**
 * Shape emitted by `claude -p --output-format json` on success.
 *
 * We only pull the fields the runner uses; CC may add more over time and
 * we don't want strict parsing to break when it does.
 */
export interface CCResultEnvelope {
  type: 'result';
  subtype: 'success' | 'error' | string;
  is_error: boolean;
  result?: string;
  session_id?: string;
  duration_ms?: number;
  total_cost_usd?: number;
}

export interface SpawnOptions {
  /** Working directory for the CC session. */
  cwd: string;
  /** Prompt text passed as positional arg. */
  prompt: string;
  /**
   * If set, resume that session. If unset, a new session id is generated
   * server-side and returned as `sessionId` in the result.
   */
  sessionId?: string;
  /**
   * If true, bypass the interactive permission prompt. Required for any
   * unattended use (triggers, orchestrator). Default: true.
   *
   * The caller is responsible for only enabling this against trusted
   * prompts / trusted working dirs.
   */
  dangerouslySkipPermissions?: boolean;
  /**
   * Soft timeout (ms). The child is killed if it exceeds this. Default
   * 10 minutes — CC runs routinely take minutes.
   */
  timeoutMs?: number;
  /** Override the CLI binary. Defaults to `claude`. */
  claudePath?: string;
  /** Extra CLI args appended before the prompt. */
  extraArgs?: string[];
}

export type SpawnResult =
  | {
      ok: true;
      sessionId: string;
      text: string;
      durationMs: number;
      costUsd?: number;
      raw: CCResultEnvelope;
    }
  | {
      ok: false;
      error: string;
      /** Raw stdout if we got any before failure. */
      stdout?: string;
      /** Raw stderr captured from the child. */
      stderr?: string;
      exitCode?: number | null;
    };
