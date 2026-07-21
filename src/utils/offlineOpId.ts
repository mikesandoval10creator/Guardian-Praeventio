/**
 * Shared idempotent identity for offline operations.
 *
 * `saveForSync()` (src/utils/pwa-offline.ts) writes every operation into TWO
 * queues during the Bucket QQ migration: the legacy IndexedDB/SQLite queue
 * and the central state machine. Each drains through its own executor in
 * OfflineSyncManager, so a `create` used to call `addDoc` twice and produce
 * two distinct documents — one tap from a worker, two hazard reports.
 *
 * Rather than pick one queue as authoritative (which would drop the other's
 * capabilities mid-migration), both derive the SAME document id from the
 * operation's content and write with `setDoc`. Whichever drains second
 * overwrites the identical row instead of creating a second one.
 *
 * Deriving the id from content — instead of stamping a new field — is what
 * makes this work for operations ALREADY sitting in both queues on a device:
 * there is nothing to migrate, because the id is computed from data both
 * queues already hold. It also survives app restarts and races for free,
 * with no "completed ops" bookkeeping to keep consistent.
 */

/**
 * JSON with object keys sorted, so two structurally equal payloads serialize
 * identically regardless of insertion order. Cycles and other values JSON
 * cannot represent degrade to a marker rather than throwing — an operation
 * that cannot be identified must still sync, and for an incident report
 * "stuck in the queue forever" is the worst possible failure.
 */
function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const result = JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object') {
      if (seen.has(val as object)) return '[cycle]';
      seen.add(val as object);
      if (!Array.isArray(val)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(val as Record<string, unknown>).sort()) {
          sorted[k] = (val as Record<string, unknown>)[k];
        }
        return sorted;
      }
    }
    return val;
  });
  return result ?? '';
}

/**
 * FNV-1a. Not cryptographic — nothing here is a security boundary; we only
 * need two payloads that differ to land on different documents.
 * ponytail: 64 bits via two seeds. Collision odds are negligible for the
 * queue depths one device reaches (hundreds of ops). If a device ever queues
 * millions, move to SHA-256 via crypto.subtle — that is async, so the
 * callers in OfflineSyncManager would need awaiting.
 */
function fnv1a(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const FNV_OFFSET_BASIS = 2166136261;
const SECOND_SEED = 3735928559;

/**
 * Keys that steer the sync executors rather than describe the document.
 *
 * They must not reach the hash: the two queues disagree about them. The
 * legacy executor destructures `createNode`/`nodeData` out of the payload
 * before writing (OfflineSyncManager.tsx:40), while the state machine keeps
 * them (:322). Hashing the raw payload would therefore give the two queues
 * different ids for the very operation we are trying to unify — the bug this
 * module exists to prevent, reintroduced one level down.
 */
const CONTROL_KEYS = ['createNode', 'nodeData'] as const;

function stripControlKeys(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const copy = { ...(data as Record<string, unknown>) };
  for (const key of CONTROL_KEYS) delete copy[key];
  return copy;
}

/**
 * Deterministic Firestore document id for an offline operation.
 *
 * Collection and type are part of the input so a delete never collapses onto
 * a create for the same payload, and so the same report filed against two
 * collections stays two documents.
 *
 * Shape is `off_<base36><base36>` — matches the document-id charset Firestore
 * rules enforce (`^[a-zA-Z0-9_\-]+$`, ≤128 chars — firestore.rules:33).
 *
 * ponytail: canonicalJson duplicates the intent of canonicalStringify in
 * src/server/middleware/idempotencyKey.ts:162. Not shared because that module
 * pulls node:crypto and this one runs in the browser. Consolidate by lifting
 * the canonicalizer into a shared util when someone next touches that
 * middleware — doing it here would put the payments path in an offline-sync PR.
 */
export function offlineOpDocId(collectionName: string, type: string, data: unknown): string {
  const canonical = `${collectionName}|${type}|${canonicalJson(stripControlKeys(data))}`;
  const high = fnv1a(canonical, FNV_OFFSET_BASIS).toString(36);
  const low = fnv1a(canonical, SECOND_SEED).toString(36);
  return `off_${high}${low}`;
}
