// SPDX-License-Identifier: MIT
//
// Sprint 35 — Distributed lease for in-process cron jobs.
//
// Audit P1 (`docs/audits/AUDIT_2026-05-05_FULL.md` §1.3): `setInterval`
// loops baked into the Cloud Run process (env polling every 10 min,
// project safety health checks every 6 h) fire on EVERY replica. Without
// a coordination primitive each replica runs the tick independently,
// burning Firestore quota and producing duplicated work.
//
// This module provides a Firestore-backed lease so only ONE replica
// executes a given tick. Pattern:
//
//   1. Tick fires on replica R.
//   2. R calls `acquireLease(jobName, ttlMs, instanceId)`.
//   3. Firestore transaction reads `system/leases/{jobName}` and writes
//      a new owner iff (a) no doc exists, (b) lease has expired, or
//      (c) the caller already owns it.
//   4. Only one replica can win the transaction; the rest get
//      `{ acquired: false }` and skip the tick.
//
// Failure mode: any Firestore error → `{ acquired: false }` + Sentry
// capture. The cron callsite logs and skips the tick (see server.ts) —
// it MUST NOT crash the process; the next interval re-attempts.
//
// Renew/release are provided for long-running ticks that want to
// extend their hold (renew before expiry) or release early (clean up
// for the next tick instead of waiting for TTL to expire).

import type { Firestore } from 'firebase-admin/firestore';
import { getErrorTracker } from '../observability/index.js';

export interface AcquireResult {
  acquired: boolean;
  /** Random nonce identifying this lease grant — pass back to renew/release. */
  leaseId?: string;
  /** Wall-clock expiry (ms since epoch). */
  expiresAt?: number;
  /** Reason the acquire failed (for log/metric). */
  reason?: 'held_by_other' | 'transaction_error' | 'invalid_input';
}

export interface RenewResult {
  renewed: boolean;
  expiresAt?: number;
  reason?: 'not_owner' | 'expired' | 'transaction_error' | 'invalid_input';
}

export interface ReleaseResult {
  released: boolean;
  reason?: 'not_owner' | 'transaction_error' | 'invalid_input';
}

interface LeaseDoc {
  ownerInstance: string;
  leaseId: string;
  expiresAt: number;
  version: number;
  acquiredAt: number;
}

export interface LeaseDeps {
  /** Firestore handle. Defaults to `firebase-admin`'s default app. */
  getDb?: () => Firestore;
  /** Override of "now" — tests pin time. Default `Date.now`. */
  now?: () => number;
  /** Random nonce generator. Default `Math.random().toString(36)…`. */
  nonce?: () => string;
}

const COLLECTION = 'system';
const SUBCOLLECTION = 'leases';

function defaultNonce(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

async function getDefaultDb(): Promise<Firestore> {
  const admin = (await import('firebase-admin')).default;
  return admin.firestore();
}

function leaseRef(db: Firestore, jobName: string) {
  return db.collection(COLLECTION).doc(SUBCOLLECTION).collection('jobs').doc(jobName);
}

function captureError(err: unknown, op: string, jobName: string): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      { trigger: 'distributedLease', tags: { op, jobName } } as any,
    );
  } catch {
    /* swallow — observability MUST NOT crash the cron */
  }
}

/**
 * Try to acquire the lease for `jobName`. Returns `{ acquired: true,
 * leaseId, expiresAt }` on success; `{ acquired: false, reason }`
 * otherwise. Never throws.
 */
export async function acquireLease(
  jobName: string,
  ttlMs: number,
  instanceId: string,
  deps: LeaseDeps = {},
): Promise<AcquireResult> {
  if (!jobName || !instanceId || ttlMs <= 0) {
    return { acquired: false, reason: 'invalid_input' };
  }
  const now = (deps.now ?? Date.now)();
  const nonce = (deps.nonce ?? defaultNonce)();
  const newDoc: LeaseDoc = {
    ownerInstance: instanceId,
    leaseId: nonce,
    expiresAt: now + ttlMs,
    version: 1,
    acquiredAt: now,
  };
  try {
    const db = deps.getDb ? deps.getDb() : await getDefaultDb();
    const ref = leaseRef(db, jobName);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? (snap.data() as LeaseDoc) : null;
      if (existing && existing.expiresAt > now && existing.ownerInstance !== instanceId) {
        return { ok: false as const };
      }
      const next: LeaseDoc = {
        ...newDoc,
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
      leaseId: result.doc.leaseId,
      expiresAt: result.doc.expiresAt,
    };
  } catch (err) {
    captureError(err, 'acquire', jobName);
    return { acquired: false, reason: 'transaction_error' };
  }
}

/**
 * Extend a lease that the caller already owns. No-op if the lease is
 * held by someone else or has expired; returns `{ renewed: false }`.
 */
export async function renewLease(
  jobName: string,
  leaseId: string,
  newTtlMs: number,
  deps: LeaseDeps = {},
): Promise<RenewResult> {
  if (!jobName || !leaseId || newTtlMs <= 0) {
    return { renewed: false, reason: 'invalid_input' };
  }
  const now = (deps.now ?? Date.now)();
  try {
    const db = deps.getDb ? deps.getDb() : await getDefaultDb();
    const ref = leaseRef(db, jobName);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false as const, reason: 'not_owner' as const };
      const existing = snap.data() as LeaseDoc;
      if (existing.leaseId !== leaseId) {
        return { ok: false as const, reason: 'not_owner' as const };
      }
      if (existing.expiresAt <= now) {
        return { ok: false as const, reason: 'expired' as const };
      }
      const next: LeaseDoc = {
        ...existing,
        expiresAt: now + newTtlMs,
        version: existing.version + 1,
      };
      tx.set(ref, next);
      return { ok: true as const, doc: next };
    });
    if (!result.ok) return { renewed: false, reason: result.reason };
    return { renewed: true, expiresAt: result.doc.expiresAt };
  } catch (err) {
    captureError(err, 'renew', jobName);
    return { renewed: false, reason: 'transaction_error' };
  }
}

/**
 * Release a lease the caller owns. No-op if not the owner.
 */
export async function releaseLease(
  jobName: string,
  leaseId: string,
  deps: LeaseDeps = {},
): Promise<ReleaseResult> {
  if (!jobName || !leaseId) {
    return { released: false, reason: 'invalid_input' };
  }
  try {
    const db = deps.getDb ? deps.getDb() : await getDefaultDb();
    const ref = leaseRef(db, jobName);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false as const };
      const existing = snap.data() as LeaseDoc;
      if (existing.leaseId !== leaseId) return { ok: false as const };
      tx.delete(ref);
      return { ok: true as const };
    });
    if (!result.ok) return { released: false, reason: 'not_owner' };
    return { released: true };
  } catch (err) {
    captureError(err, 'release', jobName);
    return { released: false, reason: 'transaction_error' };
  }
}

/**
 * Convenience helper for cron callsites: acquire → run fn → release.
 * If acquire fails, `fn` is NOT invoked and the helper returns
 * `{ ran: false }`. Errors inside `fn` are propagated AFTER the lease
 * is released so the next tick can acquire fresh.
 */
export async function withLease<T>(
  jobName: string,
  ttlMs: number,
  instanceId: string,
  fn: () => Promise<T>,
  deps: LeaseDeps = {},
): Promise<{ ran: boolean; result?: T; reason?: AcquireResult['reason'] }> {
  const acq = await acquireLease(jobName, ttlMs, instanceId, deps);
  if (!acq.acquired) return { ran: false, reason: acq.reason };
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    if (acq.leaseId) {
      await releaseLease(jobName, acq.leaseId, deps);
    }
  }
}
