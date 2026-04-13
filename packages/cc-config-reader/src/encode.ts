/**
 * Claude Code stores per-project state under `~/.claude/projects/<sanitized>/`,
 * where `<sanitized>` is the absolute project path with any of `\`, `/`, `:`
 * collapsed to `-`.
 *
 * The encoding is lossy (e.g. both `C:\Users\foo` and `C/Users/foo` would
 * encode to `C--Users-foo` on Windows), so a perfect *decode* is impossible.
 * Instead, we encode any candidate path and compare — exact matches identify
 * which on-disk CC project belongs to which user-registered project.
 */

const ENCODE_RE = /[\\/:]/g;

export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(ENCODE_RE, '-');
}
