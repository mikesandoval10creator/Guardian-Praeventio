// Praeventio Guard — Round 14 (R5 agent): Experience-Validation claims.
//
// FLAGSHIP DIFFERENTIATOR (per A7 audit, never built before this round).
// A worker writes a claim like "I have 5 years as a safety capataz with no
// serious incidents." For the claim to count toward their portable
// curriculum it has to be:
//
//   1. Signed by the worker (WebAuthn fingerprint = proof of intent +
//      identity; we accept a fallback "I attest" downgrade flag so the
//      flow survives on devices without an authenticator).
//   2. Co-signed by 2 named referees, each reachable via a verified email.
//      Each referee gets a magic-link with a 32-byte random token; the
//      raw token never lives in Firestore (we store only sha256(token)).
//   3. Verified once both referees co-sign within 14 days; after that the
//      doc is immutable (status='verified').
//
// This module is the engine. Server.ts wires up the HTTP surface
// (POST /api/curriculum/claim, POST /api/curriculum/referee/:token).
//
// DESIGN NOTES
//   • Pure DI — `MinimalClaimsDb` and `AuditLogger` parameters keep the
//     service unit-testable without firebase-admin. Mirrors
//     `services/auth/projectMembership.ts`.
//   • All timestamps are ISO-8601 strings, NOT Firestore Timestamps. We
//     stay in the JS-native domain so the store fake in tests works
//     without a Firestore Admin SDK round-trip and so the data is
//     transport-portable (we may want to ship these claims as part of an
//     ISO 27001 audit export later).
//   • `status` transitions:
//       pending_referees ─▶ verified  (both signed before expiry)
//       pending_referees ─▶ rejected  (a referee declines — out of MVP
//                                      scope but the slot is reserved)
//       pending_referees ─▶ expired   (lazy: enforced server-side at
//                                      endorsement time; we do not run a
//                                      cron sweep yet).

import { generateRefereeToken, hashToken } from './refereeTokens.js';

// --- Public types --------------------------------------------------------

export type ClaimCategory =
  | 'experience'
  | 'certification'
  | 'incident_record'
  | 'other';

export type ClaimStatus =
  | 'pending_referees'
  | 'verified'
  | 'rejected'
  | 'expired';

export type EndorsementMethod = 'webauthn' | 'standard';

export interface RefereeSlot {
  email: string;
  name: string;
  /** sha256(rawToken). Raw token NEVER stored. */
  tokenHash: string;
  /** ISO timestamp when this referee co-signed, or null while pending. */
  signedAt: string | null;
  /** Base64 WebAuthn assertion (preferred) or short opaque ack string. */
  signature?: string;
  /** Which method the referee used. Stamped on accept. */
  method?: EndorsementMethod;
  /** Set if the referee actively declines. Reserved for post-MVP. */
  declined?: boolean;
}

export interface CurriculumClaim {
  id: string;
  workerId: string;
  workerEmail: string;
  claim: string;
  category: ClaimCategory;
  signedByWorker: {
    signedAt: string;
    webauthnCredentialId?: string;
    webauthnAssertion?: string;
    /** True when the worker's device had no authenticator and they ticked
     *  the "yo declaro" fallback. We log it for transparency. */
    fallbackAttest?: boolean;
    fallbackReason?: string;
  };
  referees: RefereeSlot[];
  status: ClaimStatus;
  createdAt: string;
  verifiedAt: string | null;
  expiresAt: string;
}

export interface ClaimCreatePayload {
  workerId: string;
  workerEmail: string;
  claim: string;
  category: ClaimCategory;
  signedByWorker: {
    webauthnCredentialId?: string;
    webauthnAssertion?: string;
    fallbackAttest?: boolean;
    fallbackReason?: string;
  };
  referees: Array<{ email: string; name: string }>;
}

/**
 * The slice of Firestore we actually call. `admin.firestore()` is
 * structurally compatible with this; the test fake implements the same
 * shape with an in-memory Map.
 */
export interface MinimalClaimsDb {
  collection(name: string): {
    add(data: any): Promise<{ id: string }>;
    doc(id: string): {
      get(): Promise<{ exists: boolean; id: string; data(): any }>;
      update(patch: any): Promise<void>;
    };
    where(field: string, op: '==', value: any): {
      get(): Promise<{
        empty: boolean;
        docs: Array<{ id: string; data(): any }>;
      }>;
    };
  };
}

