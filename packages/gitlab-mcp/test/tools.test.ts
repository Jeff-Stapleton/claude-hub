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
  responses: { status?: number; body?: unknown; text?: string }[] = [{}],
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
    const text = next.text ?? (next.body === undefined ? '{}' : JSON.stringify(next.body));
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

describe('MR discussion tools', () => {
  const DISCUSSION_FIXTURE = [
    {
      id: 'abc123',
      individual_note: false,
      notes: [
        {
          id: 11,
          body: 'Please rename this variable',
          system: false,
          resolvable: true,
          resolved: false,
          author: { username: 'reviewer' },
          position: { new_path: 'src/app.ts', new_line: 42 },
        },
        {
          id: 12,
          body: 'added 1 commit',
          system: true,
          resolvable: false,
          author: { username: 'bot' },
        },
      ],
    },
    {
      id: 'sysonly',
      individual_note: true,
      notes: [
        { id: 13, body: 'changed the description', system: true, resolvable: false },
      ],
    },
  ];

  it('lists discussions, filters system notes, and extracts file positions', async () => {
    const { tools, requests } = setup({ responses: [{ body: DISCUSSION_FIXTURE }] });
    const result = await tools.gitlab_list_mr_discussions.handler({
      project: 'group/proj',
      mrIid: 7,
    });
    expect(requests[0]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests/7/discussions?per_page=100',
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'abc123', resolvable: true, resolved: false });
    expect(result[0]!.notes).toEqual([
      {
        id: 11,
        author: 'reviewer',
        body: 'Please rename this variable',
        resolvable: true,
        resolved: false,
        filePath: 'src/app.ts',
        line: 42,
      },
    ]);
  });

  it('keeps system notes when includeSystem is set', async () => {
    const { tools } = setup({ responses: [{ body: DISCUSSION_FIXTURE }] });
    const result = await tools.gitlab_list_mr_discussions.handler({
      project: 'group/proj',
      mrIid: 7,
      includeSystem: true,
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.notes).toHaveLength(2);
  });

  it('truncates long note bodies', async () => {
    const long = 'x'.repeat(3000);
    const fixture = [
      {
        id: 'd1',
        individual_note: true,
        notes: [{ id: 1, body: long, system: false, resolvable: true, resolved: false }],
      },
    ];
    const { tools } = setup({ responses: [{ body: fixture }] });
    const result = await tools.gitlab_list_mr_discussions.handler({
      project: 'group/proj',
      mrIid: 7,
    });
    expect(result[0]!.notes[0]!.body.length).toBeLessThan(2100);
    expect(result[0]!.notes[0]!.body).toContain('[… truncated]');
  });

  it('replies to a discussion vs posting a general comment', async () => {
    const { tools, requests } = setup({ responses: [{ body: { id: 99 } }] });
    await tools.gitlab_comment_merge_request.handler({
      project: 'group/proj',
      mrIid: 7,
      body: 'Fixed in latest push',
      discussionId: 'abc123',
    });
    await tools.gitlab_comment_merge_request.handler({
      project: 'group/proj',
      mrIid: 7,
      body: 'General note',
    });
    expect(requests[0]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests/7/discussions/abc123/notes',
    );
    expect(requests[0]!.method).toBe('POST');
    expect(JSON.parse(requests[0]!.body!)).toEqual({ body: 'Fixed in latest push' });
    expect(requests[1]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests/7/notes',
    );
  });

  it('resolves a discussion (default true)', async () => {
    const { tools, requests } = setup({ responses: [{ body: { id: 'abc123' } }] });
    const result = await tools.gitlab_resolve_mr_discussion.handler({
      project: 'group/proj',
      mrIid: 7,
      discussionId: 'abc123',
    });
    expect(requests[0]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests/7/discussions/abc123',
    );
    expect(requests[0]!.method).toBe('PUT');
    expect(JSON.parse(requests[0]!.body!)).toEqual({ resolved: true });
    expect(result).toContain('Resolved discussion abc123');
  });
});

