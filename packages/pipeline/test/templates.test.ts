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
    // The other five classics are still offered.
    for (const slug of ['intake', 'spec', 'code', 'test', 'deploy'] as const) {
      expect(installable.some((t) => t.id === builtinTemplateId(slug))).toBe(true);
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
