// SPDX-License-Identifier: MIT
// PR #482 codex P1 — resolver project-member FCM tokens by role.
//
// Spun off from the inline lookup in `routes/emergency.ts:sendToProjectSupervisors`
// so cron jobs (lone-worker escalation, housekeeping) can resolve tokens
// without pulling the full SOS handler (and so they can chunk the multicast
// via `utils/fcmMulticast.sendMulticastChunked` instead of inheriting the
// unchunked send path).
//
// Returns BOTH tokens and emails: callers either fan out FCM directly or
// fall back to email when the push roster is empty.

import { logger } from '../../utils/logger.js';
import {
  ADMIN_ROLES,
  DOCTOR_ROLES,
  SUPERVISOR_ROLES,
} from '../../types/roles.js';

const USER_TOKEN_CACHE_TTL_MS = 5 * 60_000;
const userTokenCache = new Map<string, { tokens: string[]; expiresAt: number }>();

/** Test-only helper to drop the in-process token cache. */
export function __clearProjectTokenCache(): void {
  userTokenCache.clear();
}

/**
 * Read `users/{uid}.fcmTokens` (array) with a TTL cache.
 *
 * PR #482 codex P1 (round 3): cache SUCCESSFUL reads only — including
 * legitimate empty arrays (user exists but has no registered devices) and
 * missing-doc reads (user has never registered). Do NOT cache transient
 * read failures as `[]`: that turns a 1-second outage into a 5-minute
 * silent escalation hole where the per-project recipient set collapses
 * to empty across multiple cron runs.
 *
 * Returns `null` on read failure so the caller can distinguish "empty
 * roster" (legit) from "could not check" (must propagate as error).
 */
async function getUserTokensCached(
  uid: string,
  db: FirebaseFirestore.Firestore,
): Promise<string[] | null> {
  const now = Date.now();
  const hit = userTokenCache.get(uid);
  if (hit && hit.expiresAt > now) return hit.tokens;
  let tokens: string[];
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) {
      const raw = (snap.data() as { fcmTokens?: unknown })?.fcmTokens;
      tokens = Array.isArray(raw)
        ? raw.filter((t): t is string => typeof t === 'string' && t.length > 0)
        : [];
    } else {
      tokens = [];
    }
  } catch (err) {
    logger.warn?.('project_tokens.user_lookup_failed', { uid, err: String(err) });
    return null;
  }
  userTokenCache.set(uid, { tokens, expiresAt: now + USER_TOKEN_CACHE_TTL_MS });
  return tokens;
}

export interface ResolvedProjectTokens {
  /** Deduplicated FCM tokens for all members matching the role filter. */
  tokens: string[];
  /** Email addresses for the same set of members (for email fallback). */
  emails: string[];
  /** How many member docs were inspected. */
  memberCount: number;
  /** How many member docs matched the role filter. */
  matchedCount: number;
}

/**
 * Thrown when a Firestore read fails while resolving project tokens.
 * Callers in safety-critical paths (lone-worker escalation, legal-reminders)
 * MUST treat this as "could not verify recipients" and abort their
 * idempotency-marker write so the next cron run retries.
 *
 * PR #482 codex P1 (round 3) — before, the helper swallowed read errors
 * and returned `[]`, indistinguishable from "no recipients configured".
 */
export class ProjectTokenLookupError extends Error {
  readonly projectId: string;
  override readonly cause: unknown;
  constructor(projectId: string, cause: unknown) {
    super(`project_tokens lookup failed for project ${projectId}: ${String(cause)}`);
    this.name = 'ProjectTokenLookupError';
    this.projectId = projectId;
    this.cause = cause;
  }
}

/**
 * Resolve FCM tokens + emails for project members whose `role` is in `roles`.
 * Mirrors the cross-collection pattern used in `sendToProjectSupervisors`:
 *
 *   1. iterate `projects/{projectId}/members`
 *   2. for each member matching `roles`, union legacy `members/{uid}.fcmToken`
 *      (singular) with canonical `users/{uid}.fcmTokens[]` (array, TTL-cached)
 *
 * PR #482 codex P1 (round 3): throws `ProjectTokenLookupError` on Firestore
 * read failures (either the members listing or a per-member user-doc read).
 * Empty result is still valid and returned — it means "no members matched
 * the role filter and none of the matching members had registered tokens".
 * The caller distinguishes "0 tokens, lookup succeeded" (legit, but in
 * safety contexts should still trigger a warn + no-marker policy) from
 * "lookup failed" (transient outage, MUST retry next run).
 */
