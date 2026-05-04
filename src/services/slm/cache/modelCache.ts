/**
 * IndexedDB-backed cache for on-device SLM model blobs.
 *
 * Fase 1 (Sprint 20, Bucket Epsilon, T-1.2). The loader (`../loader.ts`)
 * uses this module to persist downloaded model bundles so a second app
 * launch can skip the (large, expensive) network fetch.
 *
 * Why IndexedDB and not the Cache API:
 *   - Model blobs are several hundred MB to ~2 GB. IndexedDB has no
 *     hard cap in modern browsers (Cache API entries are subject to
 *     opaque quota policies that have rejected very large blobs in
 *     past Chromium versions).
 *   - We need typed, structured access (one record per model id) and
 *     IndexedDB gives that natively without re-implementing it on top
 *     of a URL-keyed Cache.
 *
 * The store is keyed by `modelId` (string). The value is a small wrapper
 * `{ id, blob, cachedAt }` so we can later add eviction by age without
 * a schema migration. Bytes live in `blob` as an `ArrayBuffer`.
 */

import { openDB, type IDBPDatabase } from 'idb';

/** Database name. Versioned with the project, not with the schema. */
const DB_NAME = 'praeventio-slm';

/** Object store name. */
const STORE_NAME = 'models';

/**
 * Schema version. Increment + handle in `upgrade` if the on-disk shape
 * changes. v1 ships the initial single-store layout.
 */
const DB_VERSION = 1;

/**
 * Internal record shape persisted in the `models` store.
 *
 * `cachedAt` is a UNIX epoch ms timestamp captured at insert time. Not
 * currently surfaced via the public API but kept on disk so an eviction
 * policy can use it later without a migration.
 */
interface CachedModelRecord {
  id: string;
  blob: ArrayBuffer;
  cachedAt: number;
}

/**
 * Singleton database promise. Lazy-initialized on first call so the
 * module is import-safe (no IndexedDB access at module evaluation
 * time, which matters for SSR / Node test contexts).
 */
let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * Open (or reopen) the singleton handle to the SLM database.
 *
 * Subsequent callers share the same `IDBPDatabase` instance so we don't
 * pay the open-cost on every cache hit.
 */
function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Reset the singleton handle. Test-only — production code should never
 * call this. Exported to let `modelCache.test.ts` simulate a fresh app
 * start between cases without tearing down the whole jsdom context.
 *
 * @internal
 */
export function __resetCacheForTests(): void {
  dbPromise = null;
}

/**
 * Persist a model blob into the cache.
 *
 * If a record already exists for `modelId` it is replaced (idiomatic
 * `put` semantics). The caller must hand us the full `ArrayBuffer` —
 * this module is intentionally a thin wrapper and does no streaming.
 *
 * @param modelId  Stable registry id of the model (e.g. `phi-3-mini`).
 * @param blob     The model bundle as a single `ArrayBuffer`.
 */
export async function cacheModel(
  modelId: string,
  blob: ArrayBuffer,
): Promise<void> {
  const db = await getDb();
  const record: CachedModelRecord = {
    id: modelId,
    blob,
    cachedAt: Date.now(),
  };
  await db.put(STORE_NAME, record);
}

/**
 * Look up a cached model blob by id.
 *
 * @returns the stored `ArrayBuffer`, or `null` if no record exists for
 *          this id (i.e. cold cache, manual eviction, or first launch).
 */
export async function loadCachedModel(
  modelId: string,
): Promise<ArrayBuffer | null> {
  const db = await getDb();
  const record = (await db.get(STORE_NAME, modelId)) as
    | CachedModelRecord
    | undefined;
  if (!record) return null;
  return record.blob;
}

/**
 * Report the cached size for a given model id, in bytes.
 *
 * Used by the model-management UI to show per-model storage usage
 * without forcing the renderer to load the whole blob into memory
 * just to read its `byteLength`.
 *
 * @returns the byte size, or `0` if the model is not cached.
 */
export async function getCachedModelBytes(modelId: string): Promise<number> {
  const db = await getDb();
  const record = (await db.get(STORE_NAME, modelId)) as
    | CachedModelRecord
    | undefined;
  if (!record) return 0;
  return record.blob.byteLength;
}

/**
 * Evict a single model from the cache.
 *
 * Idempotent: deleting a non-existent record is a no-op. Bubbles any
 * underlying IndexedDB error to the caller — the model-management UI
 * is responsible for surfacing failures to the user.
 */
export async function deleteCachedModel(modelId: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, modelId);
}
