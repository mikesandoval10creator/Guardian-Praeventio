/**
 * Tests for `slmIntegrityGuard.ts` — SHA-256 motor + SlmIntegrityError.
 *
 * Uses known-vector SHA-256 values so the implementation has to actually
 * exercise Web Crypto SubtleCrypto, not a stub. Vitest's test environment
 * (jsdom + Node) exposes `globalThis.crypto.subtle.digest`; we run these
 * tests against the real digest implementation to catch encoding bugs.
 */

import { describe, expect, it } from 'vitest';

import {
  SlmIntegrityError,
  assertModelIntegrity,
  computeSha256Hex,
  verifyBundleIntegrity,
} from './slmIntegrityGuard';

// Known SHA-256 vectors. Verified against `printf '...' | sha256sum`.
const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const HELLO_SHA256 =
  '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const ABC_SHA256 =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('computeSha256Hex', () => {
  it('hashes an empty buffer to the canonical SHA-256 empty digest', async () => {
    const hex = await computeSha256Hex(new Uint8Array(0));
    expect(hex).toBe(EMPTY_SHA256);
  });

  it('hashes "hello" to the canonical SHA-256 digest', async () => {
    const hex = await computeSha256Hex(bytesOf('hello'));
    expect(hex).toBe(HELLO_SHA256);
  });

  it('hashes "abc" to the canonical SHA-256 digest', async () => {
    const hex = await computeSha256Hex(bytesOf('abc'));
    expect(hex).toBe(ABC_SHA256);
  });

  it('accepts a raw ArrayBuffer (not just Uint8Array)', async () => {
    const buf = bytesOf('hello').buffer;
    const hex = await computeSha256Hex(buf);
    expect(hex).toBe(HELLO_SHA256);
  });

  it('hashes the same content identically across calls (determinism)', async () => {
    const a = await computeSha256Hex(bytesOf('hello'));
    const b = await computeSha256Hex(bytesOf('hello'));
    expect(a).toBe(b);
  });

  it('produces 64 lowercase hex chars', async () => {
    const hex = await computeSha256Hex(bytesOf('hello'));
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes a Uint8Array view of a larger buffer correctly', async () => {
    // "xxhelloyy" — view only "hello"
    const big = bytesOf('xxhelloyy');
    const view = new Uint8Array(big.buffer, 2, 5);
    expect(new TextDecoder().decode(view)).toBe('hello');
    const hex = await computeSha256Hex(view);
    expect(hex).toBe(HELLO_SHA256);
  });
});

describe('assertModelIntegrity', () => {
  it('returns the computed hash when no expected hash is provided (null)', async () => {
    const hex = await assertModelIntegrity(bytesOf('hello'), null);
    expect(hex).toBe(HELLO_SHA256);
  });

  it('returns the computed hash when expected is undefined', async () => {
    const hex = await assertModelIntegrity(bytesOf('hello'), undefined);
    expect(hex).toBe(HELLO_SHA256);
  });

  it('returns the computed hash when expected is empty string', async () => {
    const hex = await assertModelIntegrity(bytesOf('hello'), '');
    expect(hex).toBe(HELLO_SHA256);
  });

  it('passes when expected matches (lowercase)', async () => {
    const hex = await assertModelIntegrity(
      bytesOf('hello'),
      HELLO_SHA256,
      'test-model',
    );
    expect(hex).toBe(HELLO_SHA256);
  });

  it('passes when expected matches (uppercase — case-insensitive)', async () => {
    const hex = await assertModelIntegrity(
      bytesOf('hello'),
      HELLO_SHA256.toUpperCase(),
      'test-model',
    );
    expect(hex).toBe(HELLO_SHA256);
  });

  it('throws SlmIntegrityError when expected does not match', async () => {
    await expect(
      assertModelIntegrity(
        bytesOf('hello'),
        EMPTY_SHA256, // wrong expectation
        'test-model',
      ),
    ).rejects.toThrow(SlmIntegrityError);
  });

  it('attaches expected + computed hashes to the thrown error', async () => {
    try {
      await assertModelIntegrity(bytesOf('hello'), EMPTY_SHA256, 'phi-3-mini');
      throw new Error('expected SlmIntegrityError but assertion resolved');
    } catch (err) {
      expect(err).toBeInstanceOf(SlmIntegrityError);
      const e = err as SlmIntegrityError;
      expect(e.expectedSha256).toBe(EMPTY_SHA256);
      expect(e.computedSha256).toBe(HELLO_SHA256);
      expect(e.message).toContain('phi-3-mini');
      expect(e.message).toContain(EMPTY_SHA256);
      expect(e.message).toContain(HELLO_SHA256);
    }
  });

  it('SlmIntegrityError instances are catchable as Error and named correctly', () => {
    const e = new SlmIntegrityError('aaa', 'bbb', 'foo');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('SlmIntegrityError');
  });
});

