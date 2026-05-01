// Praeventio Guard — Round 16 R5 Phase 1 split.
//
// Constant-time comparison of a client-supplied secret against an expected
// secret, used by webhook handlers (e.g. /api/billing/webhook) and any other
// route that authenticates via a shared environment-derived secret.
//
// Both inputs are padded to the expected length before invoking
// `crypto.timingSafeEqual`, so the running time does not branch on either the
// provided or the expected length. A naive `if (a.length !== b.length)` guard
// leaks the expected secret length via wall-clock timing — minor in practice
// but trivial to avoid. The length check is folded into the final boolean
// AFTER the constant-time compare so both branches do equal work.
//
// Returns `false` if `provided` is undefined (caller doesn't need a separate
// guard).
//
// Phase 2 (billing) and Phase 3 (curriculum/projects) and Phase 4
// (oauth/gemini) deferred to Round 17/18.

import crypto from 'crypto';

export function safeSecretEqual(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  // Pad provided to expected length so timingSafeEqual sees equal-size buffers
  // and does not throw. Padding bytes (zeros) don't matter — a different
  // length forces lengthOk=false regardless of the bytewise compare.
  const padded = Buffer.alloc(expectedBuf.length);
  providedBuf.copy(padded);
  const lengthOk = providedBuf.length === expectedBuf.length;
  const valueOk = crypto.timingSafeEqual(padded, expectedBuf);
  return lengthOk && valueOk;
}
