// Praeventio Guard — Round 17 (R5 agent): WebAuthn challenge cache.
//
// Closes the Round 16 R6 finding: client-generated WebAuthn challenges
// are replay-vulnerable (an attacker who captures the assertion can
// re-submit it indefinitely). This service persists a server-issued,
// single-use challenge with a 5-minute TTL and an atomic mark-consumed
// step so a captured assertion can be replayed at most once before
// the cache rejects it (and even then only inside the TTL window).
//
// MAPPING TO ISO 27001 §A.9.4.1 (Information access restriction)
//   • Server-issued challenge (auditable, not client-controllable).
//   • Single-use (consumed:true after a successful match).
//   • Time-bound (5-minute TTL — long enough for a slow native dialog,
//     short enough that a stolen challenge value rapidly stales out).
//   • Idempotent + atomic consume (precondition: consumed:false). Two
//     concurrent /verify calls cannot both win.
//
// SHAPE
//   webauthn_challenges/{uid}_{challengeId}
//     uid:           string
//     challengeId:   string (64-char hex, doc-id suffix)
//     challengeB64:  string (base64 of the 32 random bytes)
//     createdAt:     number (ms since epoch — when the doc was written)
//     expiresAt:     number (ms since epoch — createdAt + ttlMs)
//     consumed:      boolean (initial false; flipped on consume)
//     consumedAt:    number | null (null until first successful consume)
//
// We use a `MinimalChallengesDb` injection rather than firebase-admin
// directly so the unit suite can swap in an in-memory fake. Production
// (server.ts) wires admin.firestore() through a thin adapter that
// implements the same surface — including the conditional-update
// primitive (`updateIf`) which we model on transactional Firestore
// updates with a precondition check.

import crypto from 'node:crypto';

const COLLECTION = 'webauthn_challenges';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_BYTES = 32;

export type ConsumeReason = 'unknown' | 'expired' | 'consumed' | 'mismatch';

export interface MinimalChallengesDb {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{
        exists: boolean;
        id: string;
        data: () => Record<string, unknown> | undefined;
      }>;
      set(data: Record<string, unknown>): Promise<void>;
      /**
       * Apply `patch` only if `precondition(currentData)` returns true.
       * Returns true on success, false on precondition failure. The
       * production adapter implements this on top of a Firestore
       * transaction (read-then-conditional-write); the in-memory test
       * fake checks the predicate against the current Map entry. Both
       * MUST be atomic with respect to other concurrent updateIf calls
       * on the same doc.
       */
      updateIf(
        precondition: (current: Record<string, unknown> | undefined) => boolean,
        patch: Record<string, unknown>,
      ): Promise<boolean>;
    };
  };
  /** Injected clock — defaults to Date.now in production. Tests fake it. */
  now: () => number;
}

export interface GeneratedChallenge {
  challengeId: string;
  challenge: Uint8Array;
}

/**
 * Generate a fresh server challenge. Caller must persist it via
 * storeWebAuthnChallenge before handing the bytes to the client.
 */
export function generateWebAuthnChallenge(): GeneratedChallenge {
  const challenge = crypto.randomBytes(CHALLENGE_BYTES);
  const challengeId = crypto.randomBytes(CHALLENGE_BYTES).toString('hex');
  return { challengeId, challenge: new Uint8Array(challenge) };
}

export interface StoreOptions {
  /** Override the default 5-minute TTL. Useful for testing. */
  ttlMs?: number;
}

/**
 * Persist a freshly-issued challenge so a later /verify can validate it.
 * The doc id is `{uid}_{challengeId}` for cheap reads + tenant-scoping.
 */
export async function storeWebAuthnChallenge(
  uid: string,
  challengeId: string,
  challenge: Uint8Array,
  db: MinimalChallengesDb,
  options: StoreOptions = {},
): Promise<void> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = db.now();
  const docId = `${uid}_${challengeId}`;
  await db.collection(COLLECTION).doc(docId).set({
    uid,
    challengeId,
    challengeB64: Buffer.from(challenge).toString('base64'),
    createdAt: now,
    expiresAt: now + ttlMs,
    consumed: false,
    consumedAt: null,
  });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  // timingSafeEqual requires equal length — already checked above.
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Validate + atomically mark-consumed a challenge. Returns
 * `{ valid: true }` on success or `{ valid: false, reason }` on any
 * mismatch / expiry / replay.
 *
 * Atomicity guarantee: even with two concurrent calls, exactly one
 * succeeds; the other observes the post-update state and returns
 * reason='consumed'. The production adapter implements `updateIf` via
 * a Firestore transaction with a `consumed === false` precondition.
 */
export async function consumeWebAuthnChallenge(
  uid: string,
  challengeId: string,
  providedChallenge: Uint8Array,
  db: MinimalChallengesDb,
): Promise<{ valid: true } | { valid: false; reason: ConsumeReason }> {
  const docId = `${uid}_${challengeId}`;
  const ref = db.collection(COLLECTION).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { valid: false, reason: 'unknown' };
  }
  const data = snap.data() ?? {};
  const expiresAt = Number(data.expiresAt);
  // Inclusive boundary: now === expiresAt is treated as expired so the
  // window is exclusive on the upper bound (consistent with HTTP TTL
  // semantics + ISO 27001 review feedback).
  if (!Number.isFinite(expiresAt) || db.now() >= expiresAt) {
    return { valid: false, reason: 'expired' };
  }
  if (data.consumed === true) {
    return { valid: false, reason: 'consumed' };
  }

  const storedB64 = String(data.challengeB64 ?? '');
  let storedBytes: Uint8Array;
  try {
    storedBytes = new Uint8Array(Buffer.from(storedB64, 'base64'));
  } catch {
    return { valid: false, reason: 'mismatch' };
  }
  if (!bytesEqual(storedBytes, providedChallenge)) {
    return { valid: false, reason: 'mismatch' };
  }

  // Atomic mark-consumed. The precondition guards against a concurrent
  // consume() winning the race and flipping consumed:false → true.
  const ok = await ref.updateIf(
    (cur) => !!cur && cur.consumed === false,
    { consumed: true, consumedAt: db.now() },
  );
  if (!ok) {
    return { valid: false, reason: 'consumed' };
  }
  return { valid: true };
}
