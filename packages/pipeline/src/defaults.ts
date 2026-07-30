import {
  type MachineTemplate,
  type PipelineConfig,
  type Store,
  builtinTemplateId,
} from '@claude-hub/core';

/**
 * Built-in machine templates: the six classic assembly-line stations, now
 * just pre-configured templates a user can stamp machines from. Custom
 * templates live in the machineTemplates store file; built-ins are code
 * constants and never stored.
 *
 * A new line starts BLANK: no machines until the user installs one from the
 * workshop UI.
 */

export const DEFAULT_MONITOR_INTERVAL_MINUTES = 30;
export const DEFAULT_MONITOR_MAX_CHECKS = 3;

/** Marker lines a resultCheck machine's agent self-reports with. */
export const MACHINE_PASS_MARKER = 'MACHINE_RESULT: PASS';
export const MACHINE_FAIL_MARKER = 'MACHINE_RESULT: FAIL';
/**
 * Third outcome for machines in a monitor loop: "still pending — check again
 * next tick". Neither passes nor fails; outside a monitor loop it's an error.
 */
export const MACHINE_WAIT_MARKER = 'MACHINE_RESULT: WAIT';
/** Backstop: a machine that only ever WAITs surfaces as a failure after this. */
export const MONITOR_WAIT_TIMEOUT_HOURS = 72;
/** Pre-v7 markers still honored so migrated custom prompts keep working. */
export const LEGACY_PASS_MARKERS: readonly string[] = ['MONITOR_RESULT: PASS'];
export const LEGACY_FAIL_MARKERS: readonly string[] = [
  'TEST_RESULT: FAIL',
  'MONITOR_RESULT: FAIL',
];

/** Line an agent machine ends its reply with, feeding the activity board. */
export const MACHINE_SUMMARY_MARKER = 'MACHINE_SUMMARY:';

/**
 * Appended to every agent machine prompt in executeMachine — including
 * custom templates, which therefore never need editing.
 */
export const MACHINE_SUMMARY_INSTRUCTION =
  'At the end of your reply, include exactly one line starting with "MACHINE_SUMMARY: " ' +
  'followed by a 1-2 sentence high-level summary of what you did and the outcome. ' +
  'If you were also asked to end with a MACHINE_RESULT line, put the MACHINE_SUMMARY ' +
  'line immediately before it.';

const EPOCH = new Date(0).toISOString();

/**
 * Lifecycle prompt for the Code Review station: the same session is invoked
 * once per monitor tick, so the prompt covers every phase (open the MR,
 * babysit reviews and CI, merge) and asks the agent to re-derive state each
 * tick. Direct merge only — the machine never arms GitLab auto-merge, so
 * "merged" is always something it observed, not something it scheduled.
 */
