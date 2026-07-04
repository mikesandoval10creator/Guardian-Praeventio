// Praeventio Guard — role → custom-claim sync (M-1 enabler, F7 companion).
//
// WHY THIS EXISTS (audit 2026-07-02 §3.2 + honesty pass): the authoritative
// role lives in Firestore `users/{uid}.role`. firestore.rules copes via a
// users-doc `get()` fallback inside isAdmin()/isSupervisor(), but CLOUD
// STORAGE RULES CANNOT READ FIRESTORE — the `role` custom claim is the only
// role signal available there, and NO normal flow minted it:
//   • POST /api/admin/set-role requires the CALLER to already hold an admin
//     claim (chicken-and-egg on a fresh tenant) and no UI invokes it.
//   • userLifecycle/anonymizeUser only mint the lifecycle roles
//     ('inactive' / 'anonymized').
// Consequence: every Storage rule gated on isAdminOrSupervisorTier() was
// fail-closed-DEAD for everyone. This listener mirrors `users/{uid}.role`
// into the `role` custom claim so claim-gated rules become REAL.
//
// Design (mirrors backgroundTriggers.ts conventions — DI deps, onSnapshot
// via Admin SDK in our own Express process, serializeByKey per entity, no
// work at import time):
//   • Steady state costs ZERO Auth I/O: `users/{uid}.claimsSync.role` is a
//     mirror stamp; when it equals `role`, the change is skipped before any
//     getUser() call. (`claimsSync` is ONE map key — isValidUser() allows
//     up to 20 keys on client updates; a map costs a single key.)
//   • Boot = natural backfill: the initial snapshot delivers every user doc,
//     so drifted users converge on every deploy — idempotent across
//     replicas (same claim value; duplicate work is a no-op).
//   • LIFECYCLE LOCK: if the CURRENT claim role is 'inactive' or
//     'anonymized' (deactivateUser / anonymizeUser), the sync NEVER
//     overwrites it — the users doc may still carry the old functional
//     role, and re-minting it would resurrect a deactivated account.
//   • Claims are PRESERVED on write ({ ...existing, role }) — M-1 pattern
//     from admin.ts set-role: setCustomUserClaims overwrites wholesale, a
//     bare { role } would drop tenantId.
//   • DOWNGRADE revokes refresh tokens (verifyAuth checks revocation, so a
//     demoted elevated token dies on its next API call). Upgrades do NOT
//     revoke — the claim lands on natural token refresh (≤1h) without
//     logging the user out mid-shift.
//   • Every mint writes audit_logs (CLAUDE.md #3), awaited + guarded
//     (#14). Audit failure is severe-but-non-blocking: Sentry + continue.
//   • Bootstrap note: the FIRST admin of a tenant still needs one manual
//     promotion (users doc create rule only self-assigns worker roles);
//     after that, every role change flows through here automatically.

import type admin from 'firebase-admin';
import { ADMIN_ROLES, SUPERVISOR_ROLES, WORKER_ROLES, ALL_ROLES } from '../../types/roles.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { logger } from '../../utils/logger.js';
import { serializeByKey } from './backgroundTriggers.js';

// Lifecycle claim roles minted by userLifecycle.deactivateUser() and
// anonymizeUser(). Never overwritten by the sync (see header).
const LIFECYCLE_LOCKED_ROLES = new Set(['inactive', 'anonymized']);

/** Privilege rank for downgrade detection (higher = more privilege). */
function rank(role: unknown): number {
  if (typeof role !== 'string') return 0;
  if ((ADMIN_ROLES as readonly string[]).includes(role)) return 3;
  if ((SUPERVISOR_ROLES as readonly string[]).includes(role)) return 2;
  if ((WORKER_ROLES as readonly string[]).includes(role)) return 1;
  return 0;
}

export interface RoleClaimsSyncDeps {
  db: admin.firestore.Firestore;
  /** Firebase Admin Auth — only the three members the sync needs. */
  auth: Pick<
    admin.auth.Auth,
    'getUser' | 'setCustomUserClaims' | 'revokeRefreshTokens'
  >;
  /** Firestore admin namespace — for FieldValue.serverTimestamp(). */
  firestoreNamespace: typeof admin.firestore;
}

export interface RoleClaimsSyncHandle {
  unsubscribe: () => void;
}

function sentryCapture(err: unknown, tags: Record<string, string>): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      { trigger: 'roleClaimsSync', tags } as never,
    );
  } catch (e) {
    console.warn('[observability] capture failed', e);
  }
}

