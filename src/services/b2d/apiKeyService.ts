// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB — B2D API key service.
//
// Key model:
//   - Plaintext key: `pk_live_<24 hex>` (32 chars total) o `pk_test_<24 hex>`.
//   - Persistimos SOLO el SHA-256 hex del key + un sal del proyecto (derivado
//     de B2D_API_KEY_SALT). Plaintext NUNCA toca Firestore.
//   - `keyPrefix` (primeros 12 chars) se guarda solo para que el panel admin
//     pueda mostrar al usuario "pk_live_3f9a..." sin exponer secret entero.
//
// Privacy boundary: estas keys autentican integradores B2D que llaman las
// APIs públicas (Climate / Hazmat / Normativa / Suite). No tienen acceso al
// Zettelkasten interno del tenant.
//
// Storage: Firestore collection `b2d_api_keys/{id}`.

import * as admin from 'firebase-admin';
import { createHash, randomBytes } from 'node:crypto';

import type { ApiTierId } from '../pricing/aiTier.js';

/** Logical scope a key can carry. */
export type B2dScope =
  | 'climate.read'
  | 'climate.forecast'
  | 'hazmat.calculate'
  | 'normativa.search'
  | 'normativa.validate'
  | 'suite.all';

export type B2dTier = ApiTierId;

export interface B2dApiKey {
  /** Stable id; format `apikey-{uuid-like-hex}`. */
  id: string;
  /** Tenant id of the integrator that owns the key. */
  customerId: string;
  /** Tier the key resolves to (drives quota + rate limit). */
  tier: B2dTier;
  /** SHA-256 hex digest of the raw key, salted with project secret. */
  keyHash: string;
  /** First 12 chars of the raw key; display-only for the admin panel. */
  keyPrefix: string;
  /** Scopes the key carries. `suite.all` grants every other scope. */
  scopes: B2dScope[];
  /** Lifecycle status. */
  status: 'active' | 'revoked' | 'expired';
  /** Epoch ms — creation. */
  createdAt: number;
  /** Optional expiry epoch ms — when set and elapsed, key resolves as 'expired'. */
  expiresAt?: number;
  /** Optional last-used marker (epoch ms). Updated lazily on verifyApiKey hit. */
  lastUsedAt?: number;
  /** Audit: who revoked, when. */
  revokedAt?: number;
  revokedBy?: string;
}

const COLLECTION = 'b2d_api_keys';

/** Salt used when hashing keys. Defaults to a public string in dev so tests run. */
function projectSalt(): string {
  return process.env.B2D_API_KEY_SALT ?? 'praeventio-b2d-default-salt';
}

/**
 * Hash a raw key with SHA-256 + project salt.
 * @internal — exported for tests only.
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(`${projectSalt()}::${rawKey}`).digest('hex');
}

function generateRawKey(env: 'live' | 'test'): string {
  // 24 hex chars (12 bytes) of entropy is plenty for non-guessable keys.
  // Plaintext shape: `pk_live_<24 hex>` (32 chars total).
  const entropy = randomBytes(12).toString('hex');
  return `pk_${env}_${entropy}`;
}

function generateRecordId(): string {
  return `apikey-${randomBytes(8).toString('hex')}`;
}

/** Helper: resolve an api key environment from NODE_ENV. */
function defaultEnv(): 'live' | 'test' {
  return process.env.NODE_ENV === 'production' ? 'live' : 'test';
}

/**
 * Generate a new B2D API key and persist its hash.
 *
 * @returns The plaintext `key` (returned exactly once — caller MUST surface
 *   it to the integrator and forget it) plus the persisted `record`.
 */
export async function createApiKey(opts: {
  customerId: string;
  tier: B2dTier;
  scopes: B2dScope[];
  expiresInDays?: number;
  /** Override env for testing (defaults to 'live' in prod, 'test' otherwise). */
  env?: 'live' | 'test';
}): Promise<{ key: string; record: B2dApiKey }> {
  if (!opts.customerId || typeof opts.customerId !== 'string') {
    throw new TypeError('createApiKey: customerId required');
  }
  if (!Array.isArray(opts.scopes) || opts.scopes.length === 0) {
    throw new TypeError('createApiKey: at least one scope required');
  }
  if (opts.expiresInDays !== undefined && (!Number.isFinite(opts.expiresInDays) || opts.expiresInDays <= 0)) {
    throw new RangeError('createApiKey: expiresInDays must be > 0');
  }

  const env = opts.env ?? defaultEnv();
  const rawKey = generateRawKey(env);
  const id = generateRecordId();
  const now = Date.now();

  const record: B2dApiKey = {
    id,
    customerId: opts.customerId,
    tier: opts.tier,
    keyHash: hashApiKey(rawKey),
    keyPrefix: rawKey.slice(0, 12),
    scopes: [...opts.scopes],
    status: 'active',
    createdAt: now,
    ...(opts.expiresInDays
      ? { expiresAt: now + opts.expiresInDays * 24 * 60 * 60 * 1000 }
      : {}),
  };

  await admin.firestore().collection(COLLECTION).doc(id).set(record);
  return { key: rawKey, record };
}

/**
 * Verify an incoming raw API key.
 *
 * Returns the matching record when active and within expiry. Returns `null`
 * when the key is unknown, revoked, or expired. Updates `lastUsedAt` lazily
 * when valid (best-effort; failures here are swallowed to avoid blocking the
 * request path).
 */
export async function verifyApiKey(rawKey: string): Promise<B2dApiKey | null> {
  if (typeof rawKey !== 'string' || !rawKey.startsWith('pk_')) return null;

  const hash = hashApiKey(rawKey);
  const snap = await admin
    .firestore()
    .collection(COLLECTION)
    .where('keyHash', '==', hash)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  const record = doc.data() as B2dApiKey;

  if (record.status === 'revoked') return null;

  if (record.expiresAt && record.expiresAt <= Date.now()) {
    // Lazily mark expired so admin lists reflect reality without a sweep.
    try {
      await doc.ref.update({ status: 'expired' });
    } catch {
      // best-effort
    }
    return null;
  }

  // Best-effort lastUsedAt — fire-and-forget so request path isn't blocked.
  doc.ref.update({ lastUsedAt: Date.now() }).catch(() => {
    // best-effort
  });

  return record;
}

/** List all keys belonging to a customer (active + revoked + expired). */
export async function listApiKeys(customerId: string): Promise<B2dApiKey[]> {
  if (!customerId) return [];
  const snap = await admin
    .firestore()
    .collection(COLLECTION)
    .where('customerId', '==', customerId)
    .get();
  return snap.docs.map((d) => d.data() as B2dApiKey);
}

/** Revoke a key. Idempotent — calling twice is a no-op. */
export async function revokeApiKey(id: string, revokedBy: string): Promise<void> {
  if (!id) throw new TypeError('revokeApiKey: id required');
  if (!revokedBy) throw new TypeError('revokeApiKey: revokedBy required');
  await admin
    .firestore()
    .collection(COLLECTION)
    .doc(id)
    .update({
      status: 'revoked',
      revokedAt: Date.now(),
      revokedBy,
    });
}

/** Internal: exposed for tests/admin tooling. */
export const __internals = {
  COLLECTION,
  hashApiKey,
  generateRawKey,
};
