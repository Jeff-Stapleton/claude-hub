/**
 * Thin GitLab REST v4 client used by the MCP tool handlers. Config is read
 * from the environment the hub injects into the stdio transport:
 *   GITLAB_TOKEN — personal access token from the hub vault (requiredEnv)
 *   GITLAB_URL   — optional base URL for self-hosted GitLab
 */

export interface GitlabConfig {
  baseUrl: string;
  token: string | undefined;
}

export const MISSING_TOKEN_HINT =
  'GITLAB_TOKEN is not set — add it in the hub vault (Workshop → Vault) and re-run.';

/** An unresolved `${KEY}` placeholder means the vault key was never set —
 * `resolveTransportSecrets` deliberately leaves it untouched. */
const PLACEHOLDER_PATTERN = /^\$\{[A-Z][A-Z0-9_]*\}$/;

export function resolveConfig(env: Record<string, string | undefined> = process.env): GitlabConfig {
  const rawUrl = env['GITLAB_URL'];
  const url =
    rawUrl && rawUrl.trim().length > 0 && !PLACEHOLDER_PATTERN.test(rawUrl.trim())
      ? rawUrl.trim()
      : 'https://gitlab.com';
  const rawToken = env['GITLAB_TOKEN'];
  const token =
    rawToken && rawToken.trim().length > 0 && !PLACEHOLDER_PATTERN.test(rawToken.trim())
      ? rawToken.trim()
      : undefined;
  return { baseUrl: url.replace(/\/+$/, ''), token };
}

/** Replaces the token (and its base64 `oauth2:` basic-auth form) with `***`
 * in any text that leaves the process — tool results and thrown errors. */
export function makeScrubber(token: string | undefined): (text: string) => string {
  if (!token) return (text) => text;
  const basic = Buffer.from(`oauth2:${token}`).toString('base64');
  return (text) => text.split(token).join('***').split(basic).join('***');
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class GitlabClient {
  readonly baseUrl: string;
  readonly scrub: (text: string) => string;
  private readonly token: string | undefined;
  private readonly fetchFn: FetchFn;

  constructor(config: GitlabConfig, fetchFn: FetchFn = fetch) {
    this.baseUrl = config.baseUrl;
    this.token = config.token;
    this.scrub = makeScrubber(config.token);
    this.fetchFn = fetchFn;
  }

  /** Percent-encodes a `group/subgroup/project` path for use as `:id`. */
  encodeProject(project: string): string {
    return encodeURIComponent(project);
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) throw new Error(MISSING_TOKEN_HINT);
    const res = await this.fetchFn(`${this.baseUrl}/api/v4${path}`, {
      method,
      headers: {
        'PRIVATE-TOKEN': this.token,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        this.scrub(`GitLab API ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`),
      );
    }
    if (text.length === 0) return undefined as T;
    return JSON.parse(text) as T;
  }
}
