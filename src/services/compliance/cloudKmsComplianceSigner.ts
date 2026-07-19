import crypto from 'node:crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';

export type ComplianceKmsSigningErrorCode =
  | 'kms_not_configured'
  | 'kms_unavailable'
  | 'kms_invalid_response'
  | 'kms_local_verification_failed';

export class ComplianceKmsSigningError extends Error {
  constructor(readonly code: ComplianceKmsSigningErrorCode) {
    super(code);
    this.name = 'ComplianceKmsSigningError';
  }
}

export interface MinimalComplianceKmsClient {
  asymmetricSign(input: {
    name: string;
    digest: { sha256: Buffer };
  }): Promise<Array<{ signature?: Uint8Array | string | null }>>;
  getPublicKey(input: {
    name: string;
  }): Promise<Array<{ pem?: string | null }>>;
}

let defaultClient: MinimalComplianceKmsClient | null = null;

function getDefaultClient(): MinimalComplianceKmsClient {
  if (!defaultClient) {
    defaultClient = new KeyManagementServiceClient() as unknown as MinimalComplianceKmsClient;
  }
  return defaultClient;
}

export async function signCompliancePayloadWithKms(
  payload: Uint8Array,
  options: {
    keyVersionName?: string;
    client?: MinimalComplianceKmsClient;
  } = {},
): Promise<{ signatureB64: string; keyVersion: string; publicKeyPem: string }> {
  const keyVersionName = (
    options.keyVersionName ?? process.env.COMPLIANCE_KMS_SIGNING_KEY_VERSION ?? ''
  ).trim();
  if (!keyVersionName) {
    throw new ComplianceKmsSigningError('kms_not_configured');
  }
  if (!(payload instanceof Uint8Array) || payload.byteLength === 0) {
    throw new TypeError('compliance payload must be non-empty bytes');
  }

  const client = options.client ?? getDefaultClient();
  const digest = crypto.createHash('sha256').update(payload).digest();
  let signResponse: { signature?: Uint8Array | string | null } | undefined;
  let publicKeyResponse: { pem?: string | null } | undefined;
  try {
    [signResponse] = await client.asymmetricSign({
      name: keyVersionName,
      digest: { sha256: digest },
    });
    [publicKeyResponse] = await client.getPublicKey({ name: keyVersionName });
  } catch {
    throw new ComplianceKmsSigningError('kms_unavailable');
  }

  if (!signResponse?.signature || !publicKeyResponse?.pem) {
    throw new ComplianceKmsSigningError('kms_invalid_response');
  }
  const signature = Buffer.from(signResponse.signature as Uint8Array);
  if (signature.byteLength === 0) {
    throw new ComplianceKmsSigningError('kms_invalid_response');
  }

  let verified = false;
  try {
    verified = crypto.verify('sha256', payload, {
      key: publicKeyResponse.pem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }, signature);
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new ComplianceKmsSigningError('kms_local_verification_failed');
  }

  return {
    signatureB64: signature.toString('base64'),
    keyVersion: keyVersionName,
    publicKeyPem: publicKeyResponse.pem,
  };
}
