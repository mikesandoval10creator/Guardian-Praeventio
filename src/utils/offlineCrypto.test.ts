import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for IndexedDB so the device-bound key persists across calls
// without a real browser. A non-extractable CryptoKey is structured-clonable, so
// a Map round-trips it like IndexedDB would.
const store = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => {
    store.set(k, v);
    return Promise.resolve();
  },
}));
vi.mock('./logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { encryptData, decryptData, __resetOfflineKeyForTests } from './offlineCrypto';

beforeEach(() => {
  store.clear();
  __resetOfflineKeyForTests();
});

describe('offlineCrypto — real AES-256-GCM (not base64 theatre)', () => {
  it('round-trips an object through genuine encryption', async () => {
    // Distinctive multi-char PII markers: a 3-char name like "Ana" can appear
    // by chance inside random base64 ciphertext (~1/200k per offset × many
    // offsets → an intermittently-flaky `not.toContain`). Longer markers make
    // the leak-check statistically sound (a coincidental hit is ~impossible)
    // while preserving the intent: the plaintext PII must not survive in the
    // ciphertext.
    const data = {
      id: 'w1',
      name: 'AnastasiaConfidencialMarker',
      projectId: 'p1',
      rut: '11.111.111-1',
    };
    const enc = await encryptData(data);
    expect(enc.startsWith('v1:')).toBe(true);
    // The ciphertext must NOT leak the plaintext (the old base64 did).
    expect(enc).not.toContain('AnastasiaConfidencialMarker');
    expect(enc).not.toContain('11.111.111-1');
    expect(await decryptData(enc)).toEqual(data);
  });

  it('uses a fresh random IV each time (same input → different ciphertext)', async () => {
    const a = await encryptData({ x: 1 });
    const b = await encryptData({ x: 1 });
    expect(a).not.toBe(b);
    expect(await decryptData(a)).toEqual({ x: 1 });
    expect(await decryptData(b)).toEqual({ x: 1 });
  });

  it('still reads legacy base64 payloads (migration-safe upgrade)', async () => {
    const legacy = btoa(encodeURIComponent(JSON.stringify({ id: 'old', v: 1 })));
    expect(await decryptData(legacy)).toEqual({ id: 'old', v: 1 });
  });

  it('returns null on a tampered ciphertext (authenticated encryption)', async () => {
    const enc = await encryptData({ id: 'w1', secret: 42 });
    const i = 6; // a byte inside the iv/ciphertext, past the `v1:` prefix
    const swapped = enc[i] === 'A' ? 'B' : 'A';
    const tampered = enc.slice(0, i) + swapped + enc.slice(i + 1);
    expect(await decryptData(tampered)).toBeNull();
  });
});
