import { describe, it, expect } from 'vitest';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import {
  envelopeEncrypt,
  envelopeDecrypt,
  isEnvelopeCiphertext,
  type EnvelopeCiphertext,
} from './kmsEnvelope.ts';
import {
  inMemoryKmsAdapter,
  noopKmsAdapter,
  type KmsAdapter,
} from './kmsAdapter.ts';

/**
 * Tests for envelope encryption math.
 *
 * We use the in-memory dev adapter (deterministic KEK, AES-256-GCM-wrapped
 * DEK) so we can verify the FULL roundtrip without any network. A second
 * "alternate" adapter with a different KEK lets us prove that decrypting
 * with the wrong KEK family fails.
 *
 * What these tests pin:
 *   1. roundtrip works for short and long plaintexts,
 *   2. nondeterminism: same input → different ciphertext + IV,
 *   3. tamper detection on authTag and ciphertext,
 *   4. wrong-key rejection (different KEK family → fails),
 *   5. empty string roundtrip (edge: GCM with zero-length plaintext).
 */

// Build a second in-memory-ish adapter with a different KEK so we can
// exercise "wrong key" failure without standing up another KMS-shaped
// object. Reuses Node's crypto exactly the way the real adapter does.
function makeAlternateAdapter(): KmsAdapter {
  const altKek = createHash('sha256').update('alternate-test-kek').digest();
  // Inline a tiny adapter using the same wire format as inMemoryKmsAdapter
  // but a different key. Self-contained so a "wrong KEK" test does not
  // depend on the production adapter's internal key.
  return {
    name: 'in-memory-dev', // same family — the difference is the key
    isAvailable: true,
    async encrypt(plaintext: Buffer) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', altKek, iv);
      const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, ct]);
    },
    async decrypt(ciphertext: Buffer) {
      const iv = ciphertext.subarray(0, 12);
      const tag = ciphertext.subarray(12, 28);
      const ct = ciphertext.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', altKek, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    },
  };
}

