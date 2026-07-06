import type {
  MonitorStageConfig,
  PipelineConfig,
  PipelineStageId,
  StageConfig,
  Store,
} from '@claude-hub/core';

/**
 * Built-in defaults for a project's assembly line. A project with no stored
 * PipelineConfig gets exactly this; a stored config is merged over it per
 * stage so additive fields stay populated.
 *
 * A new line starts BLANK: every stage disabled until the user installs its
 * machine in the workshop UI. Per-stage settings still carry sensible values
 * (deploy gates on human approval, monitor has a cadence) so enabling a
 * stage inherits them.
 */

export const DEFAULT_MONITOR_INTERVAL_MINUTES = 30;
export const DEFAULT_MONITOR_MAX_CHECKS = 3;

/** Marker line the monitor-stage agent must print. Missing marker = fail. */
export const MONITOR_PASS_MARKER = 'MONITOR_RESULT: PASS';
export const MONITOR_FAIL_MARKER = 'MONITOR_RESULT: FAIL';
/** Marker for the test stage. Lenient: only an explicit FAIL marker fails. */
export const TEST_FAIL_MARKER = 'TEST_RESULT: FAIL';

export const DEFAULT_STAGE_TEMPLATES: Record<PipelineStageId, string> = {
  intake:
    'You are the intake station of an autonomous development pipeline. ' +
    'Review the work request below, restate it as a clear, actionable task, ' +
    'and note any assumptions you are making. Do not write any code yet.\n\n' +
    'Request "{{title}}" (source: {{source}}):\n{{request}}',
  spec:
    'You are the planning station of an autonomous development pipeline. ' +
    'Write a concrete implementation plan for the request below: the files to ' +
    'change, the approach, edge cases, and how the change will be verified. ' +
    'Do NOT implement anything yet.\n\n' +
    'Request "{{title}}":\n{{request}}\n\n{{stages.intake.output}}',
  code:
    'You are the coding station of an autonomous development pipeline. ' +
    'Implement the plan below in this repository. Keep changes scoped to the ' +
    'plan; follow the existing code conventions.\n\n' +
    'Request "{{title}}":\n{{request}}\n\nPlan:\n{{stages.spec.output}}',
  test:
    'You are the validation station of an autonomous development pipeline. ' +
    'Verify the implementation for the request below: run the test suite and ' +
    'any relevant checks, and fix straightforward failures caused by the ' +
    'change. End your reply with exactly one line: TEST_RESULT: PASS if ' +
    'everything passes, or TEST_RESULT: FAIL with a short reason.\n\n' +
    'Request "{{title}}":\n{{request}}\n\nPlan:\n{{stages.spec.output}}',
  deploy:
    'You are the deployment station of an autonomous development pipeline. ' +
    'Deploy the verified change for the request below using this project\'s ' +
    'usual deployment process. If the project has no deployment process, say ' +
    'so and stop.\n\nRequest "{{title}}":\n{{request}}',
  monitor:
    'You are the production-monitoring station of an autonomous development ' +
    'pipeline. Check that the application is healthy after the recent change ' +
    'for the request below: exercise the affected behavior end-to-end and ' +
    'look for errors. End your reply with exactly one line: ' +
    'MONITOR_RESULT: PASS if everything is healthy, or MONITOR_RESULT: FAIL ' +
    'with a short reason.\n\nRequest "{{title}}":\n{{request}}',
};

function stage(overrides: Partial<StageConfig> & { enabled: boolean }): StageConfig {
  return { gate: 'auto', ...overrides };
}

export function defaultPipelineConfig(projectId: string): PipelineConfig {
  const monitor: MonitorStageConfig = {
    ...stage({ enabled: false }),
    intervalMinutes: DEFAULT_MONITOR_INTERVAL_MINUTES,
    maxChecks: DEFAULT_MONITOR_MAX_CHECKS,
  };
  return {
    projectId,
    stages: {
      intake: stage({ enabled: false }),
      spec: stage({ enabled: false }),
      code: stage({ enabled: false }),
      test: stage({ enabled: false }),
      deploy: stage({ enabled: false, gate: 'approval' }),
      monitor,
    },
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * The config the pipeline actually runs with: the stored config for the
 * project (if any) merged per-stage over the built-in defaults.
 */
export function effectivePipelineConfig(store: Store, projectId: string): PipelineConfig {
  const stored = store.pipelines().find((p) => p.projectId === projectId);
  const base = defaultPipelineConfig(projectId);
  if (!stored) return base;
  return {
    projectId,
    stages: {
      intake: { ...base.stages.intake, ...stored.stages.intake },
      spec: { ...base.stages.spec, ...stored.stages.spec },
      code: { ...base.stages.code, ...stored.stages.code },
      test: { ...base.stages.test, ...stored.stages.test },
      deploy: { ...base.stages.deploy, ...stored.stages.deploy },
      monitor: { ...base.stages.monitor, ...stored.stages.monitor },
    },
    updatedAt: stored.updatedAt,
  };
}