/** Audit-log writer. server.ts injects a thin wrapper around the admin
 *  SDK + the same audit_logs schema used by /api/audit-log. */
export type AuditLogger = (
  action: string,
  details: Record<string, unknown>,
) => Promise<void>;

// --- Constants -----------------------------------------------------------

const COLLECTION = 'curriculum_claims';
const CLAIM_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_CLAIM_TEXT_LENGTH = 500;
// Plain RFC-5322-lite regex: good enough for client-side hint validation.
// We're not the ultimate authority — Resend will bounce truly invalid ones.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Validation helpers --------------------------------------------------

function validatePayload(p: ClaimCreatePayload): void {
  if (typeof p.workerId !== 'string' || p.workerId.length === 0) {
    throw new Error('workerId is required');
  }
  if (typeof p.workerEmail !== 'string' || !EMAIL_REGEX.test(p.workerEmail)) {
    throw new Error('workerEmail is invalid');
  }
  const text = (p.claim ?? '').trim();
  if (text.length === 0) throw new Error('claim text is required');
  if (text.length > MAX_CLAIM_TEXT_LENGTH) {
    throw new Error(`claim text exceeds ${MAX_CLAIM_TEXT_LENGTH} characters`);
  }
  if (!Array.isArray(p.referees) || p.referees.length !== 2) {
    throw new Error('exactly 2 referees are required');
  }
  for (const r of p.referees) {
    if (!r || typeof r.email !== 'string' || !EMAIL_REGEX.test(r.email)) {
      throw new Error(`referee email is invalid: ${r?.email ?? '(missing)'}`);
    }
    if (typeof r.name !== 'string' || r.name.trim().length === 0) {
      throw new Error('referee name is required');
    }
  }
  // Deduplicate: same email twice would let one human co-sign as both
  // referees — defeats the entire anti-fraud premise.
  if (p.referees[0].email.toLowerCase() === p.referees[1].email.toLowerCase()) {
    throw new Error('referees must have distinct email addresses');
  }
}

// --- createClaim ---------------------------------------------------------

/**
 * Create a fresh `pending_referees` claim. Returns the new doc id and the
 * 2 RAW referee tokens — these tokens MUST be embedded in the magic-link
 * emails sent immediately after this call (server.ts handles delivery).
 *
 * The raw tokens are never stored: only their sha256 hashes go into
 * `referees[*].tokenHash`. The caller (server.ts) is expected to discard
 * the raw values once the emails are dispatched.
 */
export async function createClaim(
  payload: ClaimCreatePayload,
  db: MinimalClaimsDb,
  audit: AuditLogger,
): Promise<{ id: string; refereeTokens: string[] }> {
  validatePayload(payload);

  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();

  const rawTokens: string[] = [generateRefereeToken(), generateRefereeToken()];

  const refereeSlots: RefereeSlot[] = payload.referees.map((r, i) => ({
    email: r.email,
    name: r.name,
    tokenHash: hashToken(rawTokens[i]),
    signedAt: null,
  }));

  const docBody: Omit<CurriculumClaim, 'id'> = {
    workerId: payload.workerId,
    workerEmail: payload.workerEmail,
    claim: payload.claim.trim(),
    category: payload.category,
    signedByWorker: {
      signedAt: createdAt,
      webauthnCredentialId: payload.signedByWorker.webauthnCredentialId,
      webauthnAssertion: payload.signedByWorker.webauthnAssertion,
      fallbackAttest: payload.signedByWorker.fallbackAttest === true,
      fallbackReason: payload.signedByWorker.fallbackReason,
    },
    referees: refereeSlots,
    status: 'pending_referees',
    createdAt,
    verifiedAt: null,
    expiresAt,
  };

  const ref = await db.collection(COLLECTION).add(docBody);

  await audit('curriculum.claim.created', {
    claimId: ref.id,
    workerId: payload.workerId,
    category: payload.category,
    refereeEmails: payload.referees.map((r) => r.email),
    fallbackAttest: docBody.signedByWorker.fallbackAttest,
  });

  return { id: ref.id, refereeTokens: rawTokens };
}

// --- recordRefereeEndorsement -------------------------------------------

