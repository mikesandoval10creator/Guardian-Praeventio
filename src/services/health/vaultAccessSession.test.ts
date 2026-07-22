import { describe, expect, it } from 'vitest';

import {
  VaultAccessSessionError,
  createVaultAccessSession,
  revokeVaultAccessSession,
  validateVaultAccessSession,
} from './vaultAccessSession';

const NOW = 1_753_056_000_000;
const now = () => NOW;

describe('vault access session', () => {
  it('stores only a hash and binds the session to grant and professional', () => {
    const { record, secret } = createVaultAccessSession({
      grantId: 'grant-1',
      professionalUid: 'doctor-1',
      now,
    });

    expect(record.grantId).toBe('grant-1');
    expect(record.professionalUid).toBe('doctor-1');
    expect(record.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain(secret);
    expect(() =>
      validateVaultAccessSession(record, secret, {
        grantId: 'grant-1',
        professionalUid: 'doctor-1',
        now,
      }),
    ).not.toThrow();
  });

  it.each([
    ['another grant', { grantId: 'grant-2', professionalUid: 'doctor-1' }, 'session_scope_mismatch'],
    ['another doctor', { grantId: 'grant-1', professionalUid: 'doctor-2' }, 'session_scope_mismatch'],
  ] as const)('rejects %s', (_label, scope, code) => {
    const { record, secret } = createVaultAccessSession({
      grantId: 'grant-1',
      professionalUid: 'doctor-1',
      now,
    });
    expect(() => validateVaultAccessSession(record, secret, { ...scope, now })).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('expires after a short TTL and fails closed after revocation', () => {
    const { record, secret } = createVaultAccessSession({
      grantId: 'grant-1',
      professionalUid: 'doctor-1',
      ttlMinutes: 5,
      now,
    });
    expect(() =>
      validateVaultAccessSession(record, secret, {
        grantId: 'grant-1',
        professionalUid: 'doctor-1',
        now: () => NOW + 5 * 60_000 + 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'session_expired' }));

    const revoked = revokeVaultAccessSession(record, { now });
    expect(() =>
      validateVaultAccessSession(revoked, secret, {
        grantId: 'grant-1',
        professionalUid: 'doctor-1',
        now,
      }),
    ).toThrowError(expect.objectContaining({ code: 'session_revoked' }));
  });

  it('rejects an invalid secret without throwing crypto length errors', () => {
    const { record } = createVaultAccessSession({
      grantId: 'grant-1',
      professionalUid: 'doctor-1',
      now,
    });
    expect(() =>
      validateVaultAccessSession(record, 'bad', {
        grantId: 'grant-1',
        professionalUid: 'doctor-1',
        now,
      }),
    ).toThrowError(VaultAccessSessionError);
  });
});
