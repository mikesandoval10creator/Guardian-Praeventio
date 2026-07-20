/**
 * Encrypted IndexedDB-backed offline session queue.
 *
 * Side-by-side variant of `offlineQueue.ts` that persists every queued
 * `{query, response}` pair with the SLM response wrapped in an AES-256-GCM
 * envelope (see `../security/browserEnvelope.ts`). The envelope is unwrapped
 * with the device-bound, non-exportable KEK persisted by
 * `../security/deviceKek.ts`.
 *
 * Why an encrypted twin instead of a hard cutover:
 *   - The original `offlineQueue.ts` is still in production. A hard rewrite
 *     would force every existing IDB record to be re-encrypted as part of
 *     the deploy — a migration we are not willing to gate the entire SLM
 *     namespace on.
 *   - This file mirrors the public surface of `offlineQueue.ts` 1:1
 *     (`enqueueSession`, `listPending`, `markReconciled`, `clearReconciled`,
 *     `deleteSession`, `canonicalForHmac`) so the caller (`slm/index.ts` or
 *     the orchestrator) can toggle implementations behind a feature flag —
 *     e.g. localStorage `praeventio:slm:queue-encryption:v1`.
 *   - Once telemetry confirms parity, the legacy module can be retired and
 *     this one renamed. Until then both ship.
 *
 * DESIGN — encrypt-then-sign (HMAC over PLAINTEXT, not ciphertext):
 *
 *   The HMAC tag (`hmac` field) is computed over the canonical PLAINTEXT
 *   payload, exactly as in the legacy queue. The order of operations on
 *   enqueue is:
 *
 *       hmac     = signPayload(canonicalForHmac(plaintext))
 *       envelope = encryptEnvelope(JSON.stringify(plaintext.response), kek)
 *       persist({ id, query, createdAt, reconciled, hmac, responseEnvelope })
 *
 *   This deviates from the "encrypt-then-MAC" rule-of-thumb that protects
 *   against ciphertext malleability when MAC and cipher are independent
 *   primitives. AES-GCM already provides its own AEAD authentication tag
 *   (`authTag` baked into the ciphertext), so the envelope is unforgeable
 *   on its own — adding a second MAC over the ciphertext would be
 *   belt-and-suspenders without solving the actual threat model.
 *
 *   The threat we are mitigating with HMAC (TM-T03) is "passive disk-
 *   resident attacker swaps a legitimate plaintext for a different
 *   legitimate plaintext to poison the Zettelkasten audit trail". That
 *   attacker needs the HMAC tag to verify against the SAME plaintext they
 *   want to inject. The session key lives in sessionStorage only — so
 *   they would have to (a) read sessionStorage AND (b) re-sign their
 *   payload before persisting. Either step alone defeats the attack.
 *
 *   Signing the plaintext rather than the ciphertext also means we can
 *   rotate the KEK (and therefore re-encrypt every envelope) without
 *   touching the HMAC tags — the tags remain valid as long as the
 *   underlying plaintext is unchanged. Encrypt-after-sign keeps the
 *   integrity surface decoupled from the secrecy surface.
 *
 * FALLBACK POLICY — no silent plaintext fallback:
 *
 *   If `getOrCreateDeviceKek()` throws (no SubtleCrypto, no IndexedDB,
 *   user blocked storage), enqueue / list both throw a typed error. We do
 *   NOT silently persist plaintext. Silent fallback is exactly the threat
 *   we are mitigating — a deploy that "works" while leaking PHI is worse
 *   than one that loudly refuses to enqueue. The caller is expected to
 *   surface the error to the orchestrator, which can fall back to the
 *   legacy queue intentionally (an opt-in business decision) rather than
 *   accidentally.
 *
 * MIGRATION:
 *
 *   `migrateLegacyQueueEntries()` walks the SAME object store
 *   (`offline_sessions` in `praeventio-slm`) the legacy queue uses, finds
 *   records WITHOUT a `responseEnvelope` field, encrypts their `response`,
 *   and rewrites them in place. Idempotent — already-encrypted records
 *   are skipped. Records that already had a `response` field stripped
 *   alongside a present envelope are left alone. Both implementations
 *   tolerate the schema of the other (legacy reads ignore the envelope,
 *   this module falls back to a clear error rather than reading
 *   plaintext from a legacy record).
 */

import { openDB, type IDBPDatabase } from 'idb';