/**
 * Co-signs the claim on behalf of one of the named referees.
 *
 * Lookup uses the sha256 of the inbound raw token; if no referee slot
 * matches we throw — with no leak of which claim/which slot was queried.
 *
 * After a successful write, if BOTH referees have non-null signedAt the
 * claim is promoted to 'verified' and `verifiedAt` is stamped. Audit
 * logs are emitted for both the endorsement and the eventual
 * verification flip.
 *
 * Throws on:
 *   • Unknown token (no slot match).
 *   • Claim already in a terminal state (verified/rejected/expired).
 *   • Claim past expiresAt at the time of the call.
 *   • Same referee co-signing twice.
 */
export async function recordRefereeEndorsement(
  claimId: string,
  rawToken: string,
  endorsement: { signature: string; method: EndorsementMethod },
  db: MinimalClaimsDb,
  audit: AuditLogger,
): Promise<{ verified: boolean }> {
  const docRef = db.collection(COLLECTION).doc(claimId);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error('token does not match any pending claim');
  const claim = snap.data() as CurriculumClaim;

  if (claim.status === 'verified' || claim.status === 'rejected') {
    throw new Error(`claim already ${claim.status}`);
  }

  // Lazy expiry: enforce on every accept attempt rather than running a
  // cron sweep. Cheap and good-enough for MVP volumes.
  if (new Date(claim.expiresAt).getTime() < Date.now()) {
    if (claim.status !== 'expired') {
      await docRef.update({ status: 'expired' });
    }
    throw new Error('claim has expired');
  }

  const inboundHash = hashToken(rawToken);
  const slotIndex = claim.referees.findIndex((r) => r.tokenHash === inboundHash);
  if (slotIndex === -1) throw new Error('token does not match any referee on this claim');

  const slot = claim.referees[slotIndex];
  if (slot.signedAt) {
    // Idempotency-safe rejection. We could no-op silently but throwing
    // surfaces the case to the caller (rate-limiting, double-click, or
    // a leaked-token replay) without exposing claim internals.
    throw new Error('referee already endorsed this claim');
  }

  const signedAt = new Date().toISOString();
  const updatedReferees = claim.referees.map((r, i) =>
    i === slotIndex
      ? { ...r, signedAt, signature: endorsement.signature, method: endorsement.method }
      : r,
  );

  const allSigned = updatedReferees.every((r) => r.signedAt !== null);
  const nextStatus: ClaimStatus = allSigned ? 'verified' : 'pending_referees';
  const verifiedAt = allSigned ? signedAt : null;

  await docRef.update({
    referees: updatedReferees,
    status: nextStatus,
    verifiedAt,
  });

  await audit('curriculum.referee.endorsed', {
    claimId,
    refereeEmail: slot.email,
    method: endorsement.method,
  });

  if (allSigned) {
    await audit('curriculum.claim.verified', {
      claimId,
      workerId: claim.workerId,
      verifiedAt,
    });
  }

  return { verified: allSigned };
}

// --- Read accessors ------------------------------------------------------

/**
 * Returns every claim for a given worker, regardless of status.
 * The caller (UI / API) is responsible for filtering by status if needed.
 */
export async function getClaimsByWorker(
  workerId: string,
  db: MinimalClaimsDb,
): Promise<CurriculumClaim[]> {
  const snap = await db.collection(COLLECTION).where('workerId', '==', workerId).get();
  if (snap.empty) return [];
  return snap.docs.map((d) => ({ ...(d.data() as CurriculumClaim), id: d.id }));
}

/**
 * Server-side lookup by claim id. Used by the magic-link landing page to
 * fetch a safe preview (worker name, claim text) BEFORE the referee
 * commits to co-signing.
 *
 * The caller passes the raw token; we hash it and reject if it doesn't
 * match any referee slot — preventing claim-id enumeration.
 */
export async function getClaimByToken(
  claimId: string,
  rawToken: string,
  db: MinimalClaimsDb,
): Promise<{ claim: CurriculumClaim; refereeIndex: number } | null> {
  const snap = await db.collection(COLLECTION).doc(claimId).get();
  if (!snap.exists) return null;
  const claim = snap.data() as CurriculumClaim;
  const inboundHash = hashToken(rawToken);
  const idx = claim.referees.findIndex((r) => r.tokenHash === inboundHash);
  if (idx === -1) return null;
  return { claim: { ...claim, id: snap.id }, refereeIndex: idx };
}
