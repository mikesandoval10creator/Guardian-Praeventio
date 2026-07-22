import { createHash, createHmac } from 'node:crypto';

import {
  applyProfessionalIdentityTransition,
  canReceiveHealthGrant,
  toProfessionalPublicProfile,
  type HealthProfessionalIdentity,
  type ProfessionalIdentityTransition,
  type ProfessionalPublicProfile,
} from '../../services/health/professionalIdentity';
import type { KmsAdapter } from '../../services/security/kmsAdapter';
import { envelopeDecrypt, envelopeEncrypt } from '../../services/security/kmsEnvelope';
import type {
  ProfessionalRegistryProvider,
  ProfessionalRegistryVerification,
} from '../../services/health/professionalRegistryProvider';

export type ProfessionalIdentityCreateResult =
  | 'created'
  | 'uid_conflict'
  | 'rut_conflict';

export interface ProfessionalIdentityRepository {
  get(uid: string): Promise<HealthProfessionalIdentity | null>;
  findByRutLookupHmac(rutLookupHmac: string): Promise<HealthProfessionalIdentity | null>;
  createUnique(
    identity: HealthProfessionalIdentity,
    rutLookupHmacs: string[],
    auditEntry: Record<string, unknown>,
  ): Promise<ProfessionalIdentityCreateResult>;
  transitionWithAudit(
    uid: string,
    transition: ProfessionalIdentityTransition,
    auditEntry: Record<string, unknown>,
  ): Promise<HealthProfessionalIdentity | null>;
  searchEligible(query: string, limit: number): Promise<HealthProfessionalIdentity[]>;
  recordRegistryCheckWithAudit(
    uid: string,
    verification: ProfessionalRegistryVerification,
    actorUid: string,
    at: number,
  ): Promise<HealthProfessionalIdentity | null>;
  listForLookupReindex(
    afterUid: string | undefined,
    limit: number,
  ): Promise<HealthProfessionalIdentity[]>;
  reindexLookupHmacs(input: {
    uid: string;
    expectedCurrentHmac: string;
    primaryVersion: string;
    primaryHmac: string;
    lookupHmacs: string[];
    auditEntry: Record<string, unknown>;
    at: number;
  }): Promise<'updated' | 'unchanged' | 'not_found' | 'conflict'>;
}

export class HealthProfessionalIdentityStoreError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_professional_identity'
      | 'professional_identity_conflict'
      | 'professional_identity_not_found'
      | 'professional_security_unavailable',
  ) {
    super(message);
    this.name = 'HealthProfessionalIdentityStoreError';
  }
}

function rutCheckDigit(body: string): string {
  let total = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    total += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (total % 11);
  if (result === 11) return '0';
  if (result === 10) return 'K';
  return String(result);
}

export function normalizeChileanRut(input: string): string {
  const normalized = String(input ?? '')
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(normalized)) {
    throw new HealthProfessionalIdentityStoreError(
      'El RUT profesional no tiene un formato válido.',
      'invalid_professional_identity',
    );
  }
  const body = normalized.slice(0, -1);
  if (rutCheckDigit(body) !== normalized.slice(-1)) {
    throw new HealthProfessionalIdentityStoreError(
      'El RUT profesional no es válido.',
      'invalid_professional_identity',
    );
  }
  return normalized;
}

function requireLookupKey(key: string | undefined): string {
  if (!key || Buffer.byteLength(key, 'utf8') < 32) {
    throw new HealthProfessionalIdentityStoreError(
      'La verificación profesional no está disponible temporalmente.',
      'professional_security_unavailable',
    );
  }
  return key;
}

function normalizedText(value: string, maxLength: number): string {
  const result = value.trim().replace(/\s+/g, ' ');
  if (!result || result.length > maxLength) {
    throw new HealthProfessionalIdentityStoreError(
      'Los datos profesionales no son válidos.',
      'invalid_professional_identity',
    );
  }
  return result;
}