const CODE_REVIEW_PROMPT =
  'You are the code-review station of an autonomous development pipeline. ' +
  'Your job is to get the change for the request below merged on GitLab via ' +
  'a merge request. You manage exactly one merge request — the one for this ' +
  'work item. You are invoked repeatedly on a schedule; each invocation is ' +
  'one tick of the same ongoing session. On every tick, re-derive the real ' +
  'state from local git and the GitLab tools instead of trusting memory, do ' +
  'whatever the current state calls for, and then end your reply with ' +
  'exactly one line:\n\n' +
  'MACHINE_RESULT: PASS — only once the merge request has actually merged.\n' +
  'MACHINE_RESULT: WAIT — anything is still pending (pipeline running, ' +
  'waiting on reviewers, rebase in progress). You will be invoked again ' +
  'soon; keep no-op ticks short and cheap.\n' +
  'MACHINE_RESULT: FAIL <reason> — an unrecoverable situation: no GitLab ' +
  'remote, the MR was closed by a human, pushes are rejected, or CI keeps ' +
  'failing after 3 distinct fix attempts for the same job.\n\n' +
  'Lifecycle:\n\n' +
  '1. No merge request yet: the working tree in the current directory ' +
  'contains the implemented change from earlier stations. Derive the GitLab ' +
  'project path from `git remote get-url origin` and the branch from ' +
  '`git branch --show-current`. If the work sits on the default branch, ' +
  'create a feature branch for it first. Commit anything uncommitted with a ' +
  'clear message, push the branch with gitlab_push_branch, and open an MR ' +
  'against the default branch with gitlab_create_merge_request — title from ' +
  'the request, description summarizing what changed and why. Then report ' +
  'WAIT.\n\n' +
  '2. MR is open — each tick, in order:\n' +
  'a. Discussions: call gitlab_list_mr_discussions. For every unresolved ' +
  'reviewer discussion, judge whether the requested change is credible and ' +
  'relevant to this MR. If it is, make the code change, commit, push, and ' +
  'reply on the discussion describing what you changed. If it is not, reply ' +
  'with a brief, respectful explanation of why you are not making the ' +
  'change. In both cases resolve the discussion with ' +
  'gitlab_resolve_mr_discussion. Never resolve a discussion without ' +
  'replying first. IMPORTANT: before editing files for MR fixes, make sure ' +
  'the working tree is on the MR source branch; if another work item may be ' +
  'using this directory, do your fixes in a separate git worktree ' +
  '(git worktree add) or a fresh clone via gitlab_clone_repo, and push from ' +
  'there.\n' +
  'b. CI: check the head pipeline (gitlab_get_merge_request or ' +
  'gitlab_list_mr_pipelines). If it failed, list the failed jobs with ' +
  'gitlab_get_pipeline_jobs, read their logs with gitlab_get_job_log, ' +
  'diagnose the root cause, fix it, commit and push. Track your attempts ' +
  'per failing job; after 3 failed fix attempts for the same cause, report ' +
  'FAIL.\n' +
  'c. Merge: only when all discussions are resolved AND the head pipeline ' +
  'has fully succeeded, merge with gitlab_merge_merge_request. Do not use ' +
  'mergeWhenPipelineSucceeds — merge directly or wait. If the pipeline is ' +
  'still running, report WAIT and merge on a later tick. If GitLab refuses ' +
  'because the source branch has diverged, run gitlab_rebase_merge_request ' +
  'and report WAIT.\n' +
  'd. Otherwise report WAIT, noting in one line what you are waiting for.\n\n' +
  '3. MR state is merged: report PASS. MR was closed without merging: ' +
  'report FAIL with the reason.\n\n' +
  'Request "{{title}}":\n{{request}}\n\n' +
  'Summary of the change from the previous station:\n{{previous.output}}';

/**
 * Built-in prompt templates reference `{{previous.output}}` (the nearest
 * preceding machine's output) rather than a named stage, so they stay
 * correct on lines with any machine mix or order.
 */
