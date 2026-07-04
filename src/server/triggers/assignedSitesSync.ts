// Praeventio Guard — project membership → `assignedSiteIds` custom-claim sync
// (M-1 Fase 4, cierre total de storage). Sibling of roleClaimsSync.ts.
//
// WHY THIS EXISTS (tenant-isolation audit 2026-07-04): CLOUD STORAGE RULES
// CANNOT READ FIRESTORE, so `storage.rules memberOfSite()` can only consult the
// verified token's custom claims. The intended claim, `assignedSiteIds` (the
// list of project ids a user belongs to), had a fully-built + tested helper
// (`buildClaimsWithAssignedSites`, src/services/auth/customClaims.ts) that NO
// flow ever called — an ORPHAN. So no token ever carried the claim, the old
// `memberOfSite()` escape hatch (`claim absent → allow`) was ALWAYS true, and
// every authenticated user could read/list/write EVERY project's files
// (cross-tenant leak of medical PDFs, SUSESO, blueprints). storage.rules is now
// FAIL-CLOSED; this listener mirrors `projects/{pid}.members` (+ `createdBy`)
// into each member's `assignedSiteIds` claim so the tightened rule becomes REAL
// without breaking legitimate uploads.
//
// Design (mirrors roleClaimsSync.ts conventions — DI deps, onSnapshot via the
// Admin SDK in our own Express process, serializeByKey per user, no work at
// import time):
//   • Authoritative recompute: a user's claim = every project whose in-memory
//     membership set contains them. Correct regardless of which project changed
//     (covers adds AND removes — the removed member is in the OLD member set,
//     so they get recomputed to a list that no longer includes the project).
//   • In-memory index `siteMembers: Map<pid, Set<uid>>` is the single source of
//     truth for the recompute. It is rebuilt from scratch on boot because the
//     initial onSnapshot delivers EVERY project doc → natural backfill, no
//     separate script (same property roleClaimsSync relies on). Lost on
//     restart, self-heals on the next boot snapshot (idempotent: same claim →
//     no-op).
//   • Steady state costs ZERO Auth I/O: if the recomputed sorted list equals
//     the claim already on the user record, the change is skipped before any
//     setCustomUserClaims call.
//   • Claims are PRESERVED on write (buildClaimsWithAssignedSites spreads
//     existingClaims) — a bare { assignedSiteIds } would drop role/tenantId.
//   • REMOVAL revokes refresh tokens: if a project was removed from the user's
//     list, their still-valid token would keep storage access to that site
//     until natural refresh. revokeRefreshTokens forces the next API call /
//     token refresh to re-mint without the site. Pure additions do NOT revoke
//     (the claim lands on natural refresh, ≤1h, no mid-shift logout).
//   • Every mint writes audit_logs (CLAUDE.md #3), awaited + guarded (#14).
//   • Token-refresh latency: a just-added member's EXISTING token lacks the new
//     site until it refreshes. The client forces getIdToken(true) after
//     create/join so uploads work immediately (ProjectContext).

import type admin from 'firebase-admin';
import {
  buildClaimsWithAssignedSites,
  readAssignedSites,
  MAX_ASSIGNED_SITES,
} from '../../services/auth/customClaims.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { logger } from '../../utils/logger.js';
import { serializeByKey } from './backgroundTriggers.js';

export interface AssignedSitesSyncDeps {
  db: admin.firestore.Firestore;
  auth: Pick<
    admin.auth.Auth,
    'getUser' | 'setCustomUserClaims' | 'revokeRefreshTokens'
  >;
  firestoreNamespace: typeof admin.firestore;
}

export interface AssignedSitesSyncHandle {
  unsubscribe: () => void;
}

function sentryCapture(err: unknown, tags: Record<string, string>): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      { trigger: 'assignedSitesSync', tags } as never,
    );
  } catch (e) {
    console.warn('[observability] capture failed', e);
  }
}

/**
 * The set of member uids a project doc grants site access to: everyone in
 * `members[]` plus `createdBy` (the creator may not be listed in members[] on
 * freshly-created projects — firestore.rules checks both separately).
 */
export function membersOf(data: Record<string, unknown> | undefined): Set<string> {
  const out = new Set<string>();
  if (!data) return out;
  const members = data.members;
  if (Array.isArray(members)) {
    for (const m of members) if (typeof m === 'string' && m.length > 0) out.add(m);
  }
  const createdBy = data.createdBy;
  if (typeof createdBy === 'string' && createdBy.length > 0) out.add(createdBy);
  return out;
}

/** Deterministic (sorted, deduped) list of the projects a uid belongs to. */
function sitesForUser(uid: string, siteMembers: Map<string, Set<string>>): string[] {
  const sites: string[] = [];
  for (const [pid, members] of siteMembers) {
    if (members.has(uid)) sites.push(pid);
  }
  return Array.from(new Set(sites)).sort();
}

