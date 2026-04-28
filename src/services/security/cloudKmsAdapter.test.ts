/**
 * Smoke tests for the production cloud-kms adapter.
 *
 * We mock `@google-cloud/kms` so this suite never reaches out to real GCP —
 * the test verifies WIRING (env-var gating, request shape, response
 * unwrapping), not the cryptographic behavior of Cloud KMS itself. A real
 * integration test against a staging KEK is deferred until CI has a service
 * account configured (see KMS_ROTATION.md §8 + Round 3 follow-ups).
 *
 * The mock implements a trivial bijection: encrypt(plaintext) returns
 * `enc:<hex>`, decrypt() reverses it. That's enough to prove the adapter:
 *   - constructs a client only when configured,
 *   - forwards `name` + `plaintext` correctly,
 *   - extracts `response.ciphertext` / `response.plaintext` correctly,
 *   - throws a clean configuration error when not configured.
 *
 * Why a separate test file (not appended to kmsEnvelope.test.ts):
 *   - The mock has to be hoisted with `vi.mock` BEFORE the module under test
 *     is imported. kmsEnvelope.test.ts imports inMemoryKmsAdapter eagerly at
 *     the top of the file, so adding a mock there would mock the SDK for the
 *     whole envelope suite (which doesn't need it). Keeping the cloud-kms
 *     wiring tests isolated also makes "RED→GREEN" easy to reason about.
 *   - `cloudKmsAdapter` itself is a module-level singleton that captures
 *     `process.env.KMS_KEY_RESOURCE_NAME` at construction time. We can't
 *     re-construct it per test, so each "scenario" uses `vi.resetModules()`
 *     + a dynamic `import()` after the env var is set or unset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture mock spies so individual tests can assert call arguments. The
// return shape is intentionally loose (`unknown[]`) so that
// `mockImplementationOnce` cases below — where we want to omit
// ciphertext/plaintext to exercise the "missing field" error path — don't
// fight the TypeScript checker.
type EncryptArgs = { name: string; plaintext: Buffer };
type DecryptArgs = { name: string; ciphertext: Buffer };

const mockEncrypt = vi.fn(async ({ name, plaintext }: EncryptArgs): Promise<unknown[]> => [
  { ciphertext: Buffer.from(`enc:${plaintext.toString('hex')}`), name },
]);
const mockDecrypt = vi.fn(async ({ ciphertext }: DecryptArgs): Promise<unknown[]> => {
  const enc = ciphertext.toString();
  if (!enc.startsWith('enc:')) throw new Error('not encrypted');
  return [{ plaintext: Buffer.from(enc.slice(4), 'hex') }];
});

// `new KeyManagementServiceClient()` is called with `new`, so the mock must
// be a real constructor — `vi.fn(() => …)` returns an arrow function, which
// throws "is not a constructor" under `new`. A `function() { … }` declaration
// works because it has a `[[Construct]]` slot.
vi.mock('@google-cloud/kms', () => ({
  KeyManagementServiceClient: function MockKeyManagementServiceClient(this: {
    encrypt: typeof mockEncrypt;
    decrypt: typeof mockDecrypt;
  }) {
    this.encrypt = mockEncrypt;
    this.decrypt = mockDecrypt;
  },
}));

const ENV_KEY = 'KMS_KEY_RESOURCE_NAME';
const TEST_KEY_NAME =
  'projects/test-proj/locations/southamerica-west1/keyRings/praeventio/cryptoKeys/oauth-tokens-kek';

describe('cloudKmsAdapter (mocked SDK)', () => {
  // Each test resets the module registry so the singleton picks up the
  // current env var state on import.
  beforeEach(() => {
    vi.resetModules();
    mockEncrypt.mockClear();
    mockDecrypt.mockClear();
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('isAvailable === false when KMS_KEY_RESOURCE_NAME is unset', async () => {
    delete process.env[ENV_KEY];
    const { cloudKmsAdapter } = await import('./kmsAdapter.ts');
    expect(cloudKmsAdapter.isAvailable).toBe(false);
    expect(cloudKmsAdapter.name).toBe('cloud-kms');
  });

  it('encrypt without configuration throws a clean error mentioning the env var', async () => {
    delete process.env[ENV_KEY];
    const { cloudKmsAdapter } = await import('./kmsAdapter.ts');
    await expect(cloudKmsAdapter.encrypt(Buffer.from('dek-bytes'))).rejects.toThrow(
      /KMS_KEY_RESOURCE_NAME/,
    );
  });

  it('decrypt without configuration throws a clean error', async () => {
    delete process.env[ENV_KEY];
    const { cloudKmsAdapter } = await import('./kmsAdapter.ts');
    await expect(cloudKmsAdapter.decrypt(Buffer.from('xx'))).rejects.toThrow(
      /not configured/,
    );
  });

  it('isAvailable === true and roundtrip works when configured (uses mocked SDK)', async () => {
    process.env[ENV_KEY] = TEST_KEY_NAME;
    const { cloudKmsAdapter } = await import('./kmsAdapter.ts');
    expect(cloudKmsAdapter.isAvailable).toBe(true);

    const dek = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8'); // 32 bytes
    const wrapped = await cloudKmsAdapter.encrypt(dek);

    // Mock receives the configured key name, not a hardcoded one.
    expect(mockEncrypt).toHaveBeenCalledTimes(1);
    expect(mockEncrypt.mock.calls[0][0].name).toBe(TEST_KEY_NAME);
    expect(mockEncrypt.mock.calls[0][0].plaintext).toEqual(dek);

    // Mock format is `enc:<hex>` — confirm the adapter just forwards bytes.
    expect(wrapped.toString()).toBe(`enc:${dek.toString('hex')}`);

    const back = await cloudKmsAdapter.decrypt(wrapped);
    expect(back).toEqual(dek);
    expect(mockDecrypt).toHaveBeenCalledTimes(1);
    expect(mockDecrypt.mock.calls[0][0].name).toBe(TEST_KEY_NAME);
  });

  it('encrypt throws if the SDK returns no ciphertext', async () => {
    process.env[ENV_KEY] = TEST_KEY_NAME;
    mockEncrypt.mockImplementationOnce(async () => [{}]);
    const { cloudKmsAdapter } = await import('./kmsAdapter.ts');
    await expect(cloudKmsAdapter.encrypt(Buffer.from('x'))).rejects.toThrow(/no ciphertext/);
  });

  it('decrypt throws if the SDK returns no plaintext', async () => {
    process.env[ENV_KEY] = TEST_KEY_NAME;
    mockDecrypt.mockImplementationOnce(async () => [{}]);
    const { cloudKmsAdapter } = await import('./kmsAdapter.ts');
    await expect(cloudKmsAdapter.decrypt(Buffer.from('x'))).rejects.toThrow(/no plaintext/);
  });
});
