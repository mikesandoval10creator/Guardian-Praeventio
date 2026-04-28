/**
 * KMS adapter interface + dev/stub implementations.
 *
 * The adapter is the small, swappable boundary between our envelope
 * encryption code and a concrete KMS provider (Google Cloud KMS in
 * production). Keeping this interface narrow lets us:
 *   - run tests / dev without any KMS network calls (in-memory adapter),
 *   - swap in `@google-cloud/kms` in a future round without touching the
 *     envelope math (cloudKmsAdapter is currently a stub),
 *   - disable encryption entirely via the noop adapter for emergency
 *     break-glass debugging.
 *
 * IMPORTANT: This file does NOT import `@google-cloud/kms`. That dependency
 * is owned by Agent O5 / a future round (see KMS_ROTATION.md). Until then,
 * `cloudKmsAdapter.encrypt/decrypt` throw a clear NotImplementedError.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

export type KmsAdapterName = 'cloud-kms' | 'in-memory-dev' | 'noop';

export interface KmsAdapter {
  /**
   * Stable adapter identifier. Stored alongside ciphertext so a future
   * decryptor can detect "this envelope was wrapped by adapter X" and pick
   * the right unwrap path. Lowercase, kebab-case.
   */
  readonly name: KmsAdapterName;

  /**
   * `true` when the adapter is wired up enough to actually call.
   *   - in-memory-dev: always true.
   *   - noop: true (it just returns input).
   *   - cloud-kms: false until @google-cloud/kms is installed and configured.
   */
  readonly isAvailable: boolean;

  /**
   * Wrap a plaintext buffer with the KEK. For envelope encryption this is
   * called with the (small, ~32 byte) DEK as input, NEVER the full plaintext
   * token — KMS calls are slow, so we want exactly one per token operation.
   */
  encrypt(plaintext: Buffer): Promise<Buffer>;

  /**
   * Unwrap a ciphertext buffer with the KEK. Receives the encryptedDek and
   * returns the raw DEK bytes.
   */
  decrypt(ciphertext: Buffer): Promise<Buffer>;
}

/**
 * Hardcoded dev key — derived deterministically from a fixed string so tests
 * are reproducible. Do NOT use this in production: anyone with the source
 * tree can decrypt.
 *
 * The key derivation uses SHA-256 of a label so we get a clean 32-byte AES
 * key without baking a base64 blob into source.
 */
const DEV_KEK: Buffer = createHash('sha256')
  .update('praeventio-in-memory-kms-dev-kek-v1')
  .digest();

/**
 * In-memory dev adapter. AES-256-GCM under a deterministic dev key. Suitable
 * for local dev + tests; obviously inappropriate for production because the
 * "KEK" lives in plaintext in the source tree.
 *
 * Output layout (binary): [iv (12 bytes)] [authTag (16 bytes)] [ciphertext].
 * Caller treats the whole thing as opaque.
 */
export const inMemoryKmsAdapter: KmsAdapter = {
  name: 'in-memory-dev',
  isAvailable: true,
  async encrypt(plaintext: Buffer): Promise<Buffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', DEV_KEK, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]);
  },
  async decrypt(ciphertext: Buffer): Promise<Buffer> {
    if (ciphertext.length < 12 + 16) {
      throw new Error('inMemoryKmsAdapter.decrypt: ciphertext too short');
    }
    const iv = ciphertext.subarray(0, 12);
    const tag = ciphertext.subarray(12, 28);
    const ct = ciphertext.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', DEV_KEK, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  },
};

/**
 * Cloud KMS adapter — STUB. Real implementation lands in the next round
 * once `@google-cloud/kms` is added to package.json (see KMS_ROTATION.md
 * "Round 2 TODO"). Until then this exists so callers can reference it by
 * import without conditional require, and isAvailable=false signals to
 * `getKmsAdapter()` to fall back appropriately.
 */
export const cloudKmsAdapter: KmsAdapter = {
  name: 'cloud-kms',
  isAvailable: false,
  async encrypt(_plaintext: Buffer): Promise<Buffer> {
    throw new Error(
      'cloudKmsAdapter.encrypt: not implemented in this round. ' +
        'Install @google-cloud/kms and wire up keyring "praeventio" / key "oauth-tokens-kek" — see KMS_ROTATION.md.',
    );
  },
  async decrypt(_ciphertext: Buffer): Promise<Buffer> {
    throw new Error(
      'cloudKmsAdapter.decrypt: not implemented in this round. ' +
        'Install @google-cloud/kms and wire up keyring "praeventio" / key "oauth-tokens-kek" — see KMS_ROTATION.md.',
    );
  },
};

/**
 * Noop adapter — ciphertext === plaintext. Exists ONLY for break-glass
 * debugging when something is catastrophically wrong with KMS access and an
 * operator needs to read a wrapped value out of Firestore. Never select
 * this in production via env var unless you really know what you're doing.
 */
export const noopKmsAdapter: KmsAdapter = {
  name: 'noop',
  isAvailable: true,
  async encrypt(plaintext: Buffer): Promise<Buffer> {
    return Buffer.from(plaintext);
  },
  async decrypt(ciphertext: Buffer): Promise<Buffer> {
    return Buffer.from(ciphertext);
  },
};

/**
 * Pick a KmsAdapter based on the `KMS_ADAPTER` env var.
 *
 * Selection:
 *   - `'cloud-kms'`     → cloudKmsAdapter (production; throws until installed).
 *   - `'in-memory-dev'` → inMemoryKmsAdapter (dev/test; reproducible).
 *   - `'noop'`          → noopKmsAdapter (debug/break-glass).
 *   - anything else / unset → in-memory-dev (safe default for dev).
 *
 * NOTE: We intentionally do not auto-fall-back from cloud-kms to in-memory
 * if cloudKmsAdapter is unavailable — silently downgrading from "real KMS"
 * to "dev KEK in source tree" would be a security bug.
 */
export function getKmsAdapter(): KmsAdapter {
  const choice = (process.env.KMS_ADAPTER ?? 'in-memory-dev').toLowerCase();
  switch (choice) {
    case 'cloud-kms':
      return cloudKmsAdapter;
    case 'noop':
      return noopKmsAdapter;
    case 'in-memory-dev':
    case '':
      return inMemoryKmsAdapter;
    default:
      // Unknown values fall back to in-memory-dev (dev safety) but log so
      // the operator notices the misconfiguration.
      // eslint-disable-next-line no-console
      console.warn(`[kmsAdapter] Unknown KMS_ADAPTER='${choice}', falling back to in-memory-dev.`);
      return inMemoryKmsAdapter;
  }
}
