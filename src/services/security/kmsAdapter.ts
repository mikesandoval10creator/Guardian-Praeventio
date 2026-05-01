/**
 * KMS adapter interface + dev/stub implementations.
 *
 * The adapter is the small, swappable boundary between our envelope
 * encryption code and a concrete KMS provider (Google Cloud KMS in
 * production). Keeping this interface narrow lets us:
 *   - run tests / dev without any KMS network calls (in-memory adapter),
 *   - swap in `@google-cloud/kms` for production envelope wraps,
 *   - disable encryption entirely via the noop adapter for emergency
 *     break-glass debugging.
 *
 * Round 2: `cloudKmsAdapter` is now a real `@google-cloud/kms`-backed
 * implementation. It is gated by `KMS_KEY_RESOURCE_NAME` — when that env var
 * is missing the adapter reports `isAvailable=false` and any call throws a
 * clean configuration error. We deliberately do NOT auto-fall-back to the
 * in-memory KEK in that case (silently downgrading from KMS to a dev key
 * would be a security bug — see `getKmsAdapter()`).
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';

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
   *   - cloud-kms: true iff `KMS_KEY_RESOURCE_NAME` is set at construction
   *     time (the SDK client is built lazily in that case).
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
 * Cloud KMS adapter — production implementation backed by `@google-cloud/kms`.
 *
 * Wraps a 32-byte DEK with a Cloud KMS-managed Key Encryption Key (KEK) using
 * symmetric `Encrypt` / `Decrypt` calls. Cloud KMS auto-handles key versions
 * on decrypt: a ciphertext wrapped under a previous version still resolves
 * after rotation without us tracking version IDs.
 *
 * Configuration (single env var):
 *
 *   KMS_KEY_RESOURCE_NAME — full KMS key resource name, of the shape
 *     `projects/<proj>/locations/southamerica-west1/keyRings/praeventio/cryptoKeys/oauth-tokens-kek`
 *
 * When `KMS_KEY_RESOURCE_NAME` is unset the adapter is `isAvailable=false`
 * and any encrypt/decrypt call throws a configuration error. We DO NOT fall
 * back to the in-memory dev KEK in that case — see `getKmsAdapter()`.
 *
 * Authentication: standard Google ADC. In Cloud Run, the service identity
 * needs `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the key. Locally,
 * `gcloud auth application-default login` or a SA key file referenced by
 * `GOOGLE_APPLICATION_CREDENTIALS` works. See KMS_ROTATION.md §2 for the
 * `gcloud kms keys add-iam-policy-binding` setup command.
 *
 * The `KeyManagementServiceClient` is constructed lazily inside the
 * constructor only when `isAvailable === true`, so importing this module in
 * a context without ADC (e.g. a unit test that stubs the SDK) does not crash
 * at module load.
 */
class CloudKmsAdapter implements KmsAdapter {
  readonly name: KmsAdapterName = 'cloud-kms';
  readonly isAvailable: boolean;
  private client: KeyManagementServiceClient | null = null;
  private keyName: string;

  constructor() {
    this.keyName = process.env.KMS_KEY_RESOURCE_NAME ?? '';
    this.isAvailable = Boolean(this.keyName);
    if (this.isAvailable) {
      this.client = new KeyManagementServiceClient();
    }
  }

  async encrypt(plaintext: Buffer): Promise<Buffer> {
    if (!this.client) {
      throw new Error(
        'cloudKmsAdapter.encrypt: not configured. Set KMS_KEY_RESOURCE_NAME ' +
          'to the full key resource name (projects/.../cryptoKeys/oauth-tokens-kek).',
      );
    }
    const [response] = await this.client.encrypt({ name: this.keyName, plaintext });
    if (!response.ciphertext) {
      throw new Error('cloudKmsAdapter.encrypt: KMS response had no ciphertext');
    }
    return Buffer.from(response.ciphertext as Uint8Array);
  }

  async decrypt(ciphertext: Buffer): Promise<Buffer> {
    if (!this.client) {
      throw new Error(
        'cloudKmsAdapter.decrypt: not configured. Set KMS_KEY_RESOURCE_NAME.',
      );
    }
    const [response] = await this.client.decrypt({ name: this.keyName, ciphertext });
    if (!response.plaintext) {
      throw new Error('cloudKmsAdapter.decrypt: KMS response had no plaintext');
    }
    return Buffer.from(response.plaintext as Uint8Array);
  }
}

export const cloudKmsAdapter: KmsAdapter = new CloudKmsAdapter();

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