/** @internal exported for tests — one user's sync pass. */
export async function syncUserRoleClaim(
  deps: RoleClaimsSyncDeps,
  uid: string,
  data: Record<string, unknown>,
): Promise<void> {
  const docRole = data.role;
  if (typeof docRole !== 'string' || !ALL_ROLES.includes(docRole)) {
    // Not a role-bearing user doc (or garbage) — nothing to mirror.
    return;
  }

  // Steady-state short-circuit: mirror stamp already matches → zero Auth I/O.
  const mirror = data.claimsSync as { role?: unknown } | undefined;
  if (mirror && mirror.role === docRole) return;

  // Auth record — a roster-only worker may have no account: skip quietly.
  let userRecord: Awaited<ReturnType<RoleClaimsSyncDeps['auth']['getUser']>>;
  try {
    userRecord = await deps.auth.getUser(uid);
  } catch {
    logger.debug?.('role_claims_sync_no_auth_user', { uid });
    return;
  }

  const existing: Record<string, unknown> = { ...(userRecord.customClaims ?? {}) };
  const oldClaimRole = existing.role;

  // LIFECYCLE LOCK — never resurrect a deactivated/anonymized account.
  if (typeof oldClaimRole === 'string' && LIFECYCLE_LOCKED_ROLES.has(oldClaimRole)) {
    logger.warn('role_claims_sync_lifecycle_locked', { uid, claimRole: oldClaimRole });
    return;
  }

  const stampMirror = async () => {
    await deps.db.collection('users').doc(uid).set(
      {
        claimsSync: {
          role: docRole,
          at: deps.firestoreNamespace.FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
  };

  if (oldClaimRole === docRole) {
    // Claims already correct (e.g. minted via /api/admin/set-role) — just
    // record the mirror so the steady-state short-circuit kicks in.
    await stampMirror();
    return;
  }

  // Mint, PRESERVING existing claims (tenantId etc. — M-1, admin.ts:358).
  await deps.auth.setCustomUserClaims(uid, { ...existing, role: docRole });

  // Downgrade → the old, more-privileged token must die NOW (verifyAuth
  // runs verifyIdToken(token, true)). Upgrade → natural refresh, no logout.
  const revoked = rank(docRole) < rank(oldClaimRole);
  if (revoked) {
    await deps.auth.revokeRefreshTokens(uid);
  }

  // Audit trail (CLAUDE.md #3) — awaited + guarded (#14): a broken
  // compliance trail is severe but must not abort the sync (the mirror
  // stamp below prevents an audit-outage retry storm).
  try {
    await deps.db.collection('audit_logs').add({
      action: 'role_claim_sync',
      module: 'roleClaimsSync',
      details: {
        targetUid: uid,
        oldRole: typeof oldClaimRole === 'string' ? oldClaimRole : null,
        newRole: docRole,
        revoked,
      },
      userId: 'system:roleClaimsSync',
      userEmail: null,
      projectId: null,
      timestamp: deps.firestoreNamespace.FieldValue.serverTimestamp(),
      ip: null,
      userAgent: null,
    });
  } catch (err) {
    logger.error('role_claims_sync_audit_failed', {
      uid,
      message: err instanceof Error ? err.message : String(err),
    });
    sentryCapture(err, { phase: 'audit' });
  }

  await stampMirror();
  logger.info('role_claims_sync_minted', { uid, newRole: docRole, revoked });
}

/**
 * Subscribe the users-collection listener. Returns an unsubscribe handle
 * (wired into SIGTERM in server.ts). MUST NOT be called at import time.
 */
export function setupRoleClaimsSync(deps: RoleClaimsSyncDeps): RoleClaimsSyncHandle {
  const unsubscribe = deps.db.collection('users').onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added' && change.type !== 'modified') return;
        const uid = change.doc.id;
        const data = change.doc.data() as Record<string, unknown>;
        void serializeByKey(`roleClaims:${uid}`, async () => {
          try {
            await syncUserRoleClaim(deps, uid, data);
          } catch (err) {
            logger.error('role_claims_sync_failed', {
              uid,
              message: err instanceof Error ? err.message : String(err),
            });
            sentryCapture(err, { phase: 'sync' });
          }
        });
      });
    },
    (err) => {
      // Listener death must be VISIBLE — a silently-dead sync would slowly
      // rot every claim-gated rule back to fail-closed.
      logger.error('role_claims_sync_listener_error', {
        message: err instanceof Error ? err.message : String(err),
      });
      sentryCapture(err, { phase: 'listener' });
    },
  );
  logger.info('role_claims_sync_listening');
  return { unsubscribe };
}
