// Praeventio Guard — P0 security fix tests (SQLite mobile encryption).
//
// Verifies that ensureSqliteEncryptionSecret():
//   1. Returns mode 'secret' on first run (no secret in plugin's secure
//      store yet) and calls setEncryptionSecret with a 64-char hex
//      passphrase generated via WebCrypto.
//   2. Returns mode 'encryption' on subsequent runs without calling
//      setEncryptionSecret again (Codex P2 3308579650 — re-setting
//      rejects).
//   3. Does NOT persist the passphrase via @capacitor/preferences (Codex
//      P1 3308579640 — that surface is not a keychain on either platform).
//      The plugin's setEncryptionSecret holds it in the native secure
//      store; we never touch it again.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Vitest's node environment provides `crypto` via @types/node; if a test
// runner ever drops the global, fall back to webcrypto explicitly.
if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  const { webcrypto } = await import('node:crypto');
  // @ts-expect-error — test-only assignment for older node runners.
  globalThis.crypto = webcrypto;
}

const { ensureSqliteEncryptionSecret } = await import('./sqliteEncryption');

interface MockConnection {
  isSecretStored: ReturnType<typeof vi.fn>;
  setEncryptionSecret: ReturnType<typeof vi.fn>;
}

function newMockConnection(secretStored: boolean): MockConnection {
  return {
    isSecretStored: vi.fn(async () => ({ result: secretStored })),
    setEncryptionSecret: vi.fn(async () => undefined),
  };
}

describe('ensureSqliteEncryptionSecret', () => {
  it('returns mode "secret" on first run and sets a 64-char hex passphrase', async () => {
    const conn = newMockConnection(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mode = await ensureSqliteEncryptionSecret(conn as any);
    expect(mode).toBe('secret');
    expect(conn.isSecretStored).toHaveBeenCalledTimes(1);
    expect(conn.setEncryptionSecret).toHaveBeenCalledTimes(1);
    const [passphrase] = conn.setEncryptionSecret.mock.calls[0];
    expect(typeof passphrase).toBe('string');
    expect(passphrase).toHaveLength(64);
    expect(passphrase).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns mode "encryption" on subsequent runs without re-setting the secret', async () => {
    const conn = newMockConnection(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mode = await ensureSqliteEncryptionSecret(conn as any);
    expect(mode).toBe('encryption');
    expect(conn.isSecretStored).toHaveBeenCalledTimes(1);
    expect(conn.setEncryptionSecret).not.toHaveBeenCalled();
  });

  it('generates distinct passphrases across fresh devices', async () => {
    const connA = newMockConnection(false);
    const connB = newMockConnection(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureSqliteEncryptionSecret(connA as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureSqliteEncryptionSecret(connB as any);
    const passA = connA.setEncryptionSecret.mock.calls[0][0];
    const passB = connB.setEncryptionSecret.mock.calls[0][0];
    expect(passA).not.toBe(passB);
  });

  it('does not import @capacitor/preferences (passphrase stays in plugin secure store)', async () => {
    // Contract test against the Codex P1 3308579640 regression: ensure
    // no future change re-introduces @capacitor/preferences as the
    // passphrase persistence layer (it is NOT a keychain on either
    // platform). We allow the string to appear in comments (explaining
    // why we don't use it) but ban any import or method call.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(__dirname, './sqliteEncryption.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/^\s*import .* from ['"]@capacitor\/preferences['"]/m);
    expect(src).not.toMatch(/Preferences\.get\s*\(|Preferences\.set\s*\(/);
  });
});
