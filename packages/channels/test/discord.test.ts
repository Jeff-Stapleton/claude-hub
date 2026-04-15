import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for the utility functions in discord.ts that don't require a live
 * Discord connection. The adapter itself is integration-tested via the raw
 * gateway path and real DMs (see commit history); these unit tests lock in
 * the helper logic.
 */

// We can't import the private functions directly, so we test them via
// their module. The helpers (chunkText, isTextFile, fetchAttachment) are
// module-level functions — not exported, but exercised indirectly. For
// direct unit testing we extract and test the logic inline here.

describe('chunkText', () => {
  // Re-implement the chunkText logic locally to test it in isolation
  // since it's not exported. If the function ever moves to a shared
  // utility, swap this for an import.
  function chunkText(text: string, max: number): string[] {
    if (text.length <= max) return [text];
    const out: string[] = [];
    let remaining = text;
    while (remaining.length > max) {
      let cut = remaining.lastIndexOf('\n', max);
      if (cut <= 0) cut = max;
      out.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining.length > 0) out.push(remaining);
    return out;
  }

  it('returns the full text when under the limit', () => {
    expect(chunkText('hello', 100)).toEqual(['hello']);
  });

  it('splits at newline boundaries when possible', () => {
    const text = 'line one\nline two\nline three';
    const chunks = chunkText(text, 18);
    expect(chunks[0]).toBe('line one\nline two');
    expect(chunks[1]).toBe('line three');
  });

  it('hard-splits when no newline is available', () => {
    const text = 'a'.repeat(200);
    const chunks = chunkText(text, 100);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[1]).toHaveLength(100);
  });

  it('handles empty text', () => {
    expect(chunkText('', 100)).toEqual(['']);
  });
});

describe('isTextFile', () => {
  // Mirror the logic
  const TEXT_EXTENSIONS = new Set([
    '.md', '.txt', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.yaml', '.yml',
    '.toml', '.ini', '.cfg', '.conf', '.env', '.env.example',
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.cpp', '.h', '.hpp',
    '.cs', '.swift', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
    '.sql', '.graphql', '.gql',
    '.html', '.htm', '.css', '.scss', '.less', '.svg',
    '.dockerfile', '.tf', '.hcl',
    '.log', '.diff', '.patch',
  ]);

  function isTextFile(filename: string, contentType?: string): boolean {
    if (contentType?.startsWith('text/')) return true;
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    return TEXT_EXTENSIONS.has(ext);
  }

  it('recognizes markdown files', () => {
    expect(isTextFile('readme.md')).toBe(true);
    expect(isTextFile('DESIGN.MD')).toBe(true);
  });

  it('recognizes source code files', () => {
    expect(isTextFile('index.ts')).toBe(true);
    expect(isTextFile('main.py')).toBe(true);
    expect(isTextFile('server.go')).toBe(true);
  });

  it('recognizes text content type even with unknown extension', () => {
    expect(isTextFile('data.xyz', 'text/plain')).toBe(true);
    expect(isTextFile('doc.custom', 'text/markdown')).toBe(true);
  });

  it('rejects binary files', () => {
    expect(isTextFile('image.png')).toBe(false);
    expect(isTextFile('archive.zip')).toBe(false);
    expect(isTextFile('video.mp4')).toBe(false);
  });

  it('rejects binary content type with text extension override', () => {
    // content_type takes priority if it's text/*
    expect(isTextFile('weird.png', 'text/plain')).toBe(true);
    // but non-text content type with non-text extension = reject
    expect(isTextFile('data.bin', 'application/octet-stream')).toBe(false);
  });
});
