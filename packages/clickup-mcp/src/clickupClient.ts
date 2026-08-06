/**
 * Thin ClickUp REST v2 client used by the MCP tool handlers. Config is read
 * from the environment the hub injects into the stdio transport:
 *   CLICKUP_TOKEN   — personal API token from the hub vault (requiredEnv)
 *   CLICKUP_API_URL — optional base URL override for testing/proxies
 */

export interface ClickUpConfig {
  baseUrl: string;
  token: string | undefined;
}

export const MISSING_TOKEN_HINT =
  'CLICKUP_TOKEN is not set — add it in the hub vault (Workshop → Vault) and re-run.';

/** An unresolved `${KEY}` placeholder means the vault key was never set —
 * `resolveTransportSecrets` deliberately leaves it untouched. */
const PLACEHOLDER_PATTERN = /^\$\{[A-Z][A-Z0-9_]*\}$/;

export function resolveConfig(env: Record<string, string | undefined> = process.env): ClickUpConfig {
  const rawUrl = env['CLICKUP_API_URL'];
  const url =
    rawUrl && rawUrl.trim().length > 0 && !PLACEHOLDER_PATTERN.test(rawUrl.trim())
      ? rawUrl.trim()
      : 'https://api.clickup.com';
  const rawToken = env['CLICKUP_TOKEN'];
  const token =
    rawToken && rawToken.trim().length > 0 && !PLACEHOLDER_PATTERN.test(rawToken.trim())
      ? rawToken.trim()
      : undefined;
  return { baseUrl: url.replace(/\/+$/, ''), token };
}

/** Replaces the token with `***` in any text that leaves the process —
 * tool results and thrown errors. ClickUp takes the raw personal token in
 * the Authorization header, so there is no encoded variant to scrub. */
export function makeScrubber(token: string | undefined): (text: string) => string {
  if (!token) return (text) => text;
  return (text) => text.split(token).join('***');
}

/** Appends repeated `key[]=value` entries for ClickUp's array filters. */
export function appendArrayParam(
  params: URLSearchParams,
  key: string,
  values: string[] | undefined,
): void {
  for (const value of values ?? []) params.append(`${key}[]`, value);
}

/** ClickUp resolves custom task ids ("ABC-123") only when both
 * `custom_task_ids=true` and `team_id` are present. */
export function appendCustomTaskIdQuery(params: URLSearchParams, teamId: string | undefined): void {
  if (!teamId) return;
  params.set('custom_task_ids', 'true');
  params.set('team_id', teamId);
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class ClickUpClient {
  readonly baseUrl: string;
  readonly scrub: (text: string) => string;
  private readonly token: string | undefined;
  private readonly fetchFn: FetchFn;

  constructor(config: ClickUpConfig, fetchFn: FetchFn = fetch) {
    this.baseUrl = config.baseUrl;
    this.token = config.token;
    this.scrub = makeScrubber(config.token);
    this.fetchFn = fetchFn;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    opts: { query?: URLSearchParams; body?: unknown } = {},
  ): Promise<T> {
    if (!this.token) throw new Error(MISSING_TOKEN_HINT);
    const qs = opts.query?.toString() ?? '';
    const res = await this.fetchFn(`${this.baseUrl}/api/v2${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: {
        // ClickUp personal tokens go verbatim — no `Bearer` prefix.
        Authorization: this.token,
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        this.scrub(`ClickUp API ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`),
      );
    }
    if (text.length === 0) return undefined as T;
    return JSON.parse(text) as T;
  }
}
