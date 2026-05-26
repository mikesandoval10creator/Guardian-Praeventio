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

const USER_TOKEN_CACHE_TTL_MS = 5 * 60_000;
const userTokenCache = new Map<string, { tokens: string[]; expiresAt: number }>();

/** Test-only helper to drop the in-process token cache. */
export function __clearProjectTokenCache(): void {
  userTokenCache.clear();
}

async function getUserTokensCached(
  uid: string,
  db: FirebaseFirestore.Firestore,
): Promise<string[]> {
  const now = Date.now();
  const hit = userTokenCache.get(uid);
  if (hit && hit.expiresAt > now) return hit.tokens;
  let tokens: string[] = [];
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) {
      const raw = (snap.data() as { fcmTokens?: unknown })?.fcmTokens;
      if (Array.isArray(raw)) {
        tokens = raw.filter((t): t is string => typeof t === 'string' && t.length > 0);
      }
    }
  } catch (err) {
    logger.warn?.('project_tokens.user_lookup_failed', { uid, err: String(err) });
    tokens = [];
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
 * Resolve FCM tokens + emails for project members whose `role` is in `roles`.
 * Mirrors the cross-collection pattern used in `sendToProjectSupervisors`:
 *
 *   1. iterate `projects/{projectId}/members`
 *   2. for each member matching `roles`, union legacy `members/{uid}.fcmToken`
 *      (singular) with canonical `users/{uid}.fcmTokens[]` (array, TTL-cached)
 *
 * Never throws — read failures degrade to empty arrays + a warn log.
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
    return { tokens: [], emails: [], memberCount: 0, matchedCount: 0 };
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
 * Role buckets used by the lone-worker escalation cron. Each escalation
 * level fans out to its own role bucket PLUS all higher-priority buckets
 * (monotonic escalation — safety-first: if "emergency" fires and no
 * member has the emergency role configured, supervisors and brigade still
 * receive the alert).
 */
export const LONE_WORKER_ROLE_BUCKETS = {
  supervisor: new Set(['supervisor', 'gerente', 'prevencionista', 'admin']),
  brigade: new Set([
    'supervisor',
    'gerente',
    'prevencionista',
    'admin',
    'brigade',
    'brigadista',
    'brigade_leader',
  ]),
  emergency_services: new Set([
    'supervisor',
    'gerente',
    'prevencionista',
    'admin',
    'brigade',
    'brigadista',
    'brigade_leader',
    'emergency',
    'emergency_services',
  ]),
} as const;
