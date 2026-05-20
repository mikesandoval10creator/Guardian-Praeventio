// SPDX-License-Identifier: MIT
//
// Bloque 5.4 (C14) — SyncManager distributed lock, Firestore-backed.
//
// Why this exists:
//   ADR 0019 codifica Firestore como persistencia canónica. Cloud Run
//   escala horizontalmente: dos o más réplicas pueden disparar la
//   misma operación de sync sobre el mismo recurso (proyecto / tenant /
//   job) simultáneamente. Un lock in-memory por proceso (como el
//   `isFlushing` boolean del cliente o el coalescer per-proceso de
//   `oauthTokenStore`) NO sirve cross-instance.
//
//   Este módulo provee un lock distribuido respaldado por Firestore
//   transaccional. Distinto del `distributedLease` global
//   (`system/leases/jobs/{jobName}`, usado para cron singleton),
//   este lock está pensado para coordinar operaciones de sync
//   **per-tenant + per-recurso**:
//
//     tenants/{tenantId}/sync_locks/{resourceKey}
//
//   El uso típico es:
//
//     await withDistributedLock(db, 'tenant-A', 'sync:project-42', 30_000,
//       async () => {
//         // Sólo UNA réplica del cluster ejecuta este bloque a la vez
//         // para (tenant-A, sync:project-42). Las demás obtienen
//         // `{ acquired: false }` y skip.
//         await replicateProjectArtifacts(...);
//       },
//     );
//
// Por qué Firestore (y no Redis / Memorystore):
//   ADR 0016 difiere Redis hasta P95 lat trigger. ADR 0019 establece
//   Firestore como persistencia canónica del stack Google. Firestore
//   `runTransaction` da read-modify-write atómico distribuido —
//   exactamente lo que un lock necesita — sin añadir un servicio nuevo.
//
// Por qué un módulo NUEVO y no reusar `distributedLease`:
//   - `distributedLease` opera sobre `system/leases/jobs/{jobName}` →
//     un único job global por cluster (envPolling, projectHealth, etc.).
//   - `distributedLock` opera sobre `tenants/{tid}/sync_locks/{res}` →
//     N tenants × M recursos, scoped por tenant. La cardinalidad y la
//     forma del path son distintas; mezclarlos en una abstracción única
//     ocultaría la intención del callsite.
//   - Compartimos la semántica (acquire/renew/release + steal-on-expiry
//     + TX-safe) pero la firma del API ajusta a `resourceKey` per-tenant
//     en vez de `jobName` global, que es lo que el plan C14 pide.
//
// Failure semantics:
//   - Cualquier error de Firestore en `acquireDistributedLock` →
//     `{ acquired: false, reason: 'transaction_error' }`. El callsite
//     decide si reintenta o skip — el lock no decide por él.
//   - Errores en `releaseDistributedLock` se loggean pero NO se
//     re-lanzan. Un release fallido sólo significa que el TTL expirará
//     el lock; no es correctness bug.
//   - `withDistributedLock` SIEMPRE intenta release en `finally`, aún
//     si `fn` throws (la excepción se re-lanza al caller).

import type { Firestore } from 'firebase-admin/firestore';
import * as crypto from 'node:crypto';
import { getErrorTracker } from '../../services/observability/index.js';

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface AcquireDistributedLockResult {
  acquired: boolean;
  /** Identifier of the instance that holds the lock — pass back to release. */
  instanceId?: string;
  /** Random nonce per grant. Required by `releaseDistributedLock`. */
  lockId?: string;
  /** Wall-clock expiry (ms since epoch). */
  expiresAt?: number;
  /** Reason the acquire failed (for log / metric). */
  reason?: 'held_by_other' | 'transaction_error' | 'invalid_input';
}

export interface ReleaseDistributedLockResult {
  released: boolean;
  reason?: 'not_owner' | 'transaction_error' | 'invalid_input';
}

