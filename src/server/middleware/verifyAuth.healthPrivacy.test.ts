import { describe, expect, it } from 'vitest';

import { endpointForSecurityTelemetry } from './verifyAuth';

describe('verifyAuth clinical endpoint privacy', () => {
  it('removes grant, record and query identifiers before logs or Sentry', () => {
    const safe = endpointForSecurityTelemetry(
      '/api/health-vault/view/hvg_secret_grant/file/record-sensitive-1?download=record-sensitive-1',
    );

    expect(safe).toBe('/api/health-vault/view/:grantId/file/:recordId');
    expect(safe).not.toContain('hvg_secret_grant');
    expect(safe).not.toContain('record-sensitive-1');
  });

  it('preserves ordinary static endpoints', () => {
    expect(endpointForSecurityTelemetry('/api/health?deep=1')).toBe('/api/health');
  });
});
