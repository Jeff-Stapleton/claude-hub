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

/** Reviewer note bodies can be arbitrarily long; keep tool output bounded. */
const NOTE_BODY_LIMIT = 2000;

interface GitlabNote {
  id: number;
  body: string;
  system: boolean;
  resolvable: boolean;
  resolved?: boolean;
  author?: { username?: string } | null;
  position?: { new_path?: string | null; new_line?: number | null } | null;
}

interface GitlabDiscussion {
  id: string;
  individual_note: boolean;
  notes: GitlabNote[];
}

function summarizeNote(note: GitlabNote) {
  const body =
    note.body.length > NOTE_BODY_LIMIT ? `${note.body.slice(0, NOTE_BODY_LIMIT)} [… truncated]` : note.body;
  return {
    id: note.id,
    author: note.author?.username,
    body,
    resolvable: note.resolvable,
    ...(note.resolved !== undefined ? { resolved: note.resolved } : {}),
    ...(note.position?.new_path ? { filePath: note.position.new_path } : {}),
    ...(note.position?.new_line != null ? { line: note.position.new_line } : {}),
  };
}

/** Job traces can be tens of MB; failures live at the tail. */
const TRACE_HARD_CAP = 50_000;
const TRACE_DEFAULT_TAIL_LINES = 200;
const TRACE_MAX_TAIL_LINES = 2000;

