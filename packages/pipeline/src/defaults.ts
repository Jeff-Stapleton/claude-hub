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
/** Pre-v7 markers still honored so migrated custom prompts keep working. */
export const LEGACY_PASS_MARKERS: readonly string[] = ['MONITOR_RESULT: PASS'];
export const LEGACY_FAIL_MARKERS: readonly string[] = [
  'TEST_RESULT: FAIL',
  'MONITOR_RESULT: FAIL',
];

const EPOCH = new Date(0).toISOString();

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