describe('CI pipeline tools', () => {
  it('lists MR pipelines with trimmed fields', async () => {
    const { tools, requests } = setup({
      responses: [
        {
          body: [
            {
              id: 501,
              status: 'failed',
              sha: 'deadbeef',
              web_url: 'https://gitlab.com/group/proj/-/pipelines/501',
              created_at: '2026-07-20T10:00:00Z',
            },
          ],
        },
      ],
    });
    const result = await tools.gitlab_list_mr_pipelines.handler({ project: 'group/proj', mrIid: 7 });
    expect(requests[0]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests/7/pipelines',
    );
    expect(result).toEqual([
      {
        id: 501,
        status: 'failed',
        sha: 'deadbeef',
        webUrl: 'https://gitlab.com/group/proj/-/pipelines/501',
        createdAt: '2026-07-20T10:00:00Z',
      },
    ]);
  });

  it('lists pipeline jobs with a scope filter', async () => {
    const { tools, requests } = setup({
      responses: [
        {
          body: [
            {
              id: 9001,
              name: 'unit-tests',
              stage: 'test',
              status: 'failed',
              allow_failure: false,
              web_url: 'https://gitlab.com/group/proj/-/jobs/9001',
            },
          ],
        },
      ],
    });
    const result = await tools.gitlab_get_pipeline_jobs.handler({
      project: 'group/proj',
      pipelineId: 501,
      scope: 'failed',
    });
    expect(requests[0]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/pipelines/501/jobs?scope[]=failed',
    );
    expect(result).toEqual([
      {
        id: 9001,
        name: 'unit-tests',
        stage: 'test',
        status: 'failed',
        allowFailure: false,
        webUrl: 'https://gitlab.com/group/proj/-/jobs/9001',
      },
    ]);
  });

  it('tails the job log and marks truncation', async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);
    const { tools, requests } = setup({ responses: [{ text: lines.join('\n') }] });
    const result = await tools.gitlab_get_job_log.handler({
      project: 'group/proj',
      jobId: 9001,
      tailLines: 100,
    });
    expect(requests[0]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/jobs/9001/trace',
    );
    expect(result).toContain('[… trace truncated: showing last 100 of 500 lines]');
    expect(result).toContain('line 500');
    expect(result).not.toContain('line 400\n');
  });

  it('returns short logs untouched and scrubs tokens from traces', async () => {
    const { tools } = setup({ responses: [{ text: `building with ${TOKEN}\ndone` }] });
    const result = await tools.gitlab_get_job_log.handler({ project: 'group/proj', jobId: 9001 });
    expect(result).toBe('building with ***\ndone');
  });
});

describe('merge and rebase tools', () => {
  it('merges an MR and summarizes the result', async () => {
    const { tools, requests } = setup({
      responses: [{ body: { ...MR_FIXTURE, state: 'merged' } }],
    });
    const result = await tools.gitlab_merge_merge_request.handler({
      project: 'group/proj',
      mrIid: 7,
      squash: true,
      removeSourceBranch: true,
    });
    expect(requests[0]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests/7/merge',
    );
    expect(requests[0]!.method).toBe('PUT');
    expect(JSON.parse(requests[0]!.body!)).toEqual({
      squash: true,
      should_remove_source_branch: true,
    });
    expect(result).toMatchObject({ iid: 7, state: 'merged' });
  });

  it('reports armed auto-merge when MWPS is set and the MR stays open', async () => {
    const { tools, requests } = setup({ responses: [{ body: MR_FIXTURE }] });
    const result = await tools.gitlab_merge_merge_request.handler({
      project: 'group/proj',
      mrIid: 7,
      mergeWhenPipelineSucceeds: true,
    });
    expect(JSON.parse(requests[0]!.body!)).toEqual({ merge_when_pipeline_succeeds: true });
    expect(result).toContain('Auto-merge armed');
  });

  it('adds a readable hint on 405 (not mergeable)', async () => {
    const { tools } = setup({ responses: [{ status: 405, body: { message: 'Method Not Allowed' } }] });
    await expect(
      tools.gitlab_merge_merge_request.handler({ project: 'group/proj', mrIid: 7 }),
    ).rejects.toThrow(/not mergeable yet/);
  });

  it('adds a readable hint on 406 (diverged)', async () => {
    const { tools } = setup({ responses: [{ status: 406, body: { message: 'Branch cannot be merged' } }] });
    await expect(
      tools.gitlab_merge_merge_request.handler({ project: 'group/proj', mrIid: 7 }),
    ).rejects.toThrow(/rebase first/);
  });

  it('starts a rebase', async () => {
    const { tools, requests } = setup({ responses: [{ status: 202, body: { rebase_in_progress: true } }] });
    const result = await tools.gitlab_rebase_merge_request.handler({ project: 'group/proj', mrIid: 7 });
    expect(requests[0]!.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests/7/rebase',
    );
    expect(requests[0]!.method).toBe('PUT');
    expect(result).toContain('Rebase of !7 started');
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