import {
  decryptEnvelope,
  encryptEnvelope,
  validateEnvelope,
  type BrowserEnvelope,
} from '../security/browserEnvelope';
import { getOrCreateDeviceKek, tryGetDeviceKek } from '../security/deviceKek';
import { signPayload, currentKeyId } from './hmac';
import type { SLMQuery, SLMResponse } from './types';
import { randomId } from '../../utils/randomId';

/**
 * Database and store names — IDENTICAL to `offlineQueue.ts`. Both modules
 * read/write the same physical store. Migration is in-place.
 */
const DB_NAME = 'praeventio-slm';
const STORE_NAME = 'offline_sessions';
const DB_VERSION = 2;
const MODEL_CACHE_STORE = 'models';

/**
 * Encryption schema marker. Persisted with every record this module
 * writes; absence means "legacy plaintext record" and triggers migration.
 *
 * Bumping this string (e.g. to `'v2'`) lets a future migration distinguish
 * between v1-encrypted and v2-encrypted records without ambiguity.
 */
const ENCRYPTION_VERSION = 'v1' as const;
type EncryptionVersion = typeof ENCRYPTION_VERSION;

/**
 * Public-facing shape — identical to `QueuedSession` in `offlineQueue.ts`.
 *
 * The `response` field is the CLEAR-TEXT response after decryption. The
 * persisted shape on disk is `EncryptedRecord` (see below), which carries
 * a `responseEnvelope` instead. The conversion happens inside this
 * module on read.
 */
export interface QueuedSession {
  id: string;
  query: SLMQuery;
  response: SLMResponse;
  createdAt: number;
  reconciled: boolean;
  hmac?: string;
  /**
   * Fingerprint of the key that produced `hmac` (hmac.ts `currentKeyId`).
   * Lets the reconciler tell "tampered" apart from "signed in a session
   * whose key is gone" — the same symptom, opposite conclusions: one is an
   * attack, the other is a worker closing the app. Absent on records
   * written before this field existed.
   */
  hmacKeyId?: string;
}

/**
 * Persisted shape on disk. The `query` and `response` fields are REPLACED
 * by `queryEnvelope` / `responseEnvelope` — `BrowserEnvelope`s whose
 * plaintexts are `JSON.stringify(query)` and `JSON.stringify(response)`.
 *
 * The QUERY is encrypted too, not just the response: the prompt is where
 * the sensitive text originates — emergency questions, incident
 * descriptions, medical details a worker types in. Leaving it in the clear
 * defeats the point of encrypting the answer that quotes it back.
 *
 * `encryptionVersion` is the sentinel that distinguishes post-migration
 * records from legacy plaintext ones. Migration reads any record without
 * this field as "needs re-encryption".
 */
interface EncryptedRecord {
  id: string;
  queryEnvelope: BrowserEnvelope;
  responseEnvelope: BrowserEnvelope;
  createdAt: number;
  reconciled: boolean;
  hmac?: string;
  /** Fingerprint of the key behind `hmac` — see QueuedSession.hmacKeyId. */
  hmacKeyId?: string;
  encryptionVersion: EncryptionVersion;
}

/**
 * Legacy plaintext record shape — what `offlineQueue.ts` writes. Defined
 * here so the migration code can read it without depending on the legacy
 * module's types.
 */
interface LegacyPlaintextRecord {
  id: string;
  query: SLMQuery;
  response: SLMResponse;
  createdAt: number;
  reconciled: boolean;
  hmac?: string;
  // `encryptionVersion` MUST be absent on a legacy record. Any record
  // with this field set was written by this module.
  encryptionVersion?: undefined;
  responseEnvelope?: undefined;
}

type StoredRecord = EncryptedRecord | LegacyPlaintextRecord;

/**
 * Error class for KEK unavailability. Distinct from `BrowserEnvelopeError`
 * so the caller can pattern-match cleanly: "envelope failed at runtime"
 * (which may be transient) vs "the platform cannot encrypt at all"
 * (which is a hard failure that should surface to the orchestrator).
 */
export class EncryptedQueueUnavailableError extends Error {
  constructor(
    public readonly code:
      | 'KEK_UNAVAILABLE'
      | 'KEK_MISSING'
      | 'BAD_ENVELOPE'
      | 'BAD_RECORD',
    msg: string,
  ) {
    super(`[${code}] ${msg}`);
    this.name = 'EncryptedQueueUnavailableError';
  }
}

/**
 * Build the canonical string the HMAC is computed over.
 *
 * Re-exported (NOT re-imported from `offlineQueue.ts`) so a future
 * change to either module's canonicalization is explicit and reviewable.
 * The IMPLEMENTATION mirrors the legacy one byte-for-byte to keep the
 * two queues mutually verifiable — a record signed by the legacy module
 * verifies under this module's `verifyPayload` and vice versa.
 */
