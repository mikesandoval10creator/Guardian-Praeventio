import { describe, expect, it } from 'vitest';
import {
  ComplianceSignerIdentityError,
  resolveConfiguredKmsSigner,
  resolveHumanComplianceSigner,
  type MinimalSignerProfileStore,
} from './complianceSignerIdentity.js';

function store(profile: Record<string, unknown> | null): MinimalSignerProfileStore {
  return { loadSignerProfile: async () => profile };
}

describe('resolveHumanComplianceSigner', () => {
  it('uses the authenticated uid and server profile RUT in canonical format', async () => {
    await expect(
      resolveHumanComplianceSigner('auth-uid', store({ uid: 'forged', rut: '123456785' })),
    ).resolves.toEqual({ uid: 'auth-uid', rut: '12.345.678-5', kind: 'human' });
  });

  it.each([
    ['missing user', null],
    ['missing RUT', { displayName: 'Ada' }],
    ['invalid RUT', { rut: '12.345.678-9' }],
  ])('fails closed for %s', async (_label, profile) => {
    const error = await resolveHumanComplianceSigner('auth-uid', store(profile)).catch((value) => value);
    expect(error).toBeInstanceOf(ComplianceSignerIdentityError);
    expect(error.code).toBe('signer_identity_incomplete');
  });

  it('rejects an empty authenticated uid before reading a profile', async () => {
    let reads = 0;
    await expect(
      resolveHumanComplianceSigner('', {
        loadSignerProfile: async () => { reads += 1; return { rut: '123456785' }; },
      }),
    ).rejects.toMatchObject({ code: 'signer_identity_incomplete' });
    expect(reads).toBe(0);
  });
});

describe('resolveConfiguredKmsSigner', () => {
  it('loads and validates the fixed machine identity', () => {
    expect(resolveConfiguredKmsSigner({
      COMPLIANCE_KMS_SIGNER_UID: 'compliance-kms',
      COMPLIANCE_KMS_SIGNER_RUT: '123456785',
    })).toEqual({ uid: 'compliance-kms', rut: '12.345.678-5', kind: 'kms' });
  });

  it.each([
    [{ COMPLIANCE_KMS_SIGNER_RUT: '123456785' }],
    [{ COMPLIANCE_KMS_SIGNER_UID: 'compliance-kms' }],
    [{ COMPLIANCE_KMS_SIGNER_UID: 'compliance-kms', COMPLIANCE_KMS_SIGNER_RUT: '12.345.678-9' }],
  ])('rejects incomplete or invalid machine identity', (env) => {
    expect(() => resolveConfiguredKmsSigner(env)).toThrow(ComplianceSignerIdentityError);
  });
});
