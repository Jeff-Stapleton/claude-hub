import type { AgentRunner } from '@claude-hub/agent-runner';
import type { Project, Store } from '@claude-hub/core';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runProjectCheck } from '../src/projectChecks.js';

describe('runProjectCheck command checks', () => {
  let root: string;
  let project: Project;

  const deps = {
    store: {} as Store,
    agentRunner: {} as AgentRunner,
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-check-test-'));
    project = {
      id: 'proj-1',
      path: root,
      name: 'demo',
      vision: '',
      repos: [],
      addedAt: new Date().toISOString(),
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('runs command checks in the project root by default', async () => {
    const res = await runProjectCheck(deps, project, {
      id: 'check-1',
      name: 'pwd',
      type: 'command',
      intervalMinutes: 1,
      command: 'node -e "console.log(process.cwd())"',
    });

    expect(res.ok).toBe(true);
    expect(res.output).toContain(`cwd: ${root}`);
    expect(res.output).toContain(root);
  });

  it('runs command checks in a configured relative cwd', async () => {
    const serviceDir = join(root, 'services', 'readonly-api');
    await mkdir(serviceDir, { recursive: true });

    const res = await runProjectCheck(deps, project, {
      id: 'check-1',
      name: 'pwd',
      type: 'command',
      intervalMinutes: 1,
      cwd: 'services/readonly-api',
      command: 'node -e "console.log(process.cwd())"',
    });

    expect(res.ok).toBe(true);
    expect(res.output).toContain(`cwd: ${serviceDir}`);
    expect(res.output).toContain(serviceDir);
  });

  it('rejects command cwd values outside the project root', async () => {
    const res = await runProjectCheck(deps, project, {
      id: 'check-1',
      name: 'pwd',
      type: 'command',
      intervalMinutes: 1,
      cwd: '..',
      command: 'node -e "console.log(process.cwd())"',
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('command cwd cannot leave the project root');
  });
});