export function canonicalForHmac(input: {
  id: string;
  query: SLMQuery;
  response: SLMResponse;
  createdAt: number;
}): string {
  return JSON.stringify(sortKeysDeep(input));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = sortKeysDeep(obj[k]);
    }
    return out;
  }
  return value;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(MODEL_CACHE_STORE)) {
          db.createObjectStore(MODEL_CACHE_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Test-only escape hatch — drop the cached DB handle so a fresh
 * `FDBFactory` per test case actually takes effect.
 *
 * @internal
 */
export function __resetEncryptedOfflineQueueForTests(): void {
  dbPromise = null;
}

function newId(): string {
  return randomId();
}

/**
 * Map an envelope-or-runtime error onto the typed wrapper exposed by this
 * module. Keeps call sites free of nested try/catch on the same axis.
 */
function asUnavailable(
  code: EncryptedQueueUnavailableError['code'],
  err: unknown,
): EncryptedQueueUnavailableError {
  const msg = err instanceof Error ? err.message : String(err);
  return new EncryptedQueueUnavailableError(code, msg);
}

/**
 * Resolve the device KEK or throw a typed error. Used by enqueue /
 * decrypt paths so the caller sees a single error type for "platform
 * cannot encrypt" regardless of which subsystem hit the floor first.
 */
async function requireKek(reason: 'enqueue' | 'read'): Promise<CryptoKey> {
  try {
    if (reason === 'read') {
      // On the read path we explicitly do NOT generate a new KEK — that
      // would silently make existing ciphertexts unreadable. If the KEK
      // was deleted (logout, factory reset), the records are intentional
      // tombstones and the caller must see KEK_MISSING.
      const existing = await tryGetDeviceKek();
      if (!existing) {
        throw new EncryptedQueueUnavailableError(
          'KEK_MISSING',
          'device KEK not present — ciphertexts are unrecoverable',
        );
      }
      return existing;
    }
    return await getOrCreateDeviceKek();
  } catch (err) {
    if (err instanceof EncryptedQueueUnavailableError) throw err;
    throw asUnavailable('KEK_UNAVAILABLE', err);
  }
}

/**
 * Type guard — does this record carry an envelope (i.e. was it written by
 * this module)?
 */
function isEncryptedRecord(r: StoredRecord): r is EncryptedRecord {
  return (
    r.encryptionVersion === ENCRYPTION_VERSION &&
    typeof r.responseEnvelope === 'object' &&
    r.responseEnvelope !== null &&
    typeof r.queryEnvelope === 'object' &&
    r.queryEnvelope !== null
  );
}

/**
 * Encrypt and persist a new queued session. Returns the generated id.
 *
 * Mirrors `offlineQueue.enqueueSession` semantics, with two additions:
 *   1. The response is JSON-stringified and wrapped in a fresh
 *      AES-256-GCM envelope before persisting.
 *   2. The HMAC tag (kept identical to the legacy queue for cross-
 *      verification) is computed over the PLAINTEXT canonical payload,
 *      not the ciphertext. See module-level comment for why.
 *
 * Throws `EncryptedQueueUnavailableError` if the platform cannot
 * encrypt — never falls back to plaintext silently.
 */
export async function enqueueSession(
  query: SLMQuery,
  response: SLMResponse,
): Promise<string> {
  const kek = await requireKek('enqueue');
  const db = await getDb();
  const id = newId();
  const createdAt = Date.now();

  // Sign the canonical plaintext first — tag stays decoupled from
  // ciphertext (see module-level note on encrypt-then-sign).
  const hmac = await signPayload(
    canonicalForHmac({ id, query, response, createdAt }),
  );
  // Which key signed it. Without this, a tag that fails to verify after the
  // app is reopened is indistinguishable from tampering — and the entry was
  // being deleted as if it were an attack.
  const hmacKeyId = await currentKeyId();

  // Encrypt query + response → envelopes.
  let queryEnvelope: BrowserEnvelope;
  let responseEnvelope: BrowserEnvelope;
  try {
    queryEnvelope = await encryptEnvelope(JSON.stringify(query), kek, id);
    responseEnvelope = await encryptEnvelope(JSON.stringify(response), kek, id);
  } catch (err) {
    throw asUnavailable('BAD_ENVELOPE', err);
  }

  const record: EncryptedRecord = {
    id,
    queryEnvelope,
    responseEnvelope,
    createdAt,
    reconciled: false,
    hmac,
    hmacKeyId,
    encryptionVersion: ENCRYPTION_VERSION,
  };
  await db.put(STORE_NAME, record);

  // Fire-and-forget analytics — mirrors the legacy module so dashboards
  // built on `slm.queue.grew` keep working when the caller toggles the
  // flag. Same caveats: must not break the enqueue contract.
  void (async () => {
    try {
      const all = (await db.getAll(STORE_NAME)) as StoredRecord[];
      const queue_depth_after = all.filter((s) => s.reconciled === false).length;
      const { analytics } = await import('../analytics');
      await analytics.track('slm.queue.grew', {
        queue_depth_after,
        session_id: record.id,
      });
    } catch {
      /* analytics MUST NOT break the enqueue contract */
    }
  })();

  return record.id;
}

/**
 * Decrypt one persisted record back into the public `QueuedSession`
 * shape. Throws `EncryptedQueueUnavailableError` if:
 *   - the record is a legacy plaintext (caller must run migration first)
 *   - the envelope is malformed
 *   - the ciphertext or authTag has been tampered with
 *   - the KEK is missing (logout / factory reset)
 */
async function decryptOne(
  record: StoredRecord,
  kek: CryptoKey,
): Promise<QueuedSession> {
  if (!isEncryptedRecord(record)) {
    throw new EncryptedQueueUnavailableError(
      'BAD_RECORD',
      `record "${record.id}" is legacy plaintext — call migrateLegacyQueueEntries() first`,
    );
  }
  try {
    validateEnvelope(record.queryEnvelope);
    validateEnvelope(record.responseEnvelope);
  } catch (err) {
    throw asUnavailable('BAD_ENVELOPE', err);
  }
  let queryPlaintext: string;
  let responsePlaintext: string;
  try {
    queryPlaintext = await decryptEnvelope(record.queryEnvelope, kek);
    responsePlaintext = await decryptEnvelope(record.responseEnvelope, kek);
  } catch (err) {
    // Preserve the underlying `DECRYPT_FAIL` semantic — the caller may
    // want to drop the record + raise a Sentry alert (tamper signal)
    // rather than retry.
    throw asUnavailable('BAD_ENVELOPE', err);
  }
  let query: SLMQuery;
  let response: SLMResponse;
  try {
    query = JSON.parse(queryPlaintext) as SLMQuery;
    response = JSON.parse(responsePlaintext) as SLMResponse;
  } catch (err) {
    throw asUnavailable('BAD_RECORD', err);
  }
  return {
    id: record.id,
    query,
    response,
    createdAt: record.createdAt,
    reconciled: record.reconciled,
    hmac: record.hmac,
    hmacKeyId: record.hmacKeyId,
  };
}

/**
 * List pending sessions, decrypted and chronologically ordered
 * oldest-first.
 *
 * Same contract as `offlineQueue.listPending`. Differs only in that any
 * record encountered that is NOT an encrypted record causes a typed
 * throw — the caller MUST run `migrateLegacyQueueEntries()` before
 * draining a mixed store.
 */
export async function listPending(): Promise<QueuedSession[]> {
  const db = await getDb();
  const all = (await db.getAll(STORE_NAME)) as StoredRecord[];
  const pending = all
    .filter((s) => s.reconciled === false)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (pending.length === 0) return [];

  const kek = await requireKek('read');
  const out: QueuedSession[] = [];
  for (const rec of pending) {
    out.push(await decryptOne(rec, kek));
  }
  return out;
}

/**
 * Permanently delete one queued session. Same semantics as the legacy
 * module — idempotent on a missing id.
 */
export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}

/**
 * Flip a session's `reconciled` flag to `true`. Throws on unknown id,
 * silently no-ops if already reconciled — same semantics as legacy.
 *
 * Does NOT touch the envelope — flipping a flag must not require KEK
 * access. The record is rewritten with the existing `responseEnvelope`
 * unchanged.
 */
export async function markReconciled(id: string): Promise<void> {
  const db = await getDb();
  const existing = (await db.get(STORE_NAME, id)) as StoredRecord | undefined;
  if (!existing) {
    throw new Error(
      `encryptedOfflineQueue.markReconciled: unknown session id "${id}"`,
    );
  }
  if (existing.reconciled) return;
  await db.put(STORE_NAME, { ...existing, reconciled: true });
}

/**
 * Delete every reconciled session in one transaction. Returns the count
 * removed. Same semantics as legacy.
 */
export async function clearReconciled(): Promise<number> {
  const db = await getDb();
  const all = (await db.getAll(STORE_NAME)) as StoredRecord[];
  const toDelete = all.filter((s) => s.reconciled === true);
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await Promise.all(toDelete.map((s) => tx.store.delete(s.id)));
  await tx.done;
  return toDelete.length;
}

/**
 * Outcome of one migration pass. Useful for telemetry — the orchestrator
 * fires a Sentry breadcrumb with these counts so a successful migration
 * is observable without log-diving.
 */
export interface MigrationResult {
  /** Records inspected (legacy + already-encrypted). */
  scanned: number;
  /** Legacy plaintext records that were re-encrypted in this pass. */
  migrated: number;
  /** Records already encrypted, skipped. */
  skipped: number;
  /** Records that could not be migrated (malformed legacy shape). */
  failed: number;
}

/**
 * One-time migration: walk every record in the offline_sessions store,
 * find the ones that lack an `encryptionVersion` marker (i.e. were
 * written by the legacy `offlineQueue.ts`), encrypt their `response`
 * field, and rewrite them in place.
 *
 * Idempotent — running it twice scans every record but only encrypts
 * the legacy ones. The second pass returns `migrated: 0`.
 *
 * Does NOT re-sign the HMAC — the existing tag was computed over the
 * SAME plaintext we are now wrapping, so re-signing would either reuse
 * the same per-session key (no-op) or, worse, sign with a different key
 * (breaks verification at reconcile time). The legacy `hmac` field is
 * preserved byte-for-byte.
 *
 * If the KEK is unavailable, throws — migration has nothing to fall back
 * to. The caller must surface the error.
 */
export async function migrateLegacyQueueEntries(): Promise<MigrationResult> {
  const db = await getDb();
  const all = (await db.getAll(STORE_NAME)) as StoredRecord[];
  const result: MigrationResult = {
    scanned: all.length,
    migrated: 0,
    skipped: 0,
    failed: 0,
  };
  if (all.length === 0) return result;

  // Only resolve the KEK if there is at least one legacy record to
  // migrate. A pure-encrypted store should be migration-idempotent
  // even with no KEK present (e.g. running migration in a worker that
  // has no SubtleCrypto access yet).
  const legacy = all.filter(
    (r): r is LegacyPlaintextRecord => !isEncryptedRecord(r),
  );
  result.skipped = all.length - legacy.length;
  if (legacy.length === 0) return result;

  const kek = await requireKek('enqueue');

  for (const rec of legacy) {
    // Defensive: a record could be in a "half-migrated" weird state
    // (legacy field set BUT also has an envelope). Treat any record
    // without a usable `response` AND without a usable envelope as
    // failed rather than silently dropping it.
    if (!rec.response || typeof rec.response !== 'object') {
      result.failed += 1;
      continue;
    }
    try {
      const [queryEnvelope, responseEnvelope] = await Promise.all([
        encryptEnvelope(JSON.stringify(rec.query), kek, rec.id),
        encryptEnvelope(JSON.stringify(rec.response), kek, rec.id),
      ]);
      // `put` REPLACES the whole record, so omitting `query`/`response` is
      // what actually removes the plaintext from disk — the legacy fields
      // are not carried over.
      const migrated: EncryptedRecord = {
        id: rec.id,
        createdAt: rec.createdAt,
        reconciled: rec.reconciled,
        hmac: rec.hmac,
        queryEnvelope,
        responseEnvelope,
        encryptionVersion: ENCRYPTION_VERSION,
      };
      await db.put(STORE_NAME, migrated);
      result.migrated += 1;
    } catch {
      // Don't abort the whole batch on one malformed record — record
      // the failure and continue. Operator can replay migration after
      // diagnosing.
      result.failed += 1;
    }
  }

  return result;
}

/**
 * Feature-flag helper — encapsulates the localStorage flag the caller
 * uses to opt into the encrypted queue. Exported so tests and the
 * orchestrator share the same key string.
 */
export const ENCRYPTION_FEATURE_FLAG = 'praeventio:slm:queue-encryption:v1';

/**
 * Check whether the encrypted queue is enabled for the current
 * installation. Returns `false` if localStorage is unavailable (SSR,
 * disabled by user, etc.) so callers default to the legacy queue.
 *
 * Convention: the flag is set to the string `'on'` to enable. Anything
 * else (missing key, empty string, `'off'`) leaves the legacy path
 * active.
 */
export function isEncryptedQueueEnabled(): boolean {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls?.getItem(ENCRYPTION_FEATURE_FLAG) === 'on';
  } catch {
    return false;
  }
}