describe('envelopeEncrypt / envelopeDecrypt', () => {
  it('roundtrips a typical OAuth refresh_token', async () => {
    const plaintext = '1//0g_FAKE_REFRESH_TOKEN_test_value_abcdef';
    const env = await envelopeEncrypt(plaintext, inMemoryKmsAdapter);
    expect(env.algorithm).toBe('AES-256-GCM');
    expect(env.kmsAdapter).toBe('in-memory-dev');
    const back = await envelopeDecrypt(env, inMemoryKmsAdapter);
    expect(back).toBe(plaintext);
  });

  it('different plaintexts produce different ciphertexts AND IVs', async () => {
    const a = await envelopeEncrypt('plaintext-A', inMemoryKmsAdapter);
    const b = await envelopeEncrypt('plaintext-B-different', inMemoryKmsAdapter);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.encryptedDek).not.toBe(b.encryptedDek); // fresh DEK per op
  });

  it('same plaintext encrypted twice yields different ciphertext (random IV + DEK)', async () => {
    const pt = 'identical-plaintext';
    const a = await envelopeEncrypt(pt, inMemoryKmsAdapter);
    const b = await envelopeEncrypt(pt, inMemoryKmsAdapter);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.encryptedDek).not.toBe(b.encryptedDek);
    // But both decrypt to the same value.
    expect(await envelopeDecrypt(a, inMemoryKmsAdapter)).toBe(pt);
    expect(await envelopeDecrypt(b, inMemoryKmsAdapter)).toBe(pt);
  });

  it('tampered authTag is rejected', async () => {
    const env = await envelopeEncrypt('victim-payload', inMemoryKmsAdapter);
    const tampered: EnvelopeCiphertext = {
      ...env,
      // Flip one bit of the authTag.
      authTag: flipFirstBitBase64(env.authTag),
    };
    await expect(envelopeDecrypt(tampered, inMemoryKmsAdapter)).rejects.toThrow();
  });

  it('tampered ciphertext is rejected', async () => {
    const env = await envelopeEncrypt('victim-payload-2', inMemoryKmsAdapter);
    const tampered: EnvelopeCiphertext = {
      ...env,
      ciphertext: flipFirstBitBase64(env.ciphertext),
    };
    await expect(envelopeDecrypt(tampered, inMemoryKmsAdapter)).rejects.toThrow();
  });

  it('decrypt with a different KEK fails', async () => {
    const env = await envelopeEncrypt('cross-key-payload', inMemoryKmsAdapter);
    const alt = makeAlternateAdapter();
    // The unwrapped DEK from `alt` will be junk → AES-GCM auth check fails,
    // OR DEK length check fails first. Either way, must throw.
    await expect(envelopeDecrypt(env, alt)).rejects.toThrow();
  });

  it('roundtrips the empty string', async () => {
    const env = await envelopeEncrypt('', inMemoryKmsAdapter);
    expect(env.ciphertext).toBe(''); // base64 of zero bytes
    const back = await envelopeDecrypt(env, inMemoryKmsAdapter);
    expect(back).toBe('');
  });

  it('roundtrips a long plaintext (~2KB) like a full OAuth response', async () => {
    // Roughly the size of a Google OAuth response with id_token JWT etc.
    const long = 'x'.repeat(2048) + '-tail';
    const env = await envelopeEncrypt(long, inMemoryKmsAdapter);
    const back = await envelopeDecrypt(env, inMemoryKmsAdapter);
    expect(back).toBe(long);
  });

  it('refuses an envelope with unsupported algorithm', async () => {
    const env = await envelopeEncrypt('whatever', inMemoryKmsAdapter);
    const broken = { ...env, algorithm: 'AES-128-CBC' as unknown as 'AES-256-GCM' };
    await expect(envelopeDecrypt(broken, inMemoryKmsAdapter)).rejects.toThrow(/algorithm/);
  });

  it('refuses an envelope wrapped by a different adapter family', async () => {
    const env = await envelopeEncrypt('whatever', inMemoryKmsAdapter);
    // Pretend this envelope came from cloud-kms; trying to unwrap with
    // in-memory-dev should be rejected at the type-guard layer (cleaner
    // error than letting the crypto layer fail later).
    const mismatched: EnvelopeCiphertext = { ...env, kmsAdapter: 'cloud-kms' };
    await expect(envelopeDecrypt(mismatched, inMemoryKmsAdapter)).rejects.toThrow(/adapter mismatch/);
  });

  it('noop adapter roundtrips (break-glass path still works)', async () => {
    const env = await envelopeEncrypt('break-glass', noopKmsAdapter);
    expect(env.kmsAdapter).toBe('noop');
    const back = await envelopeDecrypt(env, noopKmsAdapter);
    expect(back).toBe('break-glass');
  });
});

describe('isEnvelopeCiphertext', () => {
  it('accepts a real envelope', async () => {
    const env = await envelopeEncrypt('v', inMemoryKmsAdapter);
    expect(isEnvelopeCiphertext(env)).toBe(true);
  });
  it('rejects a plain string (legacy plaintext token)', () => {
    expect(isEnvelopeCiphertext('1//0g_legacy_refresh_token')).toBe(false);
  });
  it('rejects null / undefined / arbitrary objects', () => {
    expect(isEnvelopeCiphertext(null)).toBe(false);
    expect(isEnvelopeCiphertext(undefined)).toBe(false);
    expect(isEnvelopeCiphertext({ ciphertext: 'x' })).toBe(false);
    expect(isEnvelopeCiphertext({ algorithm: 'AES-256-GCM' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------

/**
 * Flip the lowest bit of the first byte of a base64 string. Returns a new
 * base64 string of the same length. Used to corrupt one byte while keeping
 * the input parseable as base64.
 */
function flipFirstBitBase64(b64: string): string {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0) return b64;
  buf[0] = buf[0] ^ 0x01;
  return buf.toString('base64');
}
