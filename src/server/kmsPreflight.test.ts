import { describe, expect, it } from 'vitest';

import { validateKmsBootConfig } from './kmsPreflight';

describe('validateKmsBootConfig', () => {
  it('fails closed when production would use the in-memory development adapter', () => {
    const result = validateKmsBootConfig({
      NODE_ENV: 'production',
      KMS_ADAPTER: 'in-memory-dev',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('cloud-kms');
  });

  it('requires a concrete cloud KMS key resource in production', () => {
    const result = validateKmsBootConfig({
      NODE_ENV: 'production',
      KMS_ADAPTER: 'cloud-kms',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('KMS_KEY_RESOURCE_NAME');
  });

  it('allows cloud KMS with a configured key in production', () => {
    const result = validateKmsBootConfig({
      NODE_ENV: 'production',
      KMS_ADAPTER: 'cloud-kms',
      KMS_KEY_RESOURCE_NAME: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
    });

    expect(result).toMatchObject({ ok: true, adapter: 'cloud-kms' });
  });

  it('requires every regulatory signing binding when compliance KMS is enabled', () => {
    const result = validateKmsBootConfig({
      NODE_ENV: 'production',
      KMS_ADAPTER: 'cloud-kms',
      KMS_KEY_RESOURCE_NAME: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
      COMPLIANCE_KMS_SIGNING_ENABLED: 'true',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('COMPLIANCE_KMS_SIGNING_KEY_VERSION');
    expect(result.errors.join('\n')).toContain('COMPLIANCE_KMS_CALLER_SERVICE_ACCOUNT');
    expect(result.errors.join('\n')).toContain('COMPLIANCE_KMS_SIGNER_UID');
    expect(result.errors.join('\n')).toContain('COMPLIANCE_KMS_SIGNER_RUT');
  });

  it('accepts fully pinned regulatory KMS signing configuration', () => {
    const result = validateKmsBootConfig({
      NODE_ENV: 'production', KMS_ADAPTER: 'cloud-kms',
      KMS_KEY_RESOURCE_NAME: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
      COMPLIANCE_KMS_SIGNING_ENABLED: 'true',
      COMPLIANCE_KMS_SIGNING_KEY_VERSION:
        'projects/p/locations/l/keyRings/r/cryptoKeys/sign/cryptoKeyVersions/1',
      COMPLIANCE_KMS_CALLER_SERVICE_ACCOUNT: 'caller@p.iam.gserviceaccount.com',
      COMPLIANCE_KMS_SIGNER_UID: 'compliance-kms',
      COMPLIANCE_KMS_SIGNER_RUT: '12.345.678-5',
      COMPLIANCE_KMS_OIDC_AUDIENCE: 'https://app.example.com/api',
    });
    expect(result.ok).toBe(true);
  });
});
