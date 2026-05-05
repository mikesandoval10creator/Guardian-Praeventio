// Praeventio Guard — Sprint 28 Bucket B6.
//
// Atomic folio generator for SUSESO DIAT/DIEP forms.
//
// Format: `${kind}-${year}-${tenantSlug}-${seq:06d}`.
// Example: `DIAT-2026-praevent-000042`.
//
// The sequence is monotonic per (tenantId, year, kind) and lives at
// `tenants/{tid}/suseso_counters/{year}-{kind}` with `{ lastSeq: number }`.
//
// Race-safety: Firestore `runTransaction` retries on contention so two
// concurrent createSusesoForm calls produce two DIFFERENT folios — never
// a duplicate, and never a gap (the loser of a race retries with the
// new lastSeq value). The 5+ tests in folioGenerator.test.ts simulate
// exactly this with a stub Firestore that mimics retry-on-contention.
//
// We use a tiny abstraction (`MinimalFolioStore`) so unit tests don't
// need to spin up firebase-admin — we pass an in-memory implementation
// that exercises the same getThenSet semantics.

import type { SusesoFormKind } from './types.js';

/**
 * Minimal Firestore-shaped contract used by `nextFolio`.
 *
 * `runTransaction` MUST behave like firebase-admin's: the callback may
 * be invoked multiple times if `tx.update` collides; only the final
 * successful invocation's return value is observed.
 */
export interface MinimalFolioStore {
  runTransaction<T>(
    fn: (tx: MinimalTx) => Promise<T>,
  ): Promise<T>;
}

export interface MinimalTx {
  get(path: string): Promise<{ exists: boolean; data?: { lastSeq?: number } }>;
  set(path: string, data: { lastSeq: number }): void;
}

/**
 * Sanitize a tenantId into the 8-char slug used inside the folio.
 *
 * Rules: lowercase, strip non-alphanumeric, take first 8 chars, pad
 * with `0` if shorter (so the slug is ALWAYS exactly 8 chars and folios
 * line up in fixed-width audit listings).
 */
export function tenantSlug(tenantId: string): string {
  const cleaned = (tenantId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (cleaned + '00000000').slice(0, 8);
}

/**
 * Format a folio from its components. Exposed separately so tests can
 * round-trip parse → format without touching Firestore.
 */
export function formatFolio(
  kind: SusesoFormKind,
  year: number,
  tenantId: string,
  seq: number,
): string {
  const slug = tenantSlug(tenantId);
  const padded = String(seq).padStart(6, '0');
  return `${kind}-${year}-${slug}-${padded}`;
}

/**
 * Reverse of `formatFolio`. Returns `null` if the input doesn't match
 * the expected shape (unknown kind, non-numeric year/seq, etc.).
 */
export function parseFolio(folio: string): {
  kind: SusesoFormKind;
  year: number;
  tenantSlug: string;
  seq: number;
} | null {
  // Match: KIND-YYYY-SLUG-SSSSSS where slug is 8 alnum chars.
  const m = /^(DIAT|DIEP)-(\d{4})-([a-z0-9]{8})-(\d{6})$/.exec(folio);
  if (!m) return null;
  return {
    kind: m[1] as SusesoFormKind,
    year: Number(m[2]),
    tenantSlug: m[3],
    seq: Number(m[4]),
  };
}

/**
 * Allocate the next folio for a tenant/kind/year and persist the
 * incremented counter ATOMICALLY.
 *
 * Race semantics: two concurrent callers will each retry inside
 * `runTransaction` until they get clean reads; the result is two
 * DIFFERENT folios (no collision) with adjacent sequence numbers
 * (no gap). The Firestore SDK's transaction-retry loop guarantees
 * at-most-one writer commits per attempt.
 */
export async function nextFolio(
  store: MinimalFolioStore,
  tenantId: string,
  kind: SusesoFormKind,
  year: number = new Date().getUTCFullYear(),
): Promise<string> {
  const counterPath = `tenants/${tenantId}/suseso_counters/${year}-${kind}`;
  const seq = await store.runTransaction(async (tx) => {
    const snap = await tx.get(counterPath);
    const current = snap.exists && typeof snap.data?.lastSeq === 'number'
      ? snap.data.lastSeq
      : 0;
    const next = current + 1;
    tx.set(counterPath, { lastSeq: next });
    return next;
  });
  return formatFolio(kind, year, tenantId, seq);
}
