import { z } from 'zod';
import { GitlabClient, type GitlabConfig } from './gitlabClient.js';
import type { GitRunner } from './git.js';

/**
 * MCP tool handlers for basic IC git workflows on GitLab. Local operations
 * (clone, branch, push) go through the git CLI with per-invocation token
 * injection; merge-request operations go through the GitLab REST v4 API.
 */

export interface ToolContext {
  client: GitlabClient;
  git: GitRunner;
  config: GitlabConfig;
}

interface MergeRequestSummary {
  iid: number;
  title: string;
  state: string;
  author: string | undefined;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
}

function summarizeMr(mr: Record<string, unknown>): MergeRequestSummary {
  return {
    iid: mr['iid'] as number,
    title: mr['title'] as string,
    state: mr['state'] as string,
    author: (mr['author'] as { username?: string } | null)?.username,
    sourceBranch: mr['source_branch'] as string,
    targetBranch: mr['target_branch'] as string,
    webUrl: mr['web_url'] as string,
  };
}

export function makeTools(ctx: ToolContext) {
  /** Builds a clean HTTPS clone URL (no embedded credentials). */
  const cloneUrl = (project: string): string => {
    if (/^https?:\/\//.test(project)) {
      const url = new URL(project);
      if (url.username || url.password) {
        throw new Error(
          'Do not embed credentials in the project URL — the token from GITLAB_TOKEN is injected automatically.',
        );
      }
      return url.toString();
    }
    return `${ctx.client.baseUrl}/${project.replace(/^\/+|\.git$/g, '')}.git`;
  };

  const gitAuth = ctx.config.token !== undefined ? { token: ctx.config.token } : {};

  return {
    gitlab_clone_repo: {
      description:
        'Clone a GitLab repository over HTTPS using the vault token. Accepts a project path like "group/project" (resolved against the configured GitLab host) or a full https URL.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or https clone URL.'),
          destination: z.string().describe('Directory to clone into.'),
          branch: z.string().optional().describe('Branch to check out after cloning.'),
        })
        .strict(),
      handler: async (args: { project: string; destination: string; branch?: string }) => {
        const cmd = ['clone'];
        if (args.branch) cmd.push('--branch', args.branch);
        cmd.push(cloneUrl(args.project), args.destination);
        const result = await ctx.git(cmd, gitAuth);
        return `Cloned into ${args.destination}\n${result.stderr}`.trim();
      },
    },

    gitlab_create_branch: {
      description:
        'Create and switch to a new local branch in a cloned repository (git switch -c). Push it later with gitlab_push_branch.',
      input: z
        .object({
          repoDir: z.string().describe('Path to the cloned repository.'),
          branch: z.string().describe('Name of the branch to create.'),
          ref: z.string().optional().describe('Start point (commit, branch, or tag); defaults to HEAD.'),
        })
        .strict(),
      handler: async (args: { repoDir: string; branch: string; ref?: string }) => {
        const cmd = ['switch', '-c', args.branch];
        if (args.ref) cmd.push(args.ref);
        await ctx.git(cmd, { cwd: args.repoDir });
        return `Created and switched to branch ${args.branch}`;
      },
    },

    gitlab_push_branch: {
      description:
        'Push a branch to origin using the vault token. Sets the upstream by default so subsequent pushes are plain `git push`.',
      input: z
        .object({
          repoDir: z.string().describe('Path to the cloned repository.'),
          branch: z.string().optional().describe('Branch to push; defaults to the current HEAD.'),
          setUpstream: z.boolean().optional().describe('Pass -u to set the upstream (default true).'),
        })
        .strict(),
      handler: async (args: { repoDir: string; branch?: string; setUpstream?: boolean }) => {
        const cmd = ['push'];
        if (args.setUpstream !== false) cmd.push('-u');
        cmd.push('origin', args.branch ?? 'HEAD');
        const result = await ctx.git(cmd, { cwd: args.repoDir, ...gitAuth });
        return `Pushed ${args.branch ?? 'HEAD'} to origin\n${result.stderr}`.trim();
      },
    },

    gitlab_create_merge_request: {
      description: 'Open a merge request on a GitLab project.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          sourceBranch: z.string(),
          targetBranch: z.string(),
          title: z.string(),
          description: z.string().optional(),
        })
        .strict(),
      handler: async (args: {
        project: string;
        sourceBranch: string;
        targetBranch: string;
        title: string;
        description?: string;
      }) => {
        const mr = await ctx.client.request<Record<string, unknown>>(
          'POST',
          `/projects/${ctx.client.encodeProject(args.project)}/merge_requests`,
          {
            source_branch: args.sourceBranch,
            target_branch: args.targetBranch,
            title: args.title,
            ...(args.description !== undefined ? { description: args.description } : {}),
          },
        );
        return summarizeMr(mr);
      },
    },

    gitlab_list_merge_requests: {
      description: 'List merge requests on a GitLab project, optionally filtered by state.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          state: z.enum(['opened', 'closed', 'merged', 'all']).optional(),
        })
        .strict(),
      handler: async (args: { project: string; state?: 'opened' | 'closed' | 'merged' | 'all' }) => {
        const query = args.state ? `?state=${args.state}` : '';
        const mrs = await ctx.client.request<Record<string, unknown>[]>(
          'GET',
          `/projects/${ctx.client.encodeProject(args.project)}/merge_requests${query}`,
        );
        return mrs.map(summarizeMr);
      },
    },

    gitlab_get_merge_request: {
      description: 'Fetch a single merge request (full details) by its iid.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          mrIid: z.number().int().describe('The merge request iid (project-scoped number).'),
        })
        .strict(),
      handler: async (args: { project: string; mrIid: number }) =>
        ctx.client.request(
          'GET',
          `/projects/${ctx.client.encodeProject(args.project)}/merge_requests/${args.mrIid}`,
        ),
    },

    gitlab_approve_merge_request: {
      description: 'Approve a merge request by its iid.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          mrIid: z.number().int().describe('The merge request iid (project-scoped number).'),
        })
        .strict(),
      handler: async (args: { project: string; mrIid: number }) => {
        await ctx.client.request(
          'POST',
          `/projects/${ctx.client.encodeProject(args.project)}/merge_requests/${args.mrIid}/approve`,
        );
        return `Approved merge request !${args.mrIid}`;
      },
    },
  };
}