function sameList(a: readonly string[] | null, b: readonly string[]): boolean {
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * @internal exported for tests — recompute + mint one user's assignedSiteIds
 * claim from the in-memory membership index.
 */
export async function syncUserAssignedSites(
  deps: AssignedSitesSyncDeps,
  uid: string,
  siteMembers: Map<string, Set<string>>,
): Promise<void> {
  const sites = sitesForUser(uid, siteMembers);

  // Auth record — a roster-only worker may have no account yet: skip quietly.
  let userRecord: Awaited<ReturnType<AssignedSitesSyncDeps['auth']['getUser']>>;
  try {
    userRecord = await deps.auth.getUser(uid);
  } catch {
    logger.debug?.('assigned_sites_sync_no_auth_user', { uid });
    return;
  }

  const existing: Record<string, unknown> = { ...(userRecord.customClaims ?? {}) };
  const current = readAssignedSites(existing); // string[] | null

  // Steady-state short-circuit — claim already correct → zero further I/O.
  const currentSorted = current ? Array.from(new Set(current)).sort() : null;
  if (sameList(currentSorted, sites)) return;

  if (sites.length > MAX_ASSIGNED_SITES) {
    // buildClaimsWithAssignedSites would throw; fail LOUD but non-fatal so one
    // over-scaled user can't wedge the whole listener. Needs Firestore-backed
    // scoping (see customClaims.ts note) — surface it.
    logger.error('assigned_sites_sync_over_cap', { uid, count: sites.length });
    sentryCapture(new Error(`assignedSiteIds over cap: ${sites.length}`), { phase: 'cap' });
    return;
  }

  const nextClaims = buildClaimsWithAssignedSites({
    existingClaims: existing,
    newAssignedSites: sites,
  });

  await deps.auth.setCustomUserClaims(uid, nextClaims);

  // Removal (a site the user HAD is no longer present) → the stale token still
  // grants that site's storage until refresh; revoke so it dies now. Pure
  // additions do not revoke (natural refresh, no mid-shift logout).
  const removed = current ? current.some((pid) => !sites.includes(pid)) : false;
  if (removed) {
    await deps.auth.revokeRefreshTokens(uid);
  }

  try {
    await deps.db.collection('audit_logs').add({
      action: 'assigned_sites_claim_sync',
      module: 'assignedSitesSync',
      details: {
        targetUid: uid,
        oldSites: current ?? null,
        newSites: sites,
        removed,
      },
      userId: 'system:assignedSitesSync',
      userEmail: null,
      projectId: null,
      timestamp: deps.firestoreNamespace.FieldValue.serverTimestamp(),
      ip: null,
      userAgent: null,
    });
  } catch (err) {
    logger.error('assigned_sites_sync_audit_failed', {
      uid,
      message: err instanceof Error ? err.message : String(err),
    });
    sentryCapture(err, { phase: 'audit' });
  }

  logger.info('assigned_sites_sync_minted', { uid, count: sites.length, removed });
}

/**
 * Subscribe the projects-collection listener. Returns an unsubscribe handle
 * (wired into SIGTERM in server.ts). MUST NOT be called at import time.
 */
export function setupAssignedSitesSync(
  deps: AssignedSitesSyncDeps,
): AssignedSitesSyncHandle {
  // Single source of truth for the recompute; rebuilt from the boot snapshot.
  const siteMembers = new Map<string, Set<string>>();

  const unsubscribe = deps.db.collection('projects').onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const pid = change.doc.id;
        const before = siteMembers.get(pid) ?? new Set<string>();
        const after =
          change.type === 'removed'
            ? new Set<string>()
            : membersOf(change.doc.data() as Record<string, unknown>);

        // Update the index synchronously BEFORE scheduling async mints so the
        // recompute reads the latest membership.
        if (change.type === 'removed') siteMembers.delete(pid);
        else siteMembers.set(pid, after);

        // Everyone who gained OR lost access to this project must be recomputed.
        const affected = new Set<string>([...before, ...after]);
        for (const uid of affected) {
          void serializeByKey(`assignedSites:${uid}`, async () => {
            try {
              await syncUserAssignedSites(deps, uid, siteMembers);
            } catch (err) {
              logger.error('assigned_sites_sync_failed', {
                uid,
                message: err instanceof Error ? err.message : String(err),
              });
              sentryCapture(err, { phase: 'sync' });
            }
          });
        }
      });
    },
    (err) => {
      // Listener death must be VISIBLE — a silently-dead sync would slowly rot
      // every storage claim back to fail-closed (uploads break app-wide).
      logger.error('assigned_sites_sync_listener_error', {
        message: err instanceof Error ? err.message : String(err),
      });
      sentryCapture(err, { phase: 'listener' });
    },
  );
  logger.info('assigned_sites_sync_listening');
  return { unsubscribe };
}
