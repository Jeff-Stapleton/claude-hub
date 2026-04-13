import { describe, expect, it } from 'vitest';
import { encodeProjectPath } from '../src/encode.js';

describe('encodeProjectPath', () => {
  it('encodes Windows paths the way Claude Code does', () => {
    expect(encodeProjectPath('C:\\Users\\jeffd\\Documents\\Github')).toBe(
      'C--Users-jeffd-Documents-Github',
    );
  });

  it('encodes Windows paths with .claude in them', () => {
    expect(encodeProjectPath('C:\\Users\\jeffd\\.claude')).toBe('C--Users-jeffd-.claude');
  });

  it('encodes POSIX paths', () => {
    expect(encodeProjectPath('/home/jeff/proj')).toBe('-home-jeff-proj');
  });

  it('round-trips the project path the user is currently in', () => {
    // Spot-check: this must equal what `~/.claude/projects/` would have used.
    expect(encodeProjectPath('C:\\Users\\jeffd\\Documents\\Github\\claude-hub')).toBe(
      'C--Users-jeffd-Documents-Github-claude-hub',
    );
  });
});
