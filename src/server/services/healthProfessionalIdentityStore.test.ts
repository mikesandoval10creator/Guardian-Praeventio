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
    async createUnique(identity, rutLookupHmacs) {
      if (rows.has(identity.uid)) return 'uid_conflict';
      if ([...rows.values()].some((row) => rutLookupHmacs.includes(row.rutLookupHmac))) {
        return 'rut_conflict';
      }
      rows.set(identity.uid, identity);
      return 'created';
    },
    async transitionWithAudit(uid, transition) {
      const current = rows.get(uid);
      if (!current) return null;
      const { applyProfessionalIdentityTransition } = await import(
        '../../services/health/professionalIdentity'
      );
      const updated = applyProfessionalIdentityTransition(current, transition);
      rows.set(uid, updated);
      return updated;
    },
    async searchEligible(query) {
      return [...rows.values()].filter((row) =>
        (row.status === 'provisional' || row.status === 'verified') &&
        (!query || row.searchPrefixes.includes(query)),
      );
    },
    async recordRegistryCheckWithAudit(uid, verification, _actorUid, at) {
      const current = rows.get(uid);
      if (!current) return null;
      const updated: HealthProfessionalIdentity = {
        ...current,
        registryAssurance: {
          provider: verification.provider,
          status: verification.status,
          checkedAt: at,
        },
        updatedAt: at,
      };
      rows.set(uid, updated);
      return updated;
    },
    async listForLookupReindex(afterUid, limit) {
      return [...rows.values()]
        .sort((left, right) => left.uid.localeCompare(right.uid))
        .filter((row) => !afterUid || row.uid > afterUid)
        .slice(0, limit);
    },
    async reindexLookupHmacs(input) {
      const current = rows.get(input.uid);
      if (!current) return 'not_found';
      if (current.rutLookupHmac !== input.expectedCurrentHmac) return 'conflict';
      const unchanged = current.rutLookupHmac === input.primaryHmac &&
        current.rutLookupHmacVersion === input.primaryVersion;
      rows.set(input.uid, {
        ...current,
        rutLookupHmac: input.primaryHmac,
        rutLookupHmacVersion: input.primaryVersion,
        updatedAt: input.at,
      });
      return unchanged ? 'unchanged' : 'updated';
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
    expect(identity.rutLookupHmacVersion).toBe('v1');
    expect(identity.searchPrefixes).toContain('elena');
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

  it('dual-reads HMAC versions so key rotation cannot duplicate a civil identity', async () => {
    const repo = memoryRepository();
    const oldStore = createHealthProfessionalIdentityStore({
      repository: repo,
      kmsAdapter: inMemoryKmsAdapter,
      lookupKeys: [{ version: '2026-01', key: 'o'.repeat(64) }],
    });
    await oldStore.enroll(INPUT);

    const rotatingStore = createHealthProfessionalIdentityStore({
      repository: repo,
      kmsAdapter: inMemoryKmsAdapter,
      lookupKeys: [
        { version: '2026-07', key: 'n'.repeat(64) },
        { version: '2026-01', key: 'o'.repeat(64) },
      ],
    });
    await expect(
      rotatingStore.enroll({ ...INPUT, uid: 'doctor-external-2' }),
    ).rejects.toMatchObject({ code: 'professional_identity_conflict' });
  });

  it('reindexes existing encrypted identities to the new primary HMAC without persisting plaintext', async () => {
    const repo = memoryRepository();
    const oldStore = createHealthProfessionalIdentityStore({
      repository: repo,
      kmsAdapter: inMemoryKmsAdapter,
      lookupKeys: [{ version: '2026-01', key: 'o'.repeat(64) }],
      now: () => 1_753_056_000_000,
    });
    const oldIdentity = await oldStore.enroll(INPUT);

    const rotatingStore = createHealthProfessionalIdentityStore({
      repository: repo,
      kmsAdapter: inMemoryKmsAdapter,
      lookupKeys: [
        { version: '2026-07', key: 'n'.repeat(64) },
        { version: '2026-01', key: 'o'.repeat(64) },
      ],
      now: () => 1_753_142_400_000,
    });
    const page = await rotatingStore.reindexLookupKeys({
      actorUid: 'security-operator-1',
      limit: 100,
    });

    expect(page).toEqual({ processed: 1, updated: 1, unchanged: 0, done: true });
    const updated = repo.rows.get(INPUT.uid)!;
    expect(updated.rutLookupHmacVersion).toBe('2026-07');
    expect(updated.rutLookupHmac).not.toBe(oldIdentity.rutLookupHmac);
    expect(JSON.stringify(updated)).not.toContain('123456785');

    await expect(
      rotatingStore.enroll({ ...INPUT, uid: 'doctor-external-2' }),
    ).rejects.toMatchObject({ code: 'professional_identity_conflict' });
  });

  it('revalidates through the fail-closed registry stub without changing pending status', async () => {
    const repo = memoryRepository();
    const { StubProfessionalRegistryProvider } = await import(
      '../../services/health/professionalRegistryProvider'
    );
    const store = createHealthProfessionalIdentityStore({
      repository: repo,
      kmsAdapter: inMemoryKmsAdapter,
      lookupKey: 'r'.repeat(64),
      registryProvider: new StubProfessionalRegistryProvider('not_configured'),
      now: () => 1_753_056_000_000,
    });
    await store.enroll(INPUT);

    const result = await store.revalidate({
      targetUid: INPUT.uid,
      reviewerUid: 'platform-reviewer-1',
    });

    expect(result.verification.status).toBe('not_configured');
    expect(result.identity.status).toBe('pending');
    expect(result.identity.registryAssurance.status).toBe('not_configured');
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
