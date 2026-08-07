import { HubPaths, Store, builtinTemplateId } from '@claude-hub/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findMachineTemplate,
  listInstallableMachineTemplates,
  listMachineTemplates,
} from '../src/defaults.js';

describe('machine template listings', () => {
  let root: string;
  let store: Store;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'templates-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('hides the retired monitor builtin from the installable gallery', () => {
    const installable = listInstallableMachineTemplates(store);
    expect(installable.some((t) => t.id === builtinTemplateId('monitor'))).toBe(false);
    // The other builtins are still offered.
    for (const slug of ['intake', 'spec', 'code', 'test', 'code-review', 'deploy'] as const) {
      expect(installable.some((t) => t.id === builtinTemplateId(slug))).toBe(true);
    }
  });

  it('ships the code-review builtin as an MR-babysitting monitor machine', () => {
    const template = findMachineTemplate(store, builtinTemplateId('code-review'));
    expect(template?.slug).toBe('code-review');
    expect(template?.resultCheck).toBe('strict');
    expect(template?.mcpServers).toEqual(['bundled-gitlab']);
    expect(template?.requiredEnv).toEqual(['GITLAB_TOKEN']);
    expect(template?.monitor).toEqual({ intervalMinutes: 5, maxChecks: 1 });
    // The lifecycle prompt covers all three self-report outcomes.
    for (const marker of ['MACHINE_RESULT: PASS', 'MACHINE_RESULT: WAIT', 'MACHINE_RESULT: FAIL']) {
      expect(template?.promptTemplate).toContain(marker);
    }
  });

  it('monitor-loop templates forbid tool-call endings and self-scheduling', () => {
    // A tick that ends on a tool call has no final text, so the strict
    // marker check reads it as a failure — the prompts must forbid it.
    for (const slug of ['code-review', 'monitor'] as const) {
      const template = findMachineTemplate(store, builtinTemplateId(slug));
      expect(template?.promptTemplate).toContain('Never end your turn on a tool call');
      expect(template?.promptTemplate).toContain('ScheduleWakeup');
      expect(template?.promptTemplate).toContain('the pipeline owns the tick schedule');
    }
  });

  it('keeps the monitor builtin resolvable for installed machines', () => {
    expect(listMachineTemplates(store).some((t) => t.id === builtinTemplateId('monitor'))).toBe(
      true,
    );
    const resolved = findMachineTemplate(store, builtinTemplateId('monitor'));
    expect(resolved?.slug).toBe('monitor');
    expect(resolved?.promptTemplate).toBeTruthy();
  });
});
