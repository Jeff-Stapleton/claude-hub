import { runClaudeProjectSession } from './claude.js';
import { runCursorProjectSession } from './cursor.js';
import type { AgentRunner, AgentRunnerConfig, RunProjectSessionOptions, RunProjectSessionResult } from './types.js';

export class ProviderAgentRunner implements AgentRunner {
  constructor(private readonly config: AgentRunnerConfig | (() => AgentRunnerConfig)) {}

  runProjectSession(opts: RunProjectSessionOptions): Promise<RunProjectSessionResult> {
    const config = typeof this.config === 'function' ? this.config() : this.config;
    const provider = opts.provider ?? config.defaultProvider;
    const providerConfig = config.providers[provider];

    switch (providerConfig.type) {
      case 'claude':
        return runClaudeProjectSession(providerConfig, opts);
      case 'cursor':
        return runCursorProjectSession(providerConfig, opts);
      default:
        return assertNever(providerConfig);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported provider config: ${JSON.stringify(value)}`);
}
