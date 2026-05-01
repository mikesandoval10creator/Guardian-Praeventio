// Praeventio Guard — Round 14 (R5 agent): magic-link referee tokens.
//
// SCOPE
//   Tiny, dependency-free helpers used by curriculum_claims:
//     • generateRefereeToken() → 32-byte hex (256 bits of entropy)
//     • hashToken(token) → sha256 hex digest
//
// SECURITY MODEL
//   The raw token NEVER lives in Firestore. We persist only sha256(token)
//   as `tokenHash`. The referee receives the raw token via email; on
//   accept the server hashes the inbound token and looks up the matching
//   `curriculum_claims/{id}.referees[*].tokenHash`. This means a Firestore
//   read leak does not allow an attacker to forge a co-signature — they
//   would need to invert sha256 (computationally infeasible) AND know the
//   claimId. Combined with the 14-day TTL on the parent claim, this is
//   sufficient for the MVP threat model (untrusted email transit, trusted
//   server).
//
//   We deliberately do NOT use signed JWTs. Reasons:
//     (a) No new dependency budget in Round 14 — `package.json` is owned
//         by R1 and a JWT library would add risk.
//     (b) Stateless tokens add nothing here: every accept flow needs a
//         Firestore round-trip anyway (to write the signature), so a
//         token-hash lookup is free.
//     (c) Rotation/revocation is trivial — flip `claim.status = expired`
//         and the lookup returns nothing, regardless of token validity.

import crypto from 'node:crypto';

/**
 * Generate a fresh 32-byte random token, lowercase-hex encoded.
 * Returns a 64-character string.
 */
export function generateRefereeToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * sha256 hex digest of the input. Used for storing tokens at rest:
 * Firestore holds the hash; the raw token only appears in transit
 * (email body, magic-link URL).
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}