export const BUILTIN_MACHINE_TEMPLATES: readonly MachineTemplate[] = [
  {
    id: builtinTemplateId('intake'),
    slug: 'intake',
    name: 'Intake',
    description: 'Triage the incoming request into a clear, actionable task.',
    source: 'builtin',
    defaultGate: 'auto',
    promptTemplate:
      'You are the intake station of an autonomous development pipeline. ' +
      'Review the work request below, restate it as a clear, actionable task, ' +
      'and note any assumptions you are making. Do not write any code yet.\n\n' +
      'Request "{{title}}" (source: {{source}}):\n{{request}}',
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    id: builtinTemplateId('spec'),
    slug: 'spec',
    name: 'Spec',
    description: 'Write a concrete implementation plan before any code.',
    source: 'builtin',
    defaultGate: 'auto',
    promptTemplate:
      'You are the planning station of an autonomous development pipeline. ' +
      'Write a concrete implementation plan for the request below: the files to ' +
      'change, the approach, edge cases, and how the change will be verified. ' +
      'Do NOT implement anything yet.\n\n' +
      'Request "{{title}}":\n{{request}}\n\n{{previous.output}}',
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    id: builtinTemplateId('code'),
    slug: 'code',
    name: 'Code',
    description: 'Implement the plan in the repository.',
    source: 'builtin',
    defaultGate: 'auto',
    promptTemplate:
      'You are the coding station of an autonomous development pipeline. ' +
      'Implement the plan below in this repository. Keep changes scoped to the ' +
      'plan; follow the existing code conventions.\n\n' +
      'Request "{{title}}":\n{{request}}\n\nPlan:\n{{previous.output}}',
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    id: builtinTemplateId('test'),
    slug: 'test',
    name: 'Test',
    description: 'Verify the change: run tests, fix straightforward failures.',
    source: 'builtin',
    defaultGate: 'auto',
    resultCheck: 'lenient',
    promptTemplate:
      'You are the validation station of an autonomous development pipeline. ' +
      'Verify the implementation for the request below: run the test suite and ' +
      'any relevant checks, and fix straightforward failures caused by the ' +
      'change. End your reply with exactly one line: MACHINE_RESULT: PASS if ' +
      'everything passes, or MACHINE_RESULT: FAIL with a short reason.\n\n' +
      'Request "{{title}}":\n{{request}}\n\nPlan:\n{{previous.output}}',
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    id: builtinTemplateId('code-review'),
    slug: 'code-review',
    name: 'Code Review',
    description: 'Open a GitLab merge request, babysit reviewer feedback and CI, and merge when green.',
    source: 'builtin',
    defaultGate: 'auto',
    resultCheck: 'strict',
    mcpServers: ['bundled-gitlab'],
    // Redundant with the bundled server's own requiredEnv, but declaring it
    // on the machine keeps the dependency visible in the station config.
    requiredEnv: ['GITLAB_TOKEN'],
    // One PASS = the MR actually merged; nothing to re-verify N times.
    monitor: { intervalMinutes: 5, maxChecks: 1 },
    promptTemplate: CODE_REVIEW_PROMPT,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    id: builtinTemplateId('deploy'),
    slug: 'deploy',
    name: 'Deploy',
    description: "Ship the verified change via the project's deploy process.",
    source: 'builtin',
    defaultGate: 'approval',
    promptTemplate:
      'You are the deployment station of an autonomous development pipeline. ' +
      "Deploy the verified change for the request below using this project's " +
      'usual deployment process. If the project has no deployment process, say ' +
      'so and stop.\n\nRequest "{{title}}":\n{{request}}',
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    id: builtinTemplateId('monitor'),
    slug: 'monitor',
    name: 'Monitor',
    description: 'Watch production health on a schedule after shipping.',
    source: 'builtin',
    defaultGate: 'auto',
    resultCheck: 'strict',
    monitor: {
      intervalMinutes: DEFAULT_MONITOR_INTERVAL_MINUTES,
      maxChecks: DEFAULT_MONITOR_MAX_CHECKS,
    },
    promptTemplate:
      'You are the production-monitoring station of an autonomous development ' +
      'pipeline. Check that the application is healthy after the recent change ' +
      'for the request below: exercise the affected behavior end-to-end and ' +
      'look for errors. End your reply with exactly one line: ' +
      'MACHINE_RESULT: PASS if everything is healthy, or MACHINE_RESULT: FAIL ' +
      'with a short reason.\n\nRequest "{{title}}":\n{{request}}',
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
];

/** Every template a user can stamp machines from: built-ins then customs. */
export function listMachineTemplates(store: Store): MachineTemplate[] {
  return [...BUILTIN_MACHINE_TEMPLATES, ...store.machineTemplates()];
}

/**
 * Built-ins retired from the add-machine gallery but kept resolvable so
 * already-installed machines keep their prompt fallback and pass templateId
 * validation. The classic Monitor station is superseded by project-level
 * monitors (the factory light over the SHIPPED door).
 */
const HIDDEN_BUILTIN_TEMPLATE_IDS: ReadonlySet<string> = new Set([builtinTemplateId('monitor')]);

/** Templates offered in the add-machine gallery: built-ins minus retired ones, plus customs. */
export function listInstallableMachineTemplates(store: Store): MachineTemplate[] {
  return listMachineTemplates(store).filter((t) => !HIDDEN_BUILTIN_TEMPLATE_IDS.has(t.id));
}

/** Template lookup for the instance promptTemplate fallback chain. */
export function findMachineTemplate(
  store: Store,
  templateId: string | undefined,
): MachineTemplate | undefined {
  if (templateId === undefined) return undefined;
  return listMachineTemplates(store).find((t) => t.id === templateId);
}

export function defaultPipelineConfig(projectId: string): PipelineConfig {
  return { projectId, machines: [], updatedAt: new Date(0).toISOString() };
}

/**
 * The config the pipeline actually runs with: machine instances are
 * self-contained, so this is just the stored config or the blank default.
 */
export function effectivePipelineConfig(store: Store, projectId: string): PipelineConfig {
  return store.pipelines().find((p) => p.projectId === projectId) ?? defaultPipelineConfig(projectId);
}
