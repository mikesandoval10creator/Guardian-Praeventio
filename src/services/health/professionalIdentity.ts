import type { EnvelopeCiphertext } from '../security/kmsEnvelope';

export type ProfessionalVerificationStatus =
  | 'pending'
  | 'provisional'
  | 'verified'
  | 'suspended'
  | 'revoked';

export type ProfessionalRegistryResultStatus =
  | 'verified'
  | 'not_found'
  | 'mismatch'
  | 'unavailable'
  | 'not_configured';

export interface HealthProfessionalIdentity {
  uid: string;
  profession: 'physician';
  country: 'CL';
  displayName: string;
  registryAuthority: 'superintendencia_salud_cl';
  registryNumber: string;
  rutCiphertext: EnvelopeCiphertext;
  rutLookupHmac: string;
  status: ProfessionalVerificationStatus;
  identityAssurance?: {
    level: 'provisional' | 'verified';
    method: 'manual_official_registry_review' | 'official_registry_api';
    reviewedBy: string;
    reviewedAt: number;
    evidenceReferenceHash: string;
  };
  registryAssurance: {
    provider: string;
    status: ProfessionalRegistryResultStatus;
    checkedAt: number;
    nextReviewAt?: number;
  };
  webauthnRequired: true;
  createdAt: number;
  updatedAt: number;
  suspendedAt?: number;
  revokedAt?: number;
}

export interface ProfessionalPublicProfile {
  uid: string;
  displayName: string;
  profession: 'physician';
  country: 'CL';
  registryAuthority: 'superintendencia_salud_cl';
  registryNumber: string;
  status: 'provisional' | 'verified';
}

export class ProfessionalIdentityError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_transition'
      | 'official_verification_required'
      | 'missing_assurance',
  ) {
    super(message);
    this.name = 'ProfessionalIdentityError';
  }
}

export type ProfessionalIdentityTransition = {
  to: Exclude<ProfessionalVerificationStatus, 'pending'>;
  actorUid: string;
  method: 'manual_official_registry_review' | 'official_registry_api';
  evidenceReferenceHash: string;
  at?: number;
};

const ALLOWED_TRANSITIONS: Record<ProfessionalVerificationStatus, ProfessionalVerificationStatus[]> = {
  pending: ['provisional', 'verified', 'revoked'],
  provisional: ['verified', 'suspended', 'revoked'],
  verified: ['suspended', 'revoked'],
  suspended: ['provisional', 'verified', 'revoked'],
  revoked: [],
};

export function applyProfessionalIdentityTransition(
  identity: HealthProfessionalIdentity,
  transition: ProfessionalIdentityTransition,
): HealthProfessionalIdentity {
  if (!ALLOWED_TRANSITIONS[identity.status].includes(transition.to)) {
    throw new ProfessionalIdentityError(
      `Transition ${identity.status} -> ${transition.to} is not allowed`,
      'invalid_transition',
    );
  }
  if (!transition.actorUid || !transition.evidenceReferenceHash) {
    throw new ProfessionalIdentityError('Assurance evidence is required', 'missing_assurance');
  }
  if (transition.to === 'verified' && transition.method !== 'official_registry_api') {
    throw new ProfessionalIdentityError(
      'Official provider verification is required for verified status',
      'official_verification_required',
    );
  }

  const at = transition.at ?? Date.now();
  const next: HealthProfessionalIdentity = {
    ...identity,
    status: transition.to,
    identityAssurance:
      transition.to === 'provisional' || transition.to === 'verified'
        ? {
            level: transition.to,
            method: transition.method,
            reviewedBy: transition.actorUid,
            reviewedAt: at,
            evidenceReferenceHash: transition.evidenceReferenceHash,
          }
        : identity.identityAssurance,
    updatedAt: at,
  };

  if (transition.to === 'suspended') next.suspendedAt = at;
  if (transition.to === 'revoked') next.revokedAt = at;
  return next;
}

export function canReceiveHealthGrant(identity: HealthProfessionalIdentity): boolean {
  return (
    identity.webauthnRequired === true &&
    (identity.status === 'provisional' || identity.status === 'verified')
  );
}

export function toProfessionalPublicProfile(
  identity: HealthProfessionalIdentity,
): ProfessionalPublicProfile {
  if (!canReceiveHealthGrant(identity)) {
    throw new ProfessionalIdentityError(
      'Professional identity is not eligible for grants',
      'invalid_transition',
    );
  }
  return {
    uid: identity.uid,
    displayName: identity.displayName,
    profession: identity.profession,
    country: identity.country,
    registryAuthority: identity.registryAuthority,
    registryNumber: identity.registryNumber,
    status: identity.status,
  };
}
