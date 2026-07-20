import { describe, expect, it } from 'vitest';
import {
  GitlabClient,
  MISSING_TOKEN_HINT,
  makeScrubber,
  resolveConfig,
  type FetchFn,
} from '../src/gitlabClient.js';
import type { GitRunOptions, GitRunner } from '../src/git.js';
import { makeTools } from '../src/tools.js';

const TOKEN = 'glpat-secret-token-1234';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function fakeFetch(
  responses: { status?: number; body?: unknown }[] = [{}],
): { fetchFn: FetchFn; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const queue = [...responses];
  const fetchFn: FetchFn = async (url, init) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    });
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    const status = next.status ?? 200;
    const text = next.body === undefined ? '{}' : JSON.stringify(next.body);
    return new Response(text, { status });
  };
  return { fetchFn, requests };
}

function fakeGit(): { git: GitRunner; calls: { args: string[]; opts: GitRunOptions }[] } {
  const calls: { args: string[]; opts: GitRunOptions }[] = [];
  const git: GitRunner = async (args, opts = {}) => {
    calls.push({ args, opts });
    return { stdout: '', stderr: '' };
  };
  return { git, calls };
}

function setup(overrides: { env?: Record<string, string>; responses?: { status?: number; body?: unknown }[] } = {}) {
  const config = resolveConfig({ GITLAB_TOKEN: TOKEN, ...overrides.env });
  const { fetchFn, requests } = fakeFetch(overrides.responses);
  const { git, calls } = fakeGit();
  const client = new GitlabClient(config, fetchFn);
  const tools = makeTools({ client, git, config });
  return { tools, requests, gitCalls: calls };
}

const MR_FIXTURE = {
  iid: 7,
  title: 'Add thing',
  state: 'opened',
  author: { username: 'jeff' },
  source_branch: 'feat/thing',
  target_branch: 'main',
  web_url: 'https://gitlab.com/group/proj/-/merge_requests/7',
};

describe('resolveConfig', () => {
  it('defaults to gitlab.com and strips trailing slashes', () => {
    expect(resolveConfig({ GITLAB_TOKEN: TOKEN }).baseUrl).toBe('https://gitlab.com');
    expect(
      resolveConfig({ GITLAB_TOKEN: TOKEN, GITLAB_URL: 'https://git.example.com/' }).baseUrl,
    ).toBe('https://git.example.com');
  });

  it('treats unresolved ${KEY} placeholders as unset', () => {
    const config = resolveConfig({
      GITLAB_TOKEN: '${GITLAB_TOKEN}',
      GITLAB_URL: '${GITLAB_URL}',
    });
    expect(config.token).toBeUndefined();
    expect(config.baseUrl).toBe('https://gitlab.com');
  });
});

