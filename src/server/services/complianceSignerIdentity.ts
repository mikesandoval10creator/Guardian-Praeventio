import { formatRut, isValidRut } from '../../utils/rut.js';

export type ComplianceSignerIdentityErrorCode = 'signer_identity_incomplete';

export class ComplianceSignerIdentityError extends Error {
  readonly code: ComplianceSignerIdentityErrorCode;

  constructor(message = 'Authoritative compliance signer identity is incomplete.') {
    super(message);
    this.name = 'ComplianceSignerIdentityError';
    this.code = 'signer_identity_incomplete';
  }
}

export interface ComplianceSignerIdentity {
  uid: string;
  rut: string;
  kind: 'human' | 'kms';
}

export interface MinimalSignerProfileStore {
  loadSignerProfile(uid: string): Promise<Record<string, unknown> | null>;
}

export async function resolveHumanComplianceSigner(
  authenticatedUid: string,
  store: MinimalSignerProfileStore,
): Promise<ComplianceSignerIdentity> {
  if (typeof authenticatedUid !== 'string' || authenticatedUid.trim().length === 0) {
    throw new ComplianceSignerIdentityError();
  }
  const profile = await store.loadSignerProfile(authenticatedUid);
  const rut = typeof profile?.rut === 'string' ? profile.rut : '';
  if (!isValidRut(rut)) {
    throw new ComplianceSignerIdentityError();
  }
  return { uid: authenticatedUid, rut: formatRut(rut), kind: 'human' };
}

export function resolveConfiguredKmsSigner(
  env: Record<string, string | undefined> = process.env,
): ComplianceSignerIdentity {
  const uid = env.COMPLIANCE_KMS_SIGNER_UID?.trim() ?? '';
  const rut = env.COMPLIANCE_KMS_SIGNER_RUT?.trim() ?? '';
  if (!uid || !isValidRut(rut)) {
    throw new ComplianceSignerIdentityError(
      'Configured compliance KMS signer identity is missing or invalid.',
    );
  }
  return { uid, rut: formatRut(rut), kind: 'kms' };
}