interface LockDoc {
  /** Process / Cloud Run revision id that owns the lock. */
  heldBy: string;
  /** Random nonce identifying THIS particular grant. */
  lockId: string;
  /** Epoch ms when acquired. */
  acquiredAt: number;
  /** Epoch ms when the lock can be stolen by another instance. */
  expiresAt: number;
  /** Monotonically increasing — bumped on every (re)acquire. */
  version: number;
}

export interface DistributedLockDeps {
  /** Override of "now" — tests pin time. Default `Date.now`. */
  now?: () => number;
  /** Random nonce generator. Default crypto.randomUUID(). */
  nonce?: () => string;
  /** Instance id override. Default uses K_REVISION / HOSTNAME / pid. */
  instanceId?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

const LOCKS_SUBCOLLECTION = 'sync_locks';
const TENANTS_COLLECTION = 'tenants';

/**
 * Stable identifier of THIS process / Cloud Run revision. Matches the
 * pattern used in `server.ts` so logs across modules correlate easily.
 *
 * Cached per-process. Tests can override via `deps.instanceId`.
 */
let cachedInstanceId: string | null = null;
function defaultInstanceId(): string {
  if (cachedInstanceId !== null) return cachedInstanceId;
  cachedInstanceId =
    process.env.K_REVISION ||
    process.env.HOSTNAME ||
    `pid-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  return cachedInstanceId;
}

function defaultNonce(): string {
  return crypto.randomUUID();
}

function lockRef(db: Firestore, tenantId: string, resourceKey: string) {
  return db
    .collection(TENANTS_COLLECTION)
    .doc(tenantId)
    .collection(LOCKS_SUBCOLLECTION)
    .doc(resourceKey);
}

function captureError(err: unknown, op: string, tenantId: string, resourceKey: string): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
       
      { trigger: 'distributedLock', tags: { op, tenantId, resourceKey } } as any,
    );
  } catch {
    /* swallow — observability MUST NOT crash the sync path */
  }
}

function isValidInput(tenantId: string, resourceKey: string, ttlMs: number): boolean {
  return (
    typeof tenantId === 'string' &&
    tenantId.length > 0 &&
    typeof resourceKey === 'string' &&
    resourceKey.length > 0 &&
    typeof ttlMs === 'number' &&
    Number.isFinite(ttlMs) &&
    ttlMs > 0
  );
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Try to acquire the distributed lock for `(tenantId, resourceKey)`.
 *
 * Returns `{ acquired: true, instanceId, lockId, expiresAt }` on
 * success, `{ acquired: false, reason }` otherwise. Never throws —
 * Firestore errors are caught and surfaced via `reason`.
 *
 * Steal-on-expiry: if a previous lock's `expiresAt` is in the past,
 * the caller wins (no risk of stuck-forever locks if a holder
 * crashes mid-operation).
 *
 * Re-entrancy: the same caller (matching `heldBy === instanceId`) can
 * re-acquire its own lock to refresh TTL. This avoids deadlocks when
 * a slow operation needs to extend its hold.
 */
export async function acquireDistributedLock(
  db: Firestore,
  tenantId: string,
  resourceKey: string,
  ttlMs: number,
  deps: DistributedLockDeps = {},
): Promise<AcquireDistributedLockResult> {
  if (!isValidInput(tenantId, resourceKey, ttlMs)) {
    return { acquired: false, reason: 'invalid_input' };
  }
  const now = (deps.now ?? Date.now)();
  const instanceId = deps.instanceId ?? defaultInstanceId();
  const lockId = (deps.nonce ?? defaultNonce)();

  try {
    const ref = lockRef(db, tenantId, resourceKey);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? (snap.data() as LockDoc) : null;

      // Steal-on-expiry: an unexpired lock held by someone else blocks us.
      if (
        existing &&
        existing.expiresAt > now &&
        existing.heldBy !== instanceId
      ) {
        return { ok: false as const };
      }

      const next: LockDoc = {
        heldBy: instanceId,
        lockId,
        acquiredAt: now,
        expiresAt: now + ttlMs,
        version: existing ? existing.version + 1 : 1,
      };
      tx.set(ref, next);
      return { ok: true as const, doc: next };
    });

    if (!result.ok) {
      return { acquired: false, reason: 'held_by_other' };
    }
    return {
      acquired: true,
      instanceId: result.doc.heldBy,
      lockId: result.doc.lockId,
      expiresAt: result.doc.expiresAt,
    };
  } catch (err) {
    captureError(err, 'acquire', tenantId, resourceKey);
    return { acquired: false, reason: 'transaction_error' };
  }
}

/**
 * Release a lock the caller owns. The `instanceId` AND `lockId` must
 * BOTH match the stored values — `instanceId` alone is insufficient
 * because the same Cloud Run revision may have legitimately
 * re-acquired (with a new `lockId`) after a previous release race.
 *
 * No-op if:
 *   - the lock doc doesn't exist,
 *   - `heldBy` mismatches (someone else owns it now), or
 *   - `lockId` mismatches (the original grant was superseded).
 *
 * Never throws. A failed release leaves the TTL to expire naturally.
 */
export async function releaseDistributedLock(
  db: Firestore,
  tenantId: string,
  resourceKey: string,
  instanceId: string,
  lockId: string,
): Promise<ReleaseDistributedLockResult> {
  if (
    typeof tenantId !== 'string' ||
    !tenantId ||
    typeof resourceKey !== 'string' ||
    !resourceKey ||
    typeof instanceId !== 'string' ||
    !instanceId ||
    typeof lockId !== 'string' ||
    !lockId
  ) {
    return { released: false, reason: 'invalid_input' };
  }

  try {
    const ref = lockRef(db, tenantId, resourceKey);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false as const };
      const existing = snap.data() as LockDoc;
      if (existing.heldBy !== instanceId || existing.lockId !== lockId) {
        return { ok: false as const };
      }
      tx.delete(ref);
      return { ok: true as const };
    });

    if (!result.ok) return { released: false, reason: 'not_owner' };
    return { released: true };
  } catch (err) {
    captureError(err, 'release', tenantId, resourceKey);
    return { released: false, reason: 'transaction_error' };
  }
}

/**
 * Convenience helper: acquire → run `fn` → release.
 *
 * - If acquire FAILS, `fn` is NOT invoked and the helper returns
 *   `{ ran: false, reason }`.
 * - If acquire SUCCEEDS, `fn` runs. Errors inside `fn` are re-thrown
 *   AFTER the lock is released so the next caller can proceed.
 * - The release in `finally` is best-effort — a failed release is
 *   logged but never causes `withDistributedLock` itself to throw
 *   (otherwise a transient Firestore hiccup at release time would
 *   mask the success of `fn`).
 */
export async function withDistributedLock<T>(
  db: Firestore,
  tenantId: string,
  resourceKey: string,
  ttlMs: number,
  fn: (lock: { instanceId: string; lockId: string; expiresAt: number }) => Promise<T>,
  deps: DistributedLockDeps = {},
): Promise<
  | { ran: true; result: T }
  | { ran: false; reason: AcquireDistributedLockResult['reason'] }
> {
  const acq = await acquireDistributedLock(db, tenantId, resourceKey, ttlMs, deps);
  if (!acq.acquired) {
    return { ran: false, reason: acq.reason };
  }
  // `acquired === true` guarantees instanceId / lockId / expiresAt are set
  // (see the `result.doc.*` projection in acquireDistributedLock). The
  // non-null assertions below are safe BECAUSE of that invariant.
  const grant = {
    instanceId: acq.instanceId!,
    lockId: acq.lockId!,
    expiresAt: acq.expiresAt!,
  };

  try {
    const result = await fn(grant);
    return { ran: true, result };
  } finally {
    // Best-effort release. If this throws (network blip, transient
    // Firestore unavailability), we still want `fn`'s result (or its
    // thrown error) to propagate to the caller — so we swallow here
    // and let the TTL recycle the lock.
    try {
      await releaseDistributedLock(
        db,
        tenantId,
        resourceKey,
        grant.instanceId,
        grant.lockId,
      );
    } catch (err) {
      captureError(err, 'release_in_finally', tenantId, resourceKey);
    }
  }
}