describe('Sprint 54 verifyBundleIntegrity — modelos split + companions', () => {
  it('bundle con todos los hashes correctos → allVerified true', async () => {
    const r = await verifyBundleIntegrity('phi-3-mini', [
      { filename: 'model.onnx', payload: bytesOf('hello'), expectedSha256: HELLO_SHA256 },
      { filename: 'model.onnx_data', payload: bytesOf('abc'), expectedSha256: ABC_SHA256 },
    ]);
    expect(r.allVerified).toBe(true);
    expect(r.files).toHaveLength(2);
    expect(r.unverifiedCount).toBe(0);
    expect(r.mismatchCount).toBe(0);
  });

  it('un archivo con hash inválido → throw + falla rápido', async () => {
    await expect(
      verifyBundleIntegrity('phi-3-mini', [
        { filename: 'model.onnx', payload: bytesOf('hello'), expectedSha256: HELLO_SHA256 },
        { filename: 'model.onnx_data', payload: bytesOf('abc'), expectedSha256: 'a'.repeat(64) },
      ]),
    ).rejects.toThrowError(SlmIntegrityError);
  });

  it('el SlmIntegrityError reporta el companion file específico', async () => {
    try {
      await verifyBundleIntegrity('phi-3-mini', [
        { filename: 'model.onnx', payload: bytesOf('hello'), expectedSha256: HELLO_SHA256 },
        { filename: 'companion.onnx_data', payload: bytesOf('abc'), expectedSha256: 'a'.repeat(64) },
      ]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SlmIntegrityError);
      expect((e as Error).message).toContain('companion.onnx_data');
      expect((e as SlmIntegrityError).computedSha256).toBe(ABC_SHA256);
    }
  });

  it('archivos con expectedSha256=null se cuentan como unverified pero no fallan', async () => {
    const r = await verifyBundleIntegrity('gemma-2-2b', [
      { filename: 'model.onnx', payload: bytesOf('hello'), expectedSha256: null },
    ]);
    expect(r.unverifiedCount).toBe(1);
    expect(r.allVerified).toBe(false);
    expect(r.files[0]!.passed).toBe(true); // pass porque sin expectation
  });

  it('mixed: 1 verified + 1 unverified → allVerified false (caller decide)', async () => {
    const r = await verifyBundleIntegrity('mixed', [
      { filename: 'a.onnx', payload: bytesOf('hello'), expectedSha256: HELLO_SHA256 },
      { filename: 'b.onnx_data', payload: bytesOf('abc'), expectedSha256: null },
    ]);
    expect(r.allVerified).toBe(false);
    expect(r.unverifiedCount).toBe(1);
    expect(r.mismatchCount).toBe(0);
  });

  it('reporta computedSha256 para todos los archivos (útil para release pipeline)', async () => {
    const r = await verifyBundleIntegrity('first-download', [
      { filename: 'a.onnx', payload: bytesOf('hello'), expectedSha256: null },
      { filename: 'b.onnx', payload: bytesOf('abc'), expectedSha256: null },
    ]);
    expect(r.files[0]!.computedSha256).toBe(HELLO_SHA256);
    expect(r.files[1]!.computedSha256).toBe(ABC_SHA256);
  });

  it('bundle vacío → allVerified true (trivially)', async () => {
    const r = await verifyBundleIntegrity('empty', []);
    expect(r.allVerified).toBe(true);
    expect(r.files).toHaveLength(0);
  });
});