export function tailTrace(trace: string, tailLines: number): string {
  const lines = trace.split('\n');
  let out = trace;
  let shown = lines.length;
  if (lines.length > tailLines) {
    shown = tailLines;
    out = lines.slice(-tailLines).join('\n');
  }
  if (out.length > TRACE_HARD_CAP) {
    out = out.slice(-TRACE_HARD_CAP);
  }
  if (shown < lines.length || out.length < trace.length) {
    return `[… trace truncated: showing last ${shown} of ${lines.length} lines]\n${out}`;
  }
  return out;
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

    gitlab_list_mr_discussions: {
      description:
        'List discussion threads on a merge request with their notes (reviewer comments). System notes (branch pushes, label changes, …) are filtered out unless includeSystem is set.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          mrIid: z.number().int().describe('The merge request iid (project-scoped number).'),
          includeSystem: z.boolean().optional().describe('Include system-generated notes (default false).'),
        })
        .strict(),
      handler: async (args: { project: string; mrIid: number; includeSystem?: boolean }) => {
        const discussions = await ctx.client.request<GitlabDiscussion[]>(
          'GET',
          `/projects/${ctx.client.encodeProject(args.project)}/merge_requests/${args.mrIid}/discussions?per_page=100`,
        );
        return discussions
          .map((d) => {
            const notes = args.includeSystem ? d.notes : d.notes.filter((n) => !n.system);
            return {
              id: d.id,
              resolvable: notes.some((n) => n.resolvable),
              resolved: notes.filter((n) => n.resolvable).every((n) => n.resolved === true),
              notes: notes.map(summarizeNote),
            };
          })
          .filter((d) => d.notes.length > 0);
      },
    },

    gitlab_comment_merge_request: {
      description:
        'Comment on a merge request. With discussionId, replies inside that discussion thread; without it, posts a general MR comment.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          mrIid: z.number().int().describe('The merge request iid (project-scoped number).'),
          body: z.string().describe('The comment text (GitLab-flavored markdown).'),
          discussionId: z.string().optional().describe('Discussion thread to reply to.'),
        })
        .strict(),
      handler: async (args: { project: string; mrIid: number; body: string; discussionId?: string }) => {
        const base = `/projects/${ctx.client.encodeProject(args.project)}/merge_requests/${args.mrIid}`;
        const path = args.discussionId
          ? `${base}/discussions/${encodeURIComponent(args.discussionId)}/notes`
          : `${base}/notes`;
        const note = await ctx.client.request<{ id: number }>('POST', path, { body: args.body });
        return args.discussionId
          ? `Replied to discussion ${args.discussionId} on !${args.mrIid} (note ${note.id})`
          : `Commented on !${args.mrIid} (note ${note.id})`;
      },
    },

    gitlab_resolve_mr_discussion: {
      description: 'Resolve (or unresolve) a discussion thread on a merge request.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          mrIid: z.number().int().describe('The merge request iid (project-scoped number).'),
          discussionId: z.string().describe('The discussion thread id.'),
          resolved: z.boolean().optional().describe('Resolution state to set (default true).'),
        })
        .strict(),
      handler: async (args: { project: string; mrIid: number; discussionId: string; resolved?: boolean }) => {
        const resolved = args.resolved ?? true;
        await ctx.client.request(
          'PUT',
          `/projects/${ctx.client.encodeProject(args.project)}/merge_requests/${args.mrIid}/discussions/${encodeURIComponent(args.discussionId)}`,
          { resolved },
        );
        return `${resolved ? 'Resolved' : 'Unresolved'} discussion ${args.discussionId} on !${args.mrIid}`;
      },
    },

    gitlab_list_mr_pipelines: {
      description: 'List CI pipelines for a merge request, newest first.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          mrIid: z.number().int().describe('The merge request iid (project-scoped number).'),
        })
        .strict(),
      handler: async (args: { project: string; mrIid: number }) => {
        const pipelines = await ctx.client.request<Record<string, unknown>[]>(
          'GET',
          `/projects/${ctx.client.encodeProject(args.project)}/merge_requests/${args.mrIid}/pipelines`,
        );
        return pipelines.map((p) => ({
          id: p['id'] as number,
          status: p['status'] as string,
          sha: p['sha'] as string,
          webUrl: p['web_url'] as string,
          createdAt: p['created_at'] as string,
        }));
      },
    },

    gitlab_get_pipeline_jobs: {
      description: 'List the jobs of a CI pipeline, optionally filtered by status scope (e.g. "failed").',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          pipelineId: z.number().int().describe('The pipeline id (from gitlab_list_mr_pipelines).'),
          scope: z.enum(['failed', 'success', 'running', 'pending', 'canceled', 'manual']).optional(),
        })
        .strict(),
      handler: async (args: {
        project: string;
        pipelineId: number;
        scope?: 'failed' | 'success' | 'running' | 'pending' | 'canceled' | 'manual';
      }) => {
        const query = args.scope ? `?scope[]=${args.scope}` : '';
        const jobs = await ctx.client.request<Record<string, unknown>[]>(
          'GET',
          `/projects/${ctx.client.encodeProject(args.project)}/pipelines/${args.pipelineId}/jobs${query}`,
        );
        return jobs.map((j) => ({
          id: j['id'] as number,
          name: j['name'] as string,
          stage: j['stage'] as string,
          status: j['status'] as string,
          allowFailure: j['allow_failure'] as boolean,
          webUrl: j['web_url'] as string,
        }));
      },
    },

    gitlab_get_job_log: {
      description:
        'Fetch the trailing log of a CI job (the trace). Returns the last tailLines lines (default 200) — failures live at the tail.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          jobId: z.number().int().describe('The job id (from gitlab_get_pipeline_jobs).'),
          tailLines: z
            .number()
            .int()
            .min(1)
            .max(TRACE_MAX_TAIL_LINES)
            .optional()
            .describe(`Lines from the end to return (default ${TRACE_DEFAULT_TAIL_LINES}).`),
        })
        .strict(),
      handler: async (args: { project: string; jobId: number; tailLines?: number }) => {
        const trace = await ctx.client.requestText(
          'GET',
          `/projects/${ctx.client.encodeProject(args.project)}/jobs/${args.jobId}/trace`,
        );
        return tailTrace(trace, args.tailLines ?? TRACE_DEFAULT_TAIL_LINES);
      },
    },

    gitlab_merge_merge_request: {
      description:
        'Merge a merge request. With mergeWhenPipelineSucceeds, arms GitLab auto-merge instead of merging immediately.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          mrIid: z.number().int().describe('The merge request iid (project-scoped number).'),
          mergeWhenPipelineSucceeds: z
            .boolean()
            .optional()
            .describe('Arm auto-merge: GitLab merges once the pipeline succeeds.'),
          squash: z.boolean().optional().describe('Squash commits on merge.'),
          removeSourceBranch: z.boolean().optional().describe('Delete the source branch after merging.'),
          mergeCommitMessage: z.string().optional().describe('Custom merge commit message.'),
        })
        .strict(),
      handler: async (args: {
        project: string;
        mrIid: number;
        mergeWhenPipelineSucceeds?: boolean;
        squash?: boolean;
        removeSourceBranch?: boolean;
        mergeCommitMessage?: string;
      }) => {
        let mr: Record<string, unknown>;
        try {
          mr = await ctx.client.request<Record<string, unknown>>(
            'PUT',
            `/projects/${ctx.client.encodeProject(args.project)}/merge_requests/${args.mrIid}/merge`,
            {
              ...(args.mergeWhenPipelineSucceeds !== undefined
                ? { merge_when_pipeline_succeeds: args.mergeWhenPipelineSucceeds }
                : {}),
              ...(args.squash !== undefined ? { squash: args.squash } : {}),
              ...(args.removeSourceBranch !== undefined
                ? { should_remove_source_branch: args.removeSourceBranch }
                : {}),
              ...(args.mergeCommitMessage !== undefined
                ? { merge_commit_message: args.mergeCommitMessage }
                : {}),
            },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('(405)')) {
            throw new Error(
              `${message} — not mergeable yet (draft, failed pipeline, or unresolved discussions).`,
            );
          }
          if (message.includes('(406)')) {
            throw new Error(`${message} — source branch has diverged; rebase first.`);
          }
          throw err;
        }
        if (args.mergeWhenPipelineSucceeds && mr['state'] === 'opened') {
          return `Auto-merge armed on !${args.mrIid}: GitLab will merge when the pipeline succeeds.`;
        }
        return summarizeMr(mr);
      },
    },

    gitlab_rebase_merge_request: {
      description: 'Rebase the source branch of a merge request onto its target branch.',
      input: z
        .object({
          project: z.string().describe('Project path ("group/project") or numeric id.'),
          mrIid: z.number().int().describe('The merge request iid (project-scoped number).'),
        })
        .strict(),
      handler: async (args: { project: string; mrIid: number }) => {
        await ctx.client.request(
          'PUT',
          `/projects/${ctx.client.encodeProject(args.project)}/merge_requests/${args.mrIid}/rebase`,
        );
        return `Rebase of !${args.mrIid} started; check the MR again shortly.`;
      },
    },
  };
}
