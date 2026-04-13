import { describe, expect, it } from 'vitest';
import { generateWebhookSecret, verifyWebhookSecret } from '../src/webhook.js';

describe('webhook secret', () => {
  it('generates a 64-char hex string', () => {
    const s = generateWebhookSecret();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates distinct secrets each call', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });

  it('verifies matching secrets', () => {
    const s = generateWebhookSecret();
    expect(verifyWebhookSecret(s, s)).toBe(true);
  });

  it('rejects mismatched secrets', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(verifyWebhookSecret(a, b)).toBe(false);
  });

  it('rejects undefined / wrong-length input without throwing', () => {
    const s = generateWebhookSecret();
    expect(verifyWebhookSecret(s, undefined)).toBe(false);
    expect(verifyWebhookSecret(s, 'tooshort')).toBe(false);
    expect(verifyWebhookSecret(s, s + 'x')).toBe(false);
  });
});
