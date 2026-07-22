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

  // The cases above only exercise the file-level pattern. The grant-level
  // pattern (view|share) was untested, so every mutant inside it survived and
  // dragged verifyAuth.ts under its 75% critical floor (74.70%).
  it('redacts the grant id on a view link with no file segment', () => {
    expect(endpointForSecurityTelemetry('/api/health-vault/view/hvg_secret_grant')).toBe(
      '/api/health-vault/view/:grantId',
    );
  });

  it('redacts the grant id on a share link', () => {
    expect(endpointForSecurityTelemetry('/api/health-vault/share/hvg_secret_grant')).toBe(
      '/api/health-vault/share/:grantId',
    );
  });

  it('keeps view and share distinct (guards the $1 back-reference)', () => {
    expect(endpointForSecurityTelemetry('/api/health-vault/share/abc')).not.toContain('view');
    expect(endpointForSecurityTelemetry('/api/health-vault/view/abc')).not.toContain('share');
  });

  it('strips the query string off a grant link before it reaches telemetry', () => {
    expect(
      endpointForSecurityTelemetry('/api/health-vault/share/hvg_secret_grant?secret=leak'),
    ).toBe('/api/health-vault/share/:grantId');
  });

  it('returns an empty string for a missing url instead of leaking "undefined"', () => {
    expect(endpointForSecurityTelemetry(undefined as unknown as string)).toBe('');
    expect(endpointForSecurityTelemetry(null as unknown as string)).toBe('');
  });
});
