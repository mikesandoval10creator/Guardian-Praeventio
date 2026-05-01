/**
 * Envelope encryption for OAuth tokens (and any other small secret).
 *
 * Why envelope?
 *   - Storing OAuth refresh_tokens in Firestore relies on Firestore's at-rest
 *     encryption — fine, but a privileged GCP-console export reads as
 *     plaintext.
 *   - Wrapping with a KMS-managed KEK adds defense in depth: an attacker
 *     would need BOTH Firestore export rights AND KMS decrypt rights.
 *   - Doing the AES round-trip ourselves (instead of calling KMS.encrypt on
 *     the whole token) means one KMS call per token op, not per byte.
 *
 * Layout (envelope object):
 *   - ciphertext   : AES-256-GCM(token) under the random per-op DEK, base64.
 *   - iv           : 12-byte AES-GCM nonce, base64.
 *   - authTag      : 16-byte GCM authentication tag, base64.
 *   - encryptedDek : KMS-wrapped DEK, base64. KMS is the only thing that
 *                    can recover this back to raw bytes.
 *   - algorithm    : pinned to 'AES-256-GCM' so we can evolve later.
 *   - kmsAdapter   : which adapter wrapped the DEK — used for sanity check
 *                    on decrypt (we refuse to decrypt with the wrong family
 *                    of adapter).
 *   - createdAt    : ISO string. Useful for migration/audit; not used in
 *                    crypto.
 *
 * Threat model NOT covered:
 *   - Compromise of the running server process — at runtime we hold the
 *     plaintext access_token in memory in order to make API calls. KMS does
 *     not protect against a memory dump of a live Node process. That's the
 *     job of OS-level isolation / Cloud Run's managed runtime.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KmsAdapter, KmsAdapterName } from './kmsAdapter.ts';

export interface EnvelopeCiphertext {
  ciphertext: string;
  iv: string;
  authTag: string;
  encryptedDek: string;
  algorithm: 'AES-256-GCM';
  kmsAdapter: KmsAdapterName;
  createdAt: string;
}

const DEK_BYTES = 32; // AES-256 → 256 bits → 32 bytes
const IV_BYTES = 12; // AES-GCM canonical nonce length

/**
 * Encrypt a string under a fresh random DEK, then wrap that DEK via KMS.
 *
 * `plaintext` is allowed to be empty — the empty string round-trips
 * correctly (ciphertext is empty, authTag is still present and verified).
 */
export async function envelopeEncrypt(
  plaintext: string,
  adapter: KmsAdapter,
): Promise<EnvelopeCiphertext> {
  if (!adapter.isAvailable) {
    throw new Error(
      `envelopeEncrypt: KMS adapter '${adapter.name}' is not available. ` +
        `Install/configure the adapter or pick a different one (KMS_ADAPTER env var).`,
    );
  }

  // Generate a fresh DEK + IV per operation. Using the same IV twice with
  // the same key in GCM is catastrophic, so we ALWAYS randomize the IV.
  const dek = randomBytes(DEK_BYTES);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const plaintextBuf = Buffer.from(plaintext, 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Wrap the DEK with the KEK (KMS). This is the only KMS round-trip.
  const encryptedDek = await adapter.encrypt(dek);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    encryptedDek: encryptedDek.toString('base64'),
    algorithm: 'AES-256-GCM',
    kmsAdapter: adapter.name,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Reverse of envelopeEncrypt. Throws on:
 *   - tampered ciphertext / authTag (GCM auth failure),
 *   - wrong adapter (decrypt with a KEK that didn't wrap this DEK),
 *   - malformed envelope shape,
 *   - unsupported algorithm field.
 *
 * We accept envelopes whose `kmsAdapter` field is different from the
 * passed adapter's `name` only when one of them is 'noop' — this lets the
 * break-glass adapter still operate. Otherwise we refuse, because using the
 * wrong KEK family will fail unwrap with a confusing crypto error.
 */
export async function envelopeDecrypt(
  envelope: EnvelopeCiphertext,
  adapter: KmsAdapter,
): Promise<string> {
  if (!adapter.isAvailable) {
    throw new Error(
      `envelopeDecrypt: KMS adapter '${adapter.name}' is not available.`,
    );
  }
  if (envelope.algorithm !== 'AES-256-GCM') {
    throw new Error(
      `envelopeDecrypt: unsupported algorithm '${envelope.algorithm}', expected 'AES-256-GCM'.`,
    );
  }
  if (
    envelope.kmsAdapter !== adapter.name &&
    envelope.kmsAdapter !== 'noop' &&
    adapter.name !== 'noop'
  ) {
    throw new Error(
      `envelopeDecrypt: adapter mismatch — envelope was wrapped by '${envelope.kmsAdapter}', ` +
        `cannot unwrap with '${adapter.name}'.`,
    );
  }

  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const encryptedDek = Buffer.from(envelope.encryptedDek, 'base64');

  if (iv.length !== IV_BYTES) {
    throw new Error(`envelopeDecrypt: bad iv length ${iv.length}, expected ${IV_BYTES}`);
  }
  if (authTag.length !== 16) {
    throw new Error(`envelopeDecrypt: bad authTag length ${authTag.length}, expected 16`);
  }

  // KMS-unwrap the DEK first.
  const dek = await adapter.decrypt(encryptedDek);
  if (dek.length !== DEK_BYTES) {
    throw new Error(
      `envelopeDecrypt: unwrapped DEK has wrong size ${dek.length}, expected ${DEK_BYTES}`,
    );
  }

  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(authTag);
  // .final() throws if authTag does not validate — that's our integrity check.
  const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return out.toString('utf8');
}

/**
 * Type guard: does `value` look like an EnvelopeCiphertext (post-Firestore-read)?
 *
 * Used by oauthTokenStore to decide between "decrypt this" vs. "treat as
 * legacy plaintext string" without throwing.
 */
export function isEnvelopeCiphertext(value: unknown): value is EnvelopeCiphertext {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ciphertext === 'string' &&
    typeof v.iv === 'string' &&
    typeof v.authTag === 'string' &&
    typeof v.encryptedDek === 'string' &&
    v.algorithm === 'AES-256-GCM' &&
    typeof v.kmsAdapter === 'string'
  );
}
