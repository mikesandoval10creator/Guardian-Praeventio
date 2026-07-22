import { describe, expect, it } from 'vitest';

import {
  ProfessionalIdentityError,
  applyProfessionalIdentityTransition,
  canReceiveHealthGrant,
  toProfessionalPublicProfile,
  type HealthProfessionalIdentity,
} from './professionalIdentity';

const BASE: HealthProfessionalIdentity = {
  uid: 'doctor-external-1',
  profession: 'physician',
  country: 'CL',
  displayName: 'Dra. Elena Morales',
  registryAuthority: 'superintendencia_salud_cl',
  registryNumber: 'RNPI-12345',
  rutCiphertext: {
    ciphertext: 'ciphertext',
    iv: 'iv',
    authTag: 'auth-tag',
    encryptedDek: 'wrapped-dek',
    algorithm: 'AES-256-GCM',
    kmsAdapter: 'cloud-kms',
    createdAt: '2026-07-21T00:00:00.000Z',
  },
  rutLookupHmac: 'lookup-hmac',
  status: 'pending',
  registryAssurance: {
    provider: 'superintendencia_salud_cl_stub',
    status: 'not_configured',
    checkedAt: 1_753_056_000_000,
  },
  webauthnRequired: true,
  createdAt: 1_753_056_000_000,
  updatedAt: 1_753_056_000_000,
};

describe('professional identity state machine', () => {
  it('allows audited manual review to produce provisional, never verified', () => {
    const updated = applyProfessionalIdentityTransition(BASE, {
      to: 'provisional',
      actorUid: 'global-admin-1',
      method: 'manual_official_registry_review',
      evidenceReferenceHash: 'sha256:opaque',
      at: 1_753_056_100_000,
    });

    expect(updated.status).toBe('provisional');
    expect(updated.identityAssurance).toEqual({
      level: 'provisional',
      method: 'manual_official_registry_review',
      reviewedBy: 'global-admin-1',
      reviewedAt: 1_753_056_100_000,
      evidenceReferenceHash: 'sha256:opaque',
    });
  });

  it('refuses to manufacture official verification through a manual transition', () => {
    expect(() =>
      applyProfessionalIdentityTransition(BASE, {
        to: 'verified',
        actorUid: 'global-admin-1',
        method: 'manual_official_registry_review',
        evidenceReferenceHash: 'sha256:opaque',
        at: 1_753_056_100_000,
      }),
    ).toThrowError(ProfessionalIdentityError);
  });

  it.each(['pending', 'suspended', 'revoked'] as const)(
    'denies health grants when status is %s',
    (status) => {
      expect(canReceiveHealthGrant({ ...BASE, status })).toBe(false);
    },
  );

  it.each(['provisional', 'verified'] as const)(
    'allows health grants when status is %s and WebAuthn is required',
    (status) => {
      expect(canReceiveHealthGrant({ ...BASE, status })).toBe(true);
      expect(canReceiveHealthGrant({ ...BASE, status, webauthnRequired: false })).toBe(false);
    },
  );

  it('public profile excludes RUT, email, tenant and assurance evidence', () => {
    const profile = toProfessionalPublicProfile({ ...BASE, status: 'provisional' });

    expect(profile).toEqual({
      uid: 'doctor-external-1',
      displayName: 'Dra. Elena Morales',
      profession: 'physician',
      country: 'CL',
      registryAuthority: 'superintendencia_salud_cl',
      registryNumber: 'RNPI-12345',
      status: 'provisional',
    });
    expect(profile).not.toHaveProperty('rutCiphertext');
    expect(profile).not.toHaveProperty('rutLookupHmac');
    expect(profile).not.toHaveProperty('tenantId');
    expect(profile).not.toHaveProperty('email');
  });
});
