/**
 * Tiny, safe `{{dotted.path}}` renderer for prompt templates (webhook
 * triggers, pipeline stages).
 *
 * Deliberately NOT a general templating language — no conditionals, no
 * loops, no function calls. The only operation is dotted-path lookup into
 * the provided context object. Anything unresolvable is replaced with an
 * empty string (caller can audit the rendered prompt if they care).
 *
 * Guardrails:
 *   - no JS eval — keys are parsed and looked up with bracket access
 *   - path must match /^[\w.-]+$/ — protects against prototype pollution
 *     and weird unicode lookalikes
 *   - array index via number works: `items.0.name`
 */

const TOKEN_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;
const KEY_RE = /^[\w-]+$/;

export function render(template: string, context: unknown): string {
  return template.replace(TOKEN_RE, (_match, rawPath: string) => {
    const value = lookup(context, rawPath);
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    // Objects/arrays: JSON-stringify so the CC prompt sees a readable form.
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  });
}

function lookup(context: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = context;
  for (const part of parts) {
    if (!KEY_RE.test(part)) return undefined;
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    // Block __proto__ / constructor / prototype lookups.
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
