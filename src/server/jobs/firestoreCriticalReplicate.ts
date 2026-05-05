// SPDX-License-Identifier: MIT
//
// Bucket W.5 — Hourly write-through replica for critical Firestore data.
//
// Why this exists:
//   The DR_RUNBOOK commits to RPO=0 for `billing.invoices` and RPO≤24h
//   for `audit_logs`. Daily Firestore exports leave a 24h hole that we
//   cannot accept for invoices (regulatory) and would prefer to halve
//   for audit logs. This job runs hourly, reads the documents written
//   to those collections in the last hour, and ships them as JSONL to
//   a separate Cloud Storage bucket. Combined with the daily managed
//   export, that gives us:
//     • Daily snapshot for full restore (gcloud firestore import)
//     • Hourly JSONL of the two collections that cannot tolerate a
//       24h gap, for forensic replay.
//
// Why JSONL (not Avro / Parquet):
//   • Trivially readable from the runbook's existing scripts.
//   • Append-only by construction (one file per (collection, hour)).
//   • No schema lock-in — the source of truth is still Firestore.
//
// Idempotency:
//   The filename is `<collection>/<YYYY-MM-DDTHH>.jsonl`, so a re-run
//   for the same hour overwrites the previous file with the SAME
//   contents (the `where('createdAt', '>=', oneHourAgo)` window is
//   deterministic given a fixed `now`). Re-runs are safe; the job is
//   designed to be re-driven manually via the admin endpoint.
//
// Dependency injection:
//   The Firestore handle and the Storage uploader are both injected so
//   tests can run without touching real GCS or firebase-admin. The
//   default factory uses firebase-admin's `admin.storage().bucket(...)`,
//   which transitively pulls @google-cloud/storage (already a
//   sub-dependency of firebase-admin); we do NOT add a new top-level
//   dependency. See the test file for the mocked surface contract.

import type { Firestore } from 'firebase-admin/firestore';

const ONE_HOUR_MS = 3_600_000;
const DEFAULT_BUCKET = 'praeventio-critical-replica';

/** Collections eligible for the hourly write-through. Order is stable. */
export const CRITICAL_COLLECTIONS = ['audit_logs', 'invoices'] as const;
export type CriticalCollection = (typeof CRITICAL_COLLECTIONS)[number];

/**
 * Storage uploader contract. Implementations MUST be idempotent: the
 * same `(bucket, path, contents)` call repeated yields the same final
 * object state. The default implementation uses firebase-admin's
 * `admin.storage().bucket(bucket).file(path).save(contents, ...)`,
 * which overwrites the destination atomically.
 */
export type StorageUploader = (
  bucket: string,
  path: string,
  contents: string,
) => Promise<void>;

/** Firestore handle factory — kept lazy so tests don't import firebase-admin. */
type FirestoreFactory = () => Firestore;

export interface ReplicateOptions {
  /** Override Firestore handle (tests). Default: lazy firebase-admin. */
  getDb?: FirestoreFactory;
  /** Override storage uploader (tests). Default: firebase-admin storage. */
  uploadToStorage?: StorageUploader;
  /** Override "now" timestamp (tests). Default: Date.now(). */
  now?: () => number;
  /** Bucket name (no gs:// prefix). Default: env or DEFAULT_BUCKET. */
  bucket?: string;
  /** Collections to replicate. Default: CRITICAL_COLLECTIONS. */
  collections?: readonly string[];
}

export interface PerCollectionResult {
  collection: string;
  /** Number of documents matched in the window. */
  docs: number;
  /** Final upload path (relative to the bucket). Null if nothing uploaded. */
  path: string | null;
  /** Error message if this collection failed (other collections still run). */
  error?: string;
}

export interface ReplicateResult {
  /** Per-collection results in stable order. */
  collections: PerCollectionResult[];
  /** Window start (epoch ms). */
  windowStart: number;
  /** Window end (epoch ms, == now). */
  windowEnd: number;
}

/** Format `now` as `YYYY-MM-DDTHH` (UTC) for the JSONL filename. */
function hourSlug(now: number): string {
  return new Date(now).toISOString().slice(0, 13);
}

/** Default uploader — uses firebase-admin's bundled storage support. */
async function defaultUploader(
  bucket: string,
  path: string,
  contents: string,
): Promise<void> {
  const admin = (await import('firebase-admin')).default;
  if (!admin.apps.length) admin.initializeApp();
  await admin
    .storage()
    .bucket(bucket)
    .file(path)
    .save(contents, {
      contentType: 'application/x-ndjson',
      metadata: { cacheControl: 'no-cache' },
    });
}

/**
 * Replicate the last-hour writes from each critical collection to GCS
 * as JSONL. Returns a per-collection result so the admin endpoint can
 * surface partial successes — an error in one collection does NOT
 * abort the others (W.6 test #4).
 */
export async function replicateCriticalData(
  opts: ReplicateOptions = {},
): Promise<ReplicateResult> {
  const now = (opts.now ?? (() => Date.now()))();
  const oneHourAgo = now - ONE_HOUR_MS;
  const bucket =
    opts.bucket ?? process.env.CRITICAL_REPLICA_BUCKET ?? DEFAULT_BUCKET;
  const upload = opts.uploadToStorage ?? defaultUploader;
  const collections = opts.collections ?? CRITICAL_COLLECTIONS;

  const db = opts.getDb
    ? opts.getDb()
    : (await import('firebase-admin')).default.firestore();

  const results: PerCollectionResult[] = [];

  for (const coll of collections) {
    try {
      const snap = await db
        .collection(coll)
        .where('createdAt', '>=', oneHourAgo)
        .get();

      if (snap.empty || snap.docs.length === 0) {
        // Nothing to replicate — record the empty result and skip the
        // upload entirely. We don't write a 0-byte file because the
        // operator can't tell "no writes" apart from "job didn't run"
        // by inspecting GCS — the manifest in the daily export is
        // authoritative for that question.
        results.push({ collection: coll, docs: 0, path: null });
        continue;
      }

      const lines = snap.docs
        .map((d) => JSON.stringify({ id: d.id, ...d.data() }))
        .join('\n');
      const path = `${coll}/${hourSlug(now)}.jsonl`;

      await upload(bucket, path, lines);
      results.push({ collection: coll, docs: snap.docs.length, path });
    } catch (e) {
      // Per W.6 test #4: an error in one collection MUST NOT abort the
      // others. We capture the message so the admin endpoint and the
      // operator dashboard can surface partial success.
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ collection: coll, docs: 0, path: null, error: msg });
    }
  }

  return { collections: results, windowStart: oneHourAgo, windowEnd: now };
}