export async function resolveProjectMemberTokens(
  projectId: string,
  roles: ReadonlySet<string>,
  db: FirebaseFirestore.Firestore,
): Promise<ResolvedProjectTokens> {
  const tokenSet = new Set<string>();
  const emails: string[] = [];
  let memberCount = 0;
  let matchedCount = 0;

  let membersSnap: FirebaseFirestore.QuerySnapshot;
  try {
    membersSnap = await db.collection('projects').doc(projectId).collection('members').get();
  } catch (err) {
    logger.warn?.('project_tokens.members_read_failed', { projectId, err: String(err) });
    throw new ProjectTokenLookupError(projectId, err);
  }

  for (const memberDoc of membersSnap.docs) {
    memberCount += 1;
    const data = memberDoc.data() as {
      role?: string;
      fcmToken?: unknown;
      email?: unknown;
    };
    if (typeof data?.role !== 'string' || !roles.has(data.role)) continue;
    matchedCount += 1;

    if (typeof data.fcmToken === 'string' && data.fcmToken.length > 0) {
      tokenSet.add(data.fcmToken);
    }
    if (typeof data.email === 'string' && data.email.length > 0) {
      emails.push(data.email);
    }

    const memberUid = memberDoc.id;
    const userTokens = await getUserTokensCached(memberUid, db);
    if (userTokens === null) {
      // PR #482 codex P1 (round 3): per-user read failure must propagate.
      // Caller cannot tell from an empty token set whether the user has
      // no devices or whether Firestore was unreachable.
      throw new ProjectTokenLookupError(
        projectId,
        new Error(`user doc read failed for member ${memberUid}`),
      );
    }
    for (const tok of userTokens) tokenSet.add(tok);
  }

  return {
    tokens: Array.from(tokenSet),
    emails,
    memberCount,
    matchedCount,
  };
}

/**
 * Canonical supervisor + admin + doctor roles from `src/types/roles.ts`.
 * `medico_ocupacional` is intentionally included because firestore.rules
 * treats it as both supervisor and doctor (it's the worker-health lead
 * who must be paged when a lone worker is overdue).
 */
const SUPERVISOR_BUCKET: readonly string[] = [
  ...ADMIN_ROLES,
  ...SUPERVISOR_ROLES,
  ...DOCTOR_ROLES,
];

/**
 * Brigade roles. Not in `src/types/roles.ts` because brigade membership is
 * an orthogonal capability flag at the project-member level (a supervisor
 * can also be a brigade member). Listed explicitly here so the bucket fans
 * out to dedicated brigadistas in addition to the supervisor escalation set.
 */
const BRIGADE_ROLES: readonly string[] = ['brigade', 'brigadista', 'brigade_leader'];

/**
 * Emergency roles. Same caveat as brigade — capability flag, not in roles.ts.
 */
const EMERGENCY_ROLES: readonly string[] = ['emergency', 'emergency_services'];

/**
 * Role buckets used by the lone-worker escalation cron. Each escalation
 * level fans out to its own role bucket PLUS all higher-priority buckets
 * (monotonic escalation — safety-first: if "emergency" fires and no
 * member has the emergency role configured, supervisors and brigade still
 * receive the alert).
 *
 * Sourced from the canonical `SUPERVISOR_ROLES`/`ADMIN_ROLES`/`DOCTOR_ROLES`
 * declared in `src/types/roles.ts` (which firestore.rules also mirrors).
 * Do NOT hardcode role strings here — additions to the role registry must
 * propagate to escalation fanout automatically.
 */
export const LONE_WORKER_ROLE_BUCKETS = {
  supervisor: new Set<string>(SUPERVISOR_BUCKET),
  brigade: new Set<string>([...SUPERVISOR_BUCKET, ...BRIGADE_ROLES]),
  emergency_services: new Set<string>([
    ...SUPERVISOR_BUCKET,
    ...BRIGADE_ROLES,
    ...EMERGENCY_ROLES,
  ]),
} as const;

/**
 * Paginate every doc in the root `projects` collection in `pageSize`-sized
 * chunks via cursor pagination. Calls `onProject` once per doc; failures
 * inside the callback are isolated by the caller (the cron job catches per
 * project). Returns the total number of projects iterated.
 *
 * PR #482 codex P1 — the first iteration of the housekeeping endpoint used
 * `.limit(500)` without a cursor, so deployments with >500 projects would
 * silently skip the tail of the list (safety-critical for lone-worker
 * escalation; compliance-critical for legal calendar reminders).
 */
export async function iterateAllProjects(
  db: FirebaseFirestore.Firestore,
  pageSize: number,
  onProject: (projectDoc: FirebaseFirestore.QueryDocumentSnapshot) => Promise<void>,
): Promise<number> {
  if (pageSize <= 0) throw new Error('iterateAllProjects: pageSize must be > 0');
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let total = 0;

  // The cap is a defensive ceiling against unbounded enumeration in case
  // the collection has runaway docs. 100k projects ≫ any plausible tenant
  // count; if a deployment ever needs more, switch to streaming queries.
  const HARD_CAP = 100_000;

  while (total < HARD_CAP) {
    let q: FirebaseFirestore.Query = db.collection('projects').orderBy('__name__').limit(pageSize);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      await onProject(doc);
      total += 1;
    }
    if (snap.size < pageSize) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  if (total >= HARD_CAP) {
    logger.warn?.('project_tokens.iterate_hard_cap_hit', { totalProcessed: total, pageSize });
  }
  return total;
}
