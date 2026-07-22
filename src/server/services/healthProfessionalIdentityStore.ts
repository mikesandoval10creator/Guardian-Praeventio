import { createHash, createHmac } from 'node:crypto';

import {
  applyProfessionalIdentityTransition,
  canReceiveHealthGrant,
  toProfessionalPublicProfile,
  type HealthProfessionalIdentity,
  type ProfessionalPublicProfile,
} from '../../services/health/professionalIdentity';
import type { KmsAdapter } from '../../services/security/kmsAdapter';
import { envelopeEncrypt } from '../../services/security/kmsEnvelope';

export type ProfessionalIdentityCreateResult =
  | 'created'
  | 'uid_conflict'
  | 'rut_conflict';

export interface ProfessionalIdentityRepository {
  get(uid: string): Promise<HealthProfessionalIdentity | null>;
  findByRutLookupHmac(rutLookupHmac: string): Promise<HealthProfessionalIdentity | null>;
  createUnique(identity: HealthProfessionalIdentity): Promise<ProfessionalIdentityCreateResult>;
  replace(identity: HealthProfessionalIdentity): Promise<void>;
  listEligible(limit: number): Promise<HealthProfessionalIdentity[]>;
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

export function createHealthProfessionalIdentityStore(deps: {
  repository: ProfessionalIdentityRepository;
  kmsAdapter: KmsAdapter;
  lookupKey?: string;
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
      const lookupKey = requireLookupKey(deps.lookupKey);
      const uid = normalizedText(input.uid, 128);
      const displayName = normalizedText(input.displayName, 160);
      const registryNumber = normalizedText(input.registryNumber, 80);
      const normalizedRut = normalizeChileanRut(input.rut);
      const rutLookupHmac = createHmac('sha256', lookupKey)
        .update(`CL:RUT:${normalizedRut}`, 'utf8')
        .digest('hex');

      if (await deps.repository.findByRutLookupHmac(rutLookupHmac)) {
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

      const result = await deps.repository.createUnique(identity);
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
      const needle = query.trim().toLocaleLowerCase('es-CL');
      const identities = await deps.repository.listEligible(Math.min(Math.max(limit, 1), 50));
      return identities
        .filter(canReceiveHealthGrant)
        .filter((identity) => {
          if (!needle) return true;
          return (
            identity.displayName.toLocaleLowerCase('es-CL').includes(needle) ||
            identity.registryNumber.toLocaleLowerCase('es-CL').includes(needle)
          );
        })
        .map(toProfessionalPublicProfile);
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
      await deps.repository.replace(updated);
      return updated;
    },
  };
}
