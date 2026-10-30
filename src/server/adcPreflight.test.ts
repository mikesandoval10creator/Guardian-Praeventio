// SPDX-License-Identifier: MIT
//
// adcPreflight tests — mirror kmsPreflight.test.ts / webpayPreflight.test.ts
// structure.
//
// Ticket 409aa66d-... (PR #1883 image probes): without any ADC the server
// boots ("Server running on http://localhost:3000") and then dies with an
// unhandled rejection (google-auth NO_ADC_FOUND) from the background
// subscriptions. This preflight makes the requirement explicit and
// fail-closed at boot.

import { describe, it, expect } from 'vitest';
import { validateAdcBootConfig, type AdcBootFileIO } from './adcPreflight';

/** Stub file IO: map of path -> file text, absent key = missing file. */
function fakeFs(files: Record<string, string>): AdcBootFileIO {
  return {
    existsSync: (p: string) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p: string) => files[p],
  };
}

const SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'synthetic@ops-contract-synthetic.iam.gserviceaccount.com',
  private_key: '-----BEGIN RSA PRIVATE KEY-----\nsynthetic\n-----END RSA PRIVATE KEY-----',
});

describe('validateAdcBootConfig', () => {
  it('non-production: ok with empty env (dev/CI run without ADC)', () => {
    const result = validateAdcBootConfig({}, fakeFs({}));
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('non-production');
    expect(result.errors).toEqual([]);
  });

  it('production: ok when GOOGLE_APPLICATION_CREDENTIALS points at a valid service_account file', () => {
    const result = validateAdcBootConfig(
      { NODE_ENV: 'production', GOOGLE_APPLICATION_CREDENTIALS: '/secrets/sa.json' },
      fakeFs({ '/secrets/sa.json': SERVICE_ACCOUNT_JSON }),
    );
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('production');
    expect(result.errors).toEqual([]);
  });

  it('production: FATAL when GOOGLE_APPLICATION_CREDENTIALS file is missing (the CI crash case)', () => {
    const result = validateAdcBootConfig(
      { NODE_ENV: 'production', GOOGLE_APPLICATION_CREDENTIALS: '/secrets/absent.json' },
      fakeFs({}),
    );
    expect(result.ok).toBe(false);
    expect(result.mode).toBe('production');
    expect(result.errors.some((e) => e.includes('GOOGLE_APPLICATION_CREDENTIALS'))).toBe(true);
  });

  it('production: FATAL when the credential file is not valid JSON', () => {
    const result = validateAdcBootConfig(
      { NODE_ENV: 'production', GOOGLE_APPLICATION_CREDENTIALS: '/secrets/sa.json' },
      fakeFs({ '/secrets/sa.json': '{not json' }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('GOOGLE_APPLICATION_CREDENTIALS'))).toBe(true);
  });

  it('production: FATAL when the credential file has no recognized type', () => {
    const result = validateAdcBootConfig(
      { NODE_ENV: 'production', GOOGLE_APPLICATION_CREDENTIALS: '/secrets/sa.json' },
      fakeFs({ '/secrets/sa.json': JSON.stringify({ type: 'mystery' }) }),
    );
    expect(result.ok).toBe(false);
  });

  it('production: FATAL when a service_account file lacks client_email/private_key', () => {
    const result = validateAdcBootConfig(
      { NODE_ENV: 'production', GOOGLE_APPLICATION_CREDENTIALS: '/secrets/sa.json' },
      fakeFs({ '/secrets/sa.json': JSON.stringify({ type: 'service_account' }) }),
    );
    expect(result.ok).toBe(false);
  });

  it('production: ok with an external_account (Workload Identity Federation file)', () => {
    const result = validateAdcBootConfig(
      { NODE_ENV: 'production', GOOGLE_APPLICATION_CREDENTIALS: '/secrets/wif.json' },
      fakeFs({
        '/secrets/wif.json': JSON.stringify({
          type: 'external_account',
          credential_source: { url: 'http://metadata' },
        }),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('production: ok without the env var on Cloud Run (Workload Identity via metadata server)', () => {
    const result = validateAdcBootConfig(
      { NODE_ENV: 'production', K_SERVICE: 'guardian-api' },
      fakeFs({}),
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('production: ok without the env var on App Engine', () => {
    const result = validateAdcBootConfig(
      { NODE_ENV: 'production', GAE_ENV: 'standard' },
      fakeFs({}),
    );
    expect(result.ok).toBe(true);
  });

  it('production: FATAL when there is no env var and no GCP-managed environment (fail-closed)', () => {
    const result = validateAdcBootConfig({ NODE_ENV: 'production' }, fakeFs({}));
    expect(result.ok).toBe(false);
    expect(result.mode).toBe('production');
    expect(result.errors.some((e) => e.includes('GOOGLE_APPLICATION_CREDENTIALS'))).toBe(true);
    expect(result.errors.some((e) => /ADC|Application Default/i.test(e))).toBe(true);
  });

  it('non-production: warns (but stays ok) when the env var points at a missing file', () => {
    const result = validateAdcBootConfig(
      { GOOGLE_APPLICATION_CREDENTIALS: '/secrets/absent.json' },
      fakeFs({}),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
