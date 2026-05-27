// Praeventio Guard — P0 security fix tests (SQLite mobile encryption).
//
// Verifies that getOrGenerateSqlitePassphrase():
//   1. Returns a 64-character hex string (32 bytes, 256 bits) on first call.
//   2. Persists the passphrase to @capacitor/preferences.
//   3. Returns the SAME value on subsequent calls so the existing SQLCipher
//      database remains openable.
//   4. Regenerates when the persisted value is malformed (defensive against
//      partial / torn keychain writes).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory shim for @capacitor/preferences. Resets per test via beforeEach.
const prefStore = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    async get({ key }: { key: string }) {
      return { value: prefStore.get(key) ?? null };
    },
    async set({ key, value }: { key: string; value: string }) {
      prefStore.set(key, value);
    },
    async remove({ key }: { key: string }) {
      prefStore.delete(key);
    },
  },
}));

// Vitest's node environment provides `crypto` via @types/node; if a test
// runner ever drops the global, fall back to webcrypto explicitly.
if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  const { webcrypto } = await import('node:crypto');
  // @ts-expect-error — test-only assignment for older node runners.
  globalThis.crypto = webcrypto;
}

const { getOrGenerateSqlitePassphrase, __SQLITE_PASSPHRASE_KEY } = await import(
  './sqliteEncryption'
);

describe('getOrGenerateSqlitePassphrase', () => {
  beforeEach(() => {
    prefStore.clear();
  });

  it('returns a 64-character lower-case hex string on first call', async () => {
    const passphrase = await getOrGenerateSqlitePassphrase();
    expect(passphrase).toHaveLength(64);
    expect(passphrase).toMatch(/^[0-9a-f]{64}$/);
  });

  it('persists the passphrase to @capacitor/preferences', async () => {
    const passphrase = await getOrGenerateSqlitePassphrase();
    expect(prefStore.get(__SQLITE_PASSPHRASE_KEY)).toBe(passphrase);
  });

  it('returns the SAME passphrase on subsequent calls (idempotent)', async () => {
    const first = await getOrGenerateSqlitePassphrase();
    const second = await getOrGenerateSqlitePassphrase();
    const third = await getOrGenerateSqlitePassphrase();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('regenerates when the persisted value is malformed (wrong length)', async () => {
    // Simulate a torn / partial write — shorter than expected hex length.
    prefStore.set(__SQLITE_PASSPHRASE_KEY, 'too-short');
    const passphrase = await getOrGenerateSqlitePassphrase();
    expect(passphrase).toHaveLength(64);
    expect(passphrase).not.toBe('too-short');
    // The new value must be persisted so the next boot is idempotent again.
    expect(prefStore.get(__SQLITE_PASSPHRASE_KEY)).toBe(passphrase);
  });

  it('produces non-trivial entropy across cold starts', async () => {
    // Two fresh "devices" should not happen to share a passphrase.
    prefStore.clear();
    const a = await getOrGenerateSqlitePassphrase();
    prefStore.clear();
    const b = await getOrGenerateSqlitePassphrase();
    expect(a).not.toBe(b);
  });
});
