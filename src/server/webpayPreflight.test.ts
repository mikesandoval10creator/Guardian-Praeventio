// SPDX-License-Identifier: MIT
//
// webpayPreflight tests — mirror kmsPreflight.test.ts structure.
//
// Discovery 2026-08-17 (ticket 3bfaa66d-...).

import { describe, it, expect } from 'vitest';
import { validateWebpayBootConfig } from './webpayPreflight';

describe('validateWebpayBootConfig', () => {
  it('non-production: ok regardless of env vars (sandbox default is intentional)', () => {
    const result = validateWebpayBootConfig({});
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('non-production');
    expect(result.errors).toEqual([]);
  });

  it('non-production: warns when creds are set (likely staging copy-paste)', () => {
    const result = validateWebpayBootConfig({
      WEBPAY_COMMERCE_CODE: '597000000001',
      WEBPAY_API_KEY: 'test-key',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/NODE_ENV is not "production"/);
  });

  it('production: fails loud when WEBPAY_COMMERCE_CODE is missing', () => {
    const result = validateWebpayBootConfig({
      NODE_ENV: 'production',
      WEBPAY_API_KEY: 'prod-key',
    });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe('production');
    expect(result.errors.some((e) => e.includes('WEBPAY_COMMERCE_CODE'))).toBe(true);
  });

  it('production: fails loud when WEBPAY_API_KEY is missing', () => {
    const result = validateWebpayBootConfig({
      NODE_ENV: 'production',
      WEBPAY_COMMERCE_CODE: '597055555551',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('WEBPAY_API_KEY'))).toBe(true);
  });

  it('production: fails loud when both creds are missing (the bug)', () => {
    // Reproduces the Discovery 2026-08-17 bug: NODE_ENV=production, no creds,
    // adapter would silently fall back to Transbank sandbox at runtime.
    const result = validateWebpayBootConfig({ NODE_ENV: 'production' });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(2);
    expect(result.errors.some((e) => e.includes('sandbox'))).toBe(true);
  });

  it('production: passes when both creds are set', () => {
    const result = validateWebpayBootConfig({
      NODE_ENV: 'production',
      WEBPAY_COMMERCE_CODE: '597055555551',
      WEBPAY_API_KEY: 'real-key',
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('production: warns when WEBPAY_ENV=integration but NODE_ENV=production (copy-paste)', () => {
    const result = validateWebpayBootConfig({
      NODE_ENV: 'production',
      WEBPAY_COMMERCE_CODE: '597055555551',
      WEBPAY_API_KEY: 'real-key',
      WEBPAY_ENV: 'integration',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('integration'))).toBe(true);
  });

  it('production: WEBPAY_ENVIRONMENT alias is recognised (legacy var name)', () => {
    const result = validateWebpayBootConfig({
      NODE_ENV: 'production',
      WEBPAY_COMMERCE_CODE: '597055555551',
      WEBPAY_API_KEY: 'real-key',
      WEBPAY_ENVIRONMENT: 'integration',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('integration'))).toBe(true);
  });
});