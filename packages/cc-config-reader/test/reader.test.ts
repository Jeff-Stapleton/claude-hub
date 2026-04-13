import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CCConfigReader } from '../src/reader.js';

describe('CCConfigReader', () => {
  let root: string;
  let reader: CCConfigReader;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cc-fake-'));
    reader = new CCConfigReader(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns empty when ~/.claude/ is missing', async () => {
    expect(await reader.listProjects()).toEqual([]);
    expect(await reader.listGlobalSkills()).toEqual([]);
    const settings = await reader.readSettings();
    expect(settings.global).toBeNull();
    expect(settings.local).toBeNull();
  });

  it('lists projects with session counts', async () => {
    const projDir = join(root, 'projects', 'C--Users-x-foo');
    await mkdir(projDir, { recursive: true });
    await writeFile(join(projDir, 'a.jsonl'), '');
    await writeFile(join(projDir, 'b.jsonl'), '');
    // a UUID subdir (not a session)
    await mkdir(join(projDir, '11111111-1111-1111-1111-111111111111'));

    const projects = await reader.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.sanitizedName).toBe('C--Users-x-foo');
    expect(projects[0]?.sessionCount).toBe(2);
    expect(projects[0]?.lastActivity).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reads global and local settings', async () => {
    await writeFile(join(root, 'settings.json'), JSON.stringify({ a: 1 }));
    await writeFile(join(root, 'settings.local.json'), JSON.stringify({ b: 2 }));

    const s = await reader.readSettings();
    expect(s.global).toEqual({ a: 1 });
    expect(s.local).toEqual({ b: 2 });
  });

  it('lists global skills', async () => {
    await mkdir(join(root, 'skills', 'foo'), { recursive: true });
    await mkdir(join(root, 'skills', 'bar'), { recursive: true });
    const skills = await reader.listGlobalSkills();
    expect(skills.sort()).toEqual(['bar', 'foo']);
  });
});
