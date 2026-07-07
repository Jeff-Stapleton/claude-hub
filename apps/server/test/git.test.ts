import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HubPaths, Store, type Project } from '@claude-hub/core';
import { GitJobRunner } from '../src/git/jobs.js';
import { scrubToken } from '../src/git/ops.js';
import { registerGitRoutes } from '../src/routes/git.js';

/**
 * Drives GitJobRunner against a fake `git` on PATH (the repo's fake-CLI
 * unit-test convention): `git clone <url> <dest>` mkdirs dest, unless the
 * url contains "fail-me", in which case it echoes stderr (including any
 * auth header it was given, to prove scrubbing) and exits 1.
 */
const FAKE_GIT = `#!/bin/sh
url=""
for a in "$@"; do
  case "$a" in
    *fail-me*) echo "fatal: could not read from '$a' using $*" >&2; exit 1 ;;
  esac
done
if [ "$1" = "-c" ]; then shift 2; fi
if [ "$1" = "clone" ]; then mkdir -p "$3"; exit 0; fi
exit 0
`;

describe('GitJobRunner', () => {
  let root: string;
  let store: Store;
  let jobs: GitJobRunner;
  let savedPath: string | undefined;

  const seedProject = async (repoOverrides: Partial<Project['repos'][number]>): Promise<void> => {
    await store.update('projects', [
      {
        id: 'p1',
        path: join(root, 'proj'),
        name: 'proj',
        vision: 'v',
        repos: [
          {
            id: 'r1',
            name: 'repo',
            path: join(root, 'proj', 'repo'),
            origin: 'clone',
            remoteUrl: 'https://example.com/ok/repo.git',
            status: 'pending',
            addedAt: new Date().toISOString(),
            ...repoOverrides,
          },
        ],
        addedAt: new Date().toISOString(),
      },
    ]);
  };

  const waitForTerminal = async (): Promise<Project['repos'][number]> => {
    for (let i = 0; i < 200; i++) {
      const repo = store.projects()[0]!.repos[0]!;
      if (repo.status === 'ready' || repo.status === 'failed') return repo;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('repo never reached a terminal status');
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'git-jobs-'));
    const bin = join(root, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'git'), FAKE_GIT, 'utf8');
    await chmod(join(bin, 'git'), 0o755);
    savedPath = process.env.PATH;
    process.env.PATH = `${bin}:${savedPath ?? ''}`;

    store = new Store(new HubPaths(join(root, 'hub')));
    await store.load();
    jobs = new GitJobRunner(store);
  });

  afterEach(async () => {
    process.env.PATH = savedPath;
    await rm(root, { recursive: true, force: true });
  });

  it('drives a clone from pending -> ready', async () => {
    await seedProject({});
    jobs.provision('p1', 'r1');
    const repo = await waitForTerminal();
    expect(repo.status).toBe('ready');
    expect(repo.error).toBeUndefined();
  });

  it('lands a failing clone on failed with a token-scrubbed error', async () => {
    await store.update('gitCredentials', [
      {
        id: 'cred-1',
        name: 'gh',
        provider: 'github',
        token: 'supersecrettoken',
        createdAt: new Date().toISOString(),
      },
    ]);
    await seedProject({
      remoteUrl: 'https://example.com/fail-me/repo.git',
      credentialId: 'cred-1',
    });
    jobs.provision('p1', 'r1');
    const repo = await waitForTerminal();
    expect(repo.status).toBe('failed');
    expect(repo.error).toBeTruthy();
    // The fake git echoes its full argv (auth header included) to stderr;
    // the stored error must never contain the raw token.
    expect(repo.error).not.toContain('supersecrettoken');
  });

  it('recover() lands in-flight repos on failed with a retryable message', async () => {
    await seedProject({ status: 'cloning' });
    await jobs.recover();
    const repo = store.projects()[0]!.repos[0]!;
    expect(repo.status).toBe('failed');
    expect(repo.error).toMatch(/interrupted by server restart/);
  });

  it('recover() leaves ready and failed repos alone', async () => {
    await seedProject({ status: 'ready' });
    await jobs.recover();
    expect(store.projects()[0]!.repos[0]!.status).toBe('ready');
  });
});

describe('git credential routes', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'git-creds-'));
    store = new Store(new HubPaths(root));
    await store.load();
    app = Fastify();
    await registerGitRoutes(app, store);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('POST /api/git/credentials stores the token but never returns it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/git/credentials',
      payload: { name: 'gh', token: 'GHP_SECRET' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ name: 'gh', provider: 'github', tokenSet: true });
    expect(res.body).not.toContain('GHP_SECRET');
    expect(store.gitCredentials()[0]!.token).toBe('GHP_SECRET');

    const list = await app.inject({ method: 'GET', url: '/api/git/credentials' });
    expect(list.body).not.toContain('GHP_SECRET');
  });

  it('POST /api/git/credentials rejects a duplicate name', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/git/credentials',
      payload: { name: 'gh', token: 't1' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/git/credentials',
      payload: { name: 'gh', token: 't2' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /api/git/credentials/:id scrubs credentialId from repos', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/git/credentials',
      payload: { name: 'gh', token: 't' },
    });
    const credId = JSON.parse(create.body).id;
    await store.update('projects', [
      {
        id: 'p1',
        path: '/tmp/p',
        name: 'p',
        vision: '',
        repos: [
          {
            id: 'r1',
            name: 'r',
            path: '/tmp/p/r',
            origin: 'clone',
            remoteUrl: 'https://x/y.git',
            credentialId: credId,
            status: 'ready',
            addedAt: new Date().toISOString(),
          },
        ],
        addedAt: new Date().toISOString(),
      },
    ]);

    const res = await app.inject({ method: 'DELETE', url: `/api/git/credentials/${credId}` });
    expect(res.statusCode).toBe(200);
    expect(store.gitCredentials()).toHaveLength(0);
    expect(store.projects()[0]!.repos[0]!.credentialId).toBeUndefined();
  });

  it('POST /api/git/inspect-path rejects relative paths', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/git/inspect-path',
      payload: { path: 'not-absolute' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/git/inspect-path reports a plain directory', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/git/inspect-path',
      payload: { path: root },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ exists: true, isDirectory: true });
  });

  it('POST /api/git/check-remote rejects an unknown credentialId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/git/check-remote',
      payload: { url: 'https://x/y.git', credentialId: 'nope' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('scrubToken', () => {
  it('replaces every occurrence of the token', () => {
    expect(scrubToken('Bearer abc123 then abc123 again', 'abc123')).toBe(
      'Bearer *** then *** again',
    );
  });

  it('is a no-op without a token', () => {
    expect(scrubToken('unchanged')).toBe('unchanged');
  });
});
