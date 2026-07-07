import type { ProjectRepo, RepoStatus, Store } from '@claude-hub/core';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cloneRepo, createGithubRepo, initAndPush, scrubToken } from './ops.js';

/**
 * Runs repo provisioning (clone / create+push) in the background. Every
 * status transition goes through `store.update('projects', ...)`, so the
 * existing WS fat-patch broadcasts progress to the UI with no extra
 * plumbing. Per-repo work is serialized via a promise map (the Store
 * writeQueues pattern) so a retry can't race an in-flight job.
 */
export class GitJobRunner {
  private jobs = new Map<string, Promise<void>>();

  constructor(private store: Store) {}

  /**
   * Boot recovery: statuses left in-flight by a previous process are dead —
   * no job object survives a restart — so land them on `failed` with a
   * retryable explanation (the PipelineRunner.recover() philosophy).
   */
  async recover(): Promise<void> {
    const stuck: RepoStatus[] = ['pending', 'cloning', 'creating', 'pushing'];
    const affected = this.store
      .projects()
      .some((p) => p.repos.some((r) => stuck.includes(r.status)));
    if (!affected) return;
    await this.store.update('projects', (current) =>
      current.map((p) => ({
        ...p,
        repos: p.repos.map((r) =>
          stuck.includes(r.status)
            ? { ...r, status: 'failed' as const, error: 'interrupted by server restart' }
            : r,
        ),
      })),
    );
  }

  /** Fire-and-forget provisioning; safe to call for repos already running. */
  provision(projectId: string, repoId: string): void {
    if (this.jobs.has(repoId)) return;
    const job = this.run(projectId, repoId)
      .catch(() => undefined)
      .finally(() => this.jobs.delete(repoId));
    this.jobs.set(repoId, job);
  }

  private async run(projectId: string, repoId: string): Promise<void> {
    const repo = this.findRepo(projectId, repoId);
    if (!repo || (repo.status !== 'pending' && repo.status !== 'failed')) return;

    const token = repo.credentialId
      ? this.store.gitCredentials().find((c) => c.id === repo.credentialId)?.token
      : undefined;

    try {
      if (repo.origin === 'clone') {
        if (!repo.remoteUrl) throw new Error('repo has no remote URL to clone');
        await this.setStatus(projectId, repoId, { status: 'cloning' });
        await mkdir(dirname(repo.path), { recursive: true });
        await cloneRepo(repo.remoteUrl, repo.path, token);
      } else if (repo.origin === 'create') {
        if (!token) throw new Error('repo creation requires a git credential');
        const project = this.store.projects().find((p) => p.id === projectId);
        if (!project) return;
        await this.setStatus(projectId, repoId, { status: 'creating' });
        // A retry after a partial run may already have the remote; reuse it.
        const remoteUrl =
          repo.remoteUrl ?? (await createGithubRepo(repo.name, token)).cloneUrl;
        await this.setStatus(projectId, repoId, { status: 'pushing', remoteUrl });
        await mkdir(repo.path, { recursive: true });
        await initAndPush(repo.path, remoteUrl, token, {
          name: project.name,
          vision: project.vision,
        });
      } else {
        return; // local repos are born ready
      }
      await this.setStatus(projectId, repoId, { status: 'ready' });
    } catch (err) {
      const message = scrubToken(err instanceof Error ? err.message : String(err), token);
      await this.setStatus(projectId, repoId, { status: 'failed', error: message });
    }
  }

  private findRepo(projectId: string, repoId: string): ProjectRepo | undefined {
    return this.store
      .projects()
      .find((p) => p.id === projectId)
      ?.repos.find((r) => r.id === repoId);
  }

  private async setStatus(
    projectId: string,
    repoId: string,
    patch: { status: RepoStatus; error?: string; remoteUrl?: string },
  ): Promise<void> {
    await this.store.update('projects', (current) =>
      current.map((p) =>
        p.id !== projectId
          ? p
          : {
              ...p,
              repos: p.repos.map((r) => {
                if (r.id !== repoId) return r;
                const next: ProjectRepo = { ...r, status: patch.status };
                // A fresh transition invalidates any stale failure message.
                delete next.error;
                if (patch.error !== undefined) next.error = patch.error;
                if (patch.remoteUrl !== undefined) next.remoteUrl = patch.remoteUrl;
                return next;
              }),
            },
      ),
    );
  }
}