export function normalizeProfessionalSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-CL')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function buildProfessionalSearchPrefixes(
  displayName: string,
  registryNumber: string,
): string[] {
  const name = normalizeProfessionalSearch(displayName);
  const registry = normalizeProfessionalSearch(registryNumber);
  const terms = new Set([name, ...name.split(' '), registry, registry.replace(/\s/g, '')]);
  const prefixes = new Set<string>();
  for (const term of terms) {
    for (let length = 1; length <= Math.min(term.length, 80); length += 1) {
      prefixes.add(term.slice(0, length));
      if (prefixes.size >= 300) return [...prefixes];
    }
  }
  return [...prefixes];
}

type LookupKey = { version: string; key: string };

function computeRutLookupHmac(normalizedRut: string, key: string): string {
  return createHmac('sha256', key)
    .update(`CL:RUT:${normalizedRut}`, 'utf8')
    .digest('hex');
}

function resolveLookupKeys(input: {
  lookupKey?: string;
  lookupKeys?: LookupKey[];
}): LookupKey[] {
  const keys = input.lookupKeys?.length
    ? input.lookupKeys
    : [{ version: 'v1', key: input.lookupKey ?? '' }];
  const versions = new Set<string>();
  return keys.map(({ version, key }) => {
    const normalizedVersion = normalizedText(version, 40);
    if (versions.has(normalizedVersion)) {
      throw new HealthProfessionalIdentityStoreError(
        'La verificaciÃ³n profesional no estÃ¡ disponible temporalmente.',
        'professional_security_unavailable',
      );
    }
    versions.add(normalizedVersion);
    return { version: normalizedVersion, key: requireLookupKey(key) };
  });
}

