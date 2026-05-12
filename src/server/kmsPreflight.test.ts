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
});
