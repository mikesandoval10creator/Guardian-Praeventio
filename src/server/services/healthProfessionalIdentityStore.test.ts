import { describe, expect, it } from 'vitest';

import { inMemoryKmsAdapter } from '../../services/security/kmsAdapter';
import {
  HealthProfessionalIdentityStoreError,
  createHealthProfessionalIdentityStore,
  normalizeChileanRut,
  type ProfessionalIdentityRepository,
} from './healthProfessionalIdentityStore';
import type { HealthProfessionalIdentity } from '../../services/health/professionalIdentity';

function memoryRepository(): ProfessionalIdentityRepository & {
  rows: Map<string, HealthProfessionalIdentity>;
} {
  const rows = new Map<string, HealthProfessionalIdentity>();
  return {
    rows,
    async get(uid) {
      return rows.get(uid) ?? null;
    },
    async findByRutLookupHmac(rutLookupHmac) {
      return [...rows.values()].find((row) => row.rutLookupHmac === rutLookupHmac) ?? null;
    },
    async createUnique(identity) {
      if (rows.has(identity.uid)) return 'uid_conflict';
      if ([...rows.values()].some((row) => row.rutLookupHmac === identity.rutLookupHmac)) {
        return 'rut_conflict';
      }
      rows.set(identity.uid, identity);
      return 'created';
    },
    async replaceWithAudit(identity) {
      rows.set(identity.uid, identity);
    },
    async listEligible() {
      return [...rows.values()].filter(
        (row) => row.status === 'provisional' || row.status === 'verified',
      );
    },
  };
}

const INPUT = {
  uid: 'doctor-external-1',
  displayName: 'Dra. Elena Morales',
  rut: '12.345.678-5',
  registryNumber: 'RNPI-12345',
} as const;

describe('healthProfessionalIdentityStore', () => {
  it('normalizes and validates Chilean RUTs', () => {
    expect(normalizeChileanRut('12.345.678-5')).toBe('123456785');
    expect(() => normalizeChileanRut('12.345.678-9')).toThrow(
      HealthProfessionalIdentityStoreError,
    );
  });

  it('encrypts the RUT, creates a deterministic lookup HMAC and stores no plaintext', async () => {
    const repo = memoryRepository();
    const store = createHealthProfessionalIdentityStore({
      repository: repo,
      kmsAdapter: inMemoryKmsAdapter,
      lookupKey: 'a'.repeat(64),
      now: () => 1_753_056_000_000,
    });

    const identity = await store.enroll(INPUT);
    const persisted = repo.rows.get(INPUT.uid)!;

    expect(identity.status).toBe('pending');
    expect(persisted.rutCiphertext.ciphertext).not.toContain('123456785');
    expect(persisted.rutLookupHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(persisted)).not.toContain('12.345.678-5');
    expect(JSON.stringify(persisted)).not.toContain('123456785');

    const secondRepo = memoryRepository();
    const secondStore = createHealthProfessionalIdentityStore({
      repository: secondRepo,
      kmsAdapter: inMemoryKmsAdapter,
      lookupKey: 'a'.repeat(64),
    });
    const second = await secondStore.enroll({ ...INPUT, uid: 'doctor-external-2' });
    expect(second.rutLookupHmac).toBe(identity.rutLookupHmac);
  });

  it('rejects a duplicated civil identity without disclosing which account owns it', async () => {
    const repo = memoryRepository();
    const store = createHealthProfessionalIdentityStore({
      repository: repo,
      kmsAdapter: inMemoryKmsAdapter,
      lookupKey: 'b'.repeat(64),
    });
    await store.enroll(INPUT);

    await expect(store.enroll({ ...INPUT, uid: 'attacker-account' })).rejects.toMatchObject({
      code: 'professional_identity_conflict',
    });
  });

  it.each([undefined, '', 'short'])('fails closed when lookup key is %s', async (lookupKey) => {
    const store = createHealthProfessionalIdentityStore({
      repository: memoryRepository(),
      kmsAdapter: inMemoryKmsAdapter,
      lookupKey,
    });

    await expect(store.enroll(INPUT)).rejects.toMatchObject({
      code: 'professional_security_unavailable',
    });
  });

  it('fails closed when KMS is unavailable', async () => {
    const store = createHealthProfessionalIdentityStore({
      repository: memoryRepository(),
      kmsAdapter: {
        name: 'cloud-kms',
        isAvailable: false,
        async encrypt() {
          throw new Error('not configured');
        },
        async decrypt() {
          throw new Error('not configured');
        },
      },
      lookupKey: 'c'.repeat(64),
    });

    await expect(store.enroll(INPUT)).rejects.toMatchObject({
      code: 'professional_security_unavailable',
    });
  });
});