describe('merge request tools', () => {
  it('creates an MR with PRIVATE-TOKEN header and encoded project path', async () => {
    const { tools, requests } = setup({ responses: [{ body: MR_FIXTURE }] });
    const result = await tools.gitlab_create_merge_request.handler({
      project: 'group/proj',
      sourceBranch: 'feat/thing',
      targetBranch: 'main',
      title: 'Add thing',
    });
    expect(requests[0]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests',
    );
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.headers['PRIVATE-TOKEN']).toBe(TOKEN);
    expect(JSON.parse(requests[0]!.body!)).toEqual({
      source_branch: 'feat/thing',
      target_branch: 'main',
      title: 'Add thing',
    });
    expect(result).toEqual({
      iid: 7,
      title: 'Add thing',
      state: 'opened',
      author: 'jeff',
      sourceBranch: 'feat/thing',
      targetBranch: 'main',
      webUrl: 'https://gitlab.com/group/proj/-/merge_requests/7',
    });
  });

  it('lists MRs with a state filter and trims fields', async () => {
    const { tools, requests } = setup({ responses: [{ body: [MR_FIXTURE] }] });
    const result = await tools.gitlab_list_merge_requests.handler({
      project: 'group/proj',
      state: 'opened',
    });
    expect(requests[0]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests?state=opened',
    );
    expect(result).toHaveLength(1);
    expect((result as { iid: number }[])[0]!.iid).toBe(7);
  });

  it('gets and approves an MR by iid', async () => {
    const { tools, requests } = setup({ responses: [{ body: MR_FIXTURE }] });
    await tools.gitlab_get_merge_request.handler({ project: 'group/proj', mrIid: 7 });
    await tools.gitlab_approve_merge_request.handler({ project: 'group/proj', mrIid: 7 });
    expect(requests[0]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests/7',
    );
    expect(requests[1]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests/7/approve',
    );
    expect(requests[1]!.method).toBe('POST');
  });

  it('honors GITLAB_URL for self-hosted instances', async () => {
    const { tools, requests } = setup({
      env: { GITLAB_URL: 'https://git.example.com' },
      responses: [{ body: MR_FIXTURE }],
    });
    await tools.gitlab_get_merge_request.handler({ project: 'group/proj', mrIid: 7 });
    expect(requests[0]!.url).toBe(
      'https://git.example.com/api/v4/projects/group%2Fproj/merge_requests/7',
    );
  });

  it('fails with a vault hint when the token is missing', async () => {
    const { tools } = setup({ env: { GITLAB_TOKEN: '' } });
    await expect(
      tools.gitlab_list_merge_requests.handler({ project: 'group/proj' }),
    ).rejects.toThrow(MISSING_TOKEN_HINT);
  });

  it('scrubs the token from API error messages', async () => {
    const { tools } = setup({
      responses: [{ status: 401, body: { message: `bad token ${TOKEN}` } }],
    });
    const err = await tools
      .gitlab_get_merge_request.handler({ project: 'group/proj', mrIid: 7 })
      .catch((e: Error) => e);
    expect((err as Error).message).toContain('401');
    expect((err as Error).message).not.toContain(TOKEN);
    expect((err as Error).message).toContain('***');
  });
});

describe('git tools', () => {
  it('clones with a clean URL and passes the token for header injection', async () => {
    const { tools, gitCalls } = setup();
    await tools.gitlab_clone_repo.handler({
      project: 'group/proj',
      destination: '/tmp/proj',
    });
    expect(gitCalls[0]!.args).toEqual(['clone', 'https://gitlab.com/group/proj.git', '/tmp/proj']);
    expect(gitCalls[0]!.opts.token).toBe(TOKEN);
    // Token never appears in argv itself — only via opts for header injection.
    expect(gitCalls[0]!.args.join(' ')).not.toContain(TOKEN);
  });

  it('rejects clone URLs with embedded credentials', async () => {
    const { tools } = setup();
    await expect(
      tools.gitlab_clone_repo.handler({
        project: `https://oauth2:${TOKEN}@gitlab.com/group/proj.git`,
        destination: '/tmp/proj',
      }),
    ).rejects.toThrow(/Do not embed credentials/);
  });

  it('creates a local branch without needing a token', async () => {
    const { tools, gitCalls } = setup({ env: { GITLAB_TOKEN: '' } });
    const result = await tools.gitlab_create_branch.handler({
      repoDir: '/tmp/proj',
      branch: 'feat/x',
      ref: 'main',
    });
    expect(gitCalls[0]!.args).toEqual(['switch', '-c', 'feat/x', 'main']);
    expect(gitCalls[0]!.opts).toEqual({ cwd: '/tmp/proj' });
    expect(result).toContain('feat/x');
  });

  it('pushes with upstream by default and honors setUpstream: false', async () => {
    const { tools, gitCalls } = setup();
    await tools.gitlab_push_branch.handler({ repoDir: '/tmp/proj', branch: 'feat/x' });
    expect(gitCalls[0]!.args).toEqual(['push', '-u', 'origin', 'feat/x']);
    expect(gitCalls[0]!.opts.cwd).toBe('/tmp/proj');
    expect(gitCalls[0]!.opts.token).toBe(TOKEN);
    await tools.gitlab_push_branch.handler({ repoDir: '/tmp/proj', setUpstream: false });
    expect(gitCalls[1]!.args).toEqual(['push', 'origin', 'HEAD']);
  });
});

describe('makeScrubber', () => {
  it('replaces the token and its basic-auth form with ***', () => {
    const scrub = makeScrubber(TOKEN);
    const basic = Buffer.from(`oauth2:${TOKEN}`).toString('base64');
    expect(scrub(`before ${TOKEN} after ${basic} end`)).toBe('before *** after *** end');
  });

  it('is a no-op without a token', () => {
    expect(makeScrubber(undefined)('unchanged')).toBe('unchanged');
  });
});
