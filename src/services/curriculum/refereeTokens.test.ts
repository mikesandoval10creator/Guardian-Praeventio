// Praeventio Guard — Round 14 (R5 agent): magic-link referee tokens.
//
// Token model:
//   • generateRefereeToken() returns a 64-char (32-byte) hex string.
//   • hashToken(t) returns sha256(t) as 64-char lowercase hex.
//   • The RAW token never lives in Firestore — only the hash. Verification
//     happens by hashing the inbound token and matching it against
//     curriculum_claims/{id}.referees[*].tokenHash.
//
// We deliberately do NOT use signed JWTs here. The security of the magic
// link rests on (a) the 256-bit token entropy, (b) the Firestore lookup,
// and (c) the 14-day expiry stamped on the parent claim. Stateless tokens
// would add a JWT library dep we are not allowed to install.

import { describe, it, expect } from 'vitest';
import { generateRefereeToken, hashToken } from './refereeTokens.js';

describe('generateRefereeToken', () => {
  it('returns a 64-character lowercase hex string (32 bytes)', () => {
    const token = generateRefereeToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique tokens across 1000 calls (probabilistic — 256 bits of entropy)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      set.add(generateRefereeToken());
    }
    expect(set.size).toBe(1000);
  });
});

describe('hashToken', () => {
  it('returns a 64-character lowercase hex string (sha256 hex digest length)', () => {
    const h = hashToken('any-input');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input always yields the same hash', () => {
    const t = generateRefereeToken();
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it('is collision-resistant for distinct inputs (different tokens → different hashes)', () => {
    const a = generateRefereeToken();
    const b = generateRefereeToken();
    expect(a).not.toBe(b);
    expect(hashToken(a)).not.toBe(hashToken(b));
  });

  it('matches a known sha256 vector ("abc" → ba7816...)', () => {
    // RFC-style sanity: sha256("abc") =
    //   ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
