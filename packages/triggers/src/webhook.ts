import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 32-byte hex secret (64 chars). Generated server-side on webhook trigger
 * creation; returned to the UI exactly once in the POST response.
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Constant-time secret compare so a timing attack can't discover the
 * secret one byte at a time. Mismatched lengths always return false.
 */
export function verifyWebhookSecret(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  // Reject obviously bad input before hitting Buffer — timingSafeEqual
  // throws on mismatched lengths, and we don't want to leak that via an
  // exception handler branch.
  if (typeof provided !== 'string') return false;
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
}