export function createHealthProfessionalIdentityStore(deps: {
  repository: ProfessionalIdentityRepository;
  kmsAdapter: KmsAdapter;
  lookupKey?: string;
  lookupKeys?: LookupKey[];
  registryProvider?: ProfessionalRegistryProvider;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;

  return {
    async enroll(input: {
      uid: string;
      displayName: string;
      rut: string;
      registryNumber: string;
    }): Promise<HealthProfessionalIdentity> {
      if (!deps.kmsAdapter.isAvailable) {
        throw new HealthProfessionalIdentityStoreError(
          'La verificación profesional no está disponible temporalmente.',
          'professional_security_unavailable',
        );
      }
      const lookupKeys = resolveLookupKeys(deps);
      const uid = normalizedText(input.uid, 128);
      const displayName = normalizedText(input.displayName, 160);
      const registryNumber = normalizedText(input.registryNumber, 80);
      const normalizedRut = normalizeChileanRut(input.rut);
      const lookupHmacs = lookupKeys.map(({ version, key }) => ({
        version,
        hmac: computeRutLookupHmac(normalizedRut, key),
      }));
      const [{ hmac: rutLookupHmac, version: rutLookupHmacVersion }] = lookupHmacs;

      const conflicts = await Promise.all(
        lookupHmacs.map(({ hmac }) => deps.repository.findByRutLookupHmac(hmac)),
      );
      if (conflicts.some(Boolean)) {
        throw new HealthProfessionalIdentityStoreError(
          'Ya existe una identidad profesional asociada a esos antecedentes.',
          'professional_identity_conflict',
        );
      }

      let rutCiphertext;
      try {
        rutCiphertext = await envelopeEncrypt(normalizedRut, deps.kmsAdapter);
      } catch {
        throw new HealthProfessionalIdentityStoreError(
          'La verificación profesional no está disponible temporalmente.',
          'professional_security_unavailable',
        );
      }

      const timestamp = now();
      const identity: HealthProfessionalIdentity = {
        uid,
        profession: 'physician',
        country: 'CL',
        displayName,
        registryAuthority: 'superintendencia_salud_cl',
        registryNumber,
        rutCiphertext,
        rutLookupHmac,
        rutLookupHmacVersion,
        displayNameSearch: normalizeProfessionalSearch(displayName),
        searchPrefixes: buildProfessionalSearchPrefixes(displayName, registryNumber),
        status: 'pending',
        registryAssurance: {
          provider: 'superintendencia_salud_cl_stub',
          status: 'not_configured',
          checkedAt: timestamp,
        },
        webauthnRequired: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const result = await deps.repository.createUnique(
        identity,
        lookupHmacs.map(({ hmac }) => hmac),
        {
          action: 'health.professional.enrolled',
          actorUid: uid,
          targetUid: uid,
          resourceType: 'health_professional_identity',
          verificationStatus: 'pending',
          timestamp,
        },
      );
      if (result !== 'created') {
        throw new HealthProfessionalIdentityStoreError(
          'Ya existe una identidad profesional asociada a esos antecedentes.',
          'professional_identity_conflict',
        );
      }
      return identity;
    },

    async get(uid: string): Promise<HealthProfessionalIdentity | null> {
      return deps.repository.get(uid);
    },

    async listPublic(query = '', limit = 20): Promise<ProfessionalPublicProfile[]> {
      const needle = normalizeProfessionalSearch(query);
      const identities = await deps.repository.searchEligible(
        needle,
        Math.min(Math.max(limit, 1), 50),
      );
      return identities
        .filter(canReceiveHealthGrant)
        .map(toProfessionalPublicProfile);
    },

    /**
     * Backfill every configured lookup-key version for a resumable page of
     * identities. Plaintext RUTs exist only in process memory while their
     * envelopes are open; the repository persists HMACs and audit metadata
     * atomically, never the civil identifier.
     */
    async reindexLookupKeys(input: {
      actorUid: string;
      afterUid?: string;
      limit?: number;
    }): Promise<{
      processed: number;
      updated: number;
      unchanged: number;
      nextCursor?: string;
      done: boolean;
    }> {
      if (!deps.kmsAdapter.isAvailable) {
        throw new HealthProfessionalIdentityStoreError(
          'La rotaciÃ³n de Ã­ndices profesionales no estÃ¡ disponible.',
          'professional_security_unavailable',
        );
      }
      const actorUid = normalizedText(input.actorUid, 128);
      const lookupKeys = resolveLookupKeys(deps);
      const limit = Math.min(Math.max(input.limit ?? 100, 1), 250);
      const identities = await deps.repository.listForLookupReindex(input.afterUid, limit);
      let updated = 0;
      let unchanged = 0;

      for (const identity of identities) {
        let normalizedRut: string;
        try {
          normalizedRut = normalizeChileanRut(
            await envelopeDecrypt(identity.rutCiphertext, deps.kmsAdapter),
          );
        } catch {
          throw new HealthProfessionalIdentityStoreError(
            'No se pudo reindexar una identidad profesional de forma segura.',
            'professional_security_unavailable',
          );
        }
        const hmacs = lookupKeys.map(({ version, key }) => ({
          version,
          hmac: computeRutLookupHmac(normalizedRut, key),
        }));
        const primary = hmacs[0];
        const at = now();
        const result = await deps.repository.reindexLookupHmacs({
          uid: identity.uid,
          expectedCurrentHmac: identity.rutLookupHmac,
          primaryVersion: primary.version,
          primaryHmac: primary.hmac,
          lookupHmacs: hmacs.map(({ hmac }) => hmac),
          auditEntry: {
            action: 'health.professional.lookup_hmac_reindexed',
            actorUid,
            targetUid: identity.uid,
            resourceType: 'health_professional_identity',
            keyVersions: hmacs.map(({ version }) => version),
            timestamp: at,
          },
          at,
        });
        if (result === 'conflict' || result === 'not_found') {
          throw new HealthProfessionalIdentityStoreError(
            'La identidad cambiÃ³ durante la rotaciÃ³n. Reanuda el lote para revisar el conflicto.',
            'professional_identity_conflict',
          );
        }
        if (result === 'updated') updated += 1;
        else unchanged += 1;
      }

      const lastUid = identities.at(-1)?.uid;
      return {
        processed: identities.length,
        updated,
        unchanged,
        ...(identities.length === limit && lastUid ? { nextCursor: lastUid } : {}),
        done: identities.length < limit,
      };
    },

    async approveProvisional(input: {
      targetUid: string;
      reviewerUid: string;
      evidenceReference: string;
    }): Promise<HealthProfessionalIdentity> {
      const current = await deps.repository.get(input.targetUid);
      if (!current) {
        throw new HealthProfessionalIdentityStoreError(
          'No se encontró la identidad profesional.',
          'professional_identity_not_found',
        );
      }
      const reference = normalizedText(input.evidenceReference, 500);
      const updated = applyProfessionalIdentityTransition(current, {
        to: 'provisional',
        actorUid: input.reviewerUid,
        method: 'manual_official_registry_review',
        evidenceReferenceHash: `sha256:${createHash('sha256').update(reference).digest('hex')}`,
        at: now(),
      });
      const persisted = await deps.repository.transitionWithAudit(input.targetUid, {
        to: 'provisional',
        actorUid: input.reviewerUid,
        method: 'manual_official_registry_review',
        evidenceReferenceHash: updated.identityAssurance!.evidenceReferenceHash,
        at: updated.updatedAt,
      }, {
        action: 'health.professional.provisional_approved',
        actorUid: input.reviewerUid,
        targetUid: input.targetUid,
        resourceType: 'health_professional_identity',
        decisionMethod: 'manual_official_registry_review',
        evidenceReferenceHash: updated.identityAssurance?.evidenceReferenceHash,
        timestamp: updated.updatedAt,
      });
      if (!persisted) {
        throw new HealthProfessionalIdentityStoreError(
          'Professional identity was not found.',
          'professional_identity_not_found',
        );
      }
      return persisted;
    },

    async transitionStatus(input: {
      targetUid: string;
      reviewerUid: string;
      to: 'suspended' | 'revoked';
      evidenceReference: string;
    }): Promise<HealthProfessionalIdentity> {
      const reference = normalizedText(input.evidenceReference, 500);
      const at = now();
      const evidenceReferenceHash = `sha256:${createHash('sha256').update(reference).digest('hex')}`;
      const updated = await deps.repository.transitionWithAudit(input.targetUid, {
        to: input.to,
        actorUid: input.reviewerUid,
        method: 'manual_official_registry_review',
        evidenceReferenceHash,
        at,
      }, {
        action: `health.professional.${input.to}`,
        actorUid: input.reviewerUid,
        targetUid: input.targetUid,
        resourceType: 'health_professional_identity',
        decisionMethod: 'manual_official_registry_review',
        evidenceReferenceHash,
        timestamp: at,
      });
      if (!updated) {
        throw new HealthProfessionalIdentityStoreError(
          'Professional identity was not found.',
          'professional_identity_not_found',
        );
      }
      return updated;
    },

    async revalidate(input: {
      targetUid: string;
      reviewerUid: string;
    }): Promise<{
      identity: HealthProfessionalIdentity;
      verification: ProfessionalRegistryVerification;
    }> {
      if (!deps.registryProvider || !deps.kmsAdapter.isAvailable) {
        throw new HealthProfessionalIdentityStoreError(
          'La validación con el registro oficial aún no está configurada.',
          'professional_security_unavailable',
        );
      }
      const current = await deps.repository.get(input.targetUid);
      if (!current) {
        throw new HealthProfessionalIdentityStoreError(
          'Professional identity was not found.',
          'professional_identity_not_found',
        );
      }
      let normalizedRut: string;
      try {
        normalizedRut = await envelopeDecrypt(current.rutCiphertext, deps.kmsAdapter);
      } catch {
        throw new HealthProfessionalIdentityStoreError(
          'La validación con el registro oficial no está disponible.',
          'professional_security_unavailable',
        );
      }
      const verification = await deps.registryProvider.verifyPhysician({
        country: 'CL',
        registryNumber: current.registryNumber,
        normalizedRut,
      });
      const identity = await deps.repository.recordRegistryCheckWithAudit(
        current.uid,
        verification,
        input.reviewerUid,
        now(),
      );
      if (!identity) {
        throw new HealthProfessionalIdentityStoreError(
          'Professional identity was not found.',
          'professional_identity_not_found',
        );
      }
      return { identity, verification };
    },
  };
}
