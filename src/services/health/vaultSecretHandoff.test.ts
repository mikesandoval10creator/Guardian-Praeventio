import { describe, expect, it } from 'vitest';

import {
  consumeVaultSecretHandoff,
  createVaultSecretHandoff,
} from './vaultSecretHandoff';

describe('vaultSecretHandoff', () => {
  it('keeps the secret in memory behind an opaque, single-use nonce', () => {
    const id = createVaultSecretHandoff('clinical-secret', () => 1_000);

    expect(id).not.toContain('clinical-secret');
    expect(JSON.stringify({ returnTo: '/vault/share/grant-1', vaultHandoff: id }))
      .not.toContain('clinical-secret');
    expect(consumeVaultSecretHandoff(id, () => 2_000)).toBe('clinical-secret');
    expect(consumeVaultSecretHandoff(id, () => 2_000)).toBe('');
  });

  it('fails closed after the short handoff window', () => {
    const id = createVaultSecretHandoff('clinical-secret', () => 1_000);
    expect(consumeVaultSecretHandoff(id, () => 11 * 60 * 1_000)).toBe('');
  });
});
