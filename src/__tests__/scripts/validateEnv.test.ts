// Sprint 21 Ola 6 / Bucket U.6 — tests for scripts/validate-env.cjs.
//
// Vitest only discovers tests under `src/**/*.test.ts(x)` (see vitest.config.ts),
// so the spec-mentioned `scripts/validate-env.test.cjs` lives here instead.
// We import the CJS module via createRequire to avoid the ESM↔CJS shim mess
// that bite us before in mercadoPagoIpn.test.ts.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
// repo root is 3 levels up: src/__tests__/scripts → src/__tests__ → src → repo
const repoRoot = path.resolve(here, '..', '..', '..');
const validator = require(path.join(repoRoot, 'scripts', 'validate-env.cjs'));

const { check, REQUIRED_PROD, PLACEHOLDER_REGEX } = validator as {
  check: (
    env: Record<string, string | undefined>,
    options?: { mode?: 'prod' | 'test' },
  ) => { errors: string[]; warnings: string[]; checked: number; mode: 'prod' | 'test' };
  REQUIRED_PROD: Array<{
    name: string;
    purpose: string;
    optional?: boolean;
    minLength?: number;
    allowedValues?: string[];
  }>;
  PLACEHOLDER_REGEX: RegExp;
};

/**
 * Build an env that satisfies every non-optional spec with a real-looking value.
 * Tests then mutate single keys to trigger specific failure paths.
 */
function buildHealthyEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const spec of REQUIRED_PROD) {
    if (spec.allowedValues && spec.allowedValues.length > 0) {
      env[spec.name] = spec.allowedValues[0];
      continue;
    }
    // 64 chars covers any minLength up to 64.
    env[spec.name] = `real-value-${spec.name.toLowerCase()}-${'x'.repeat(64)}`;
  }
  return env;
}

describe('validate-env (Bucket U.1)', () => {
  it('rejects empty env with MISSING errors for every required var', () => {
    const result = check({});
    // Should flag every non-optional spec.
    const requiredCount = REQUIRED_PROD.filter((s) => !s.optional).length;
    expect(result.errors.length).toBeGreaterThanOrEqual(requiredCount);
    expect(result.errors.every((e) => e.startsWith('MISSING:'))).toBe(true);
    expect(result.checked).toBe(REQUIRED_PROD.length);
  });

  it('flags placeholder values with PLACEHOLDER errors', () => {
    const env = buildHealthyEnv();
    env.GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY';
    env.SESSION_SECRET = 'MY_SESSION_SECRET_ABC123XYZ_REAL_LONG_TEXT_XX';
    env.VITE_GOOGLE_MAPS_API_KEY = '<paste-from-console>';

    const result = check(env);
    const placeholderErrors = result.errors.filter((e) => e.startsWith('PLACEHOLDER:'));
    expect(placeholderErrors.length).toBe(3);
    expect(placeholderErrors.some((e) => e.includes('GEMINI_API_KEY'))).toBe(true);
    expect(placeholderErrors.some((e) => e.includes('VITE_GOOGLE_MAPS_API_KEY'))).toBe(true);
  });

  it('passes with healthy env: zero errors', () => {
    const env = buildHealthyEnv();
    const result = check(env);
    expect(result.errors).toEqual([]);
  });

  it('emits a warning (not error) when an optional var is missing', () => {
    const env = buildHealthyEnv();
    delete env.PHOTOGRAMMETRY_WORKER_URL;
    delete env.PHOTOGRAMMETRY_WORKER_TOKEN;

    const result = check(env);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes('PHOTOGRAMMETRY_WORKER_URL'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('PHOTOGRAMMETRY_WORKER_TOKEN'))).toBe(true);
  });

  it('rejects values shorter than minLength with TOO SHORT', () => {
    const env = buildHealthyEnv();
    env.SESSION_SECRET = 'short'; // minLength 32
    env.IOT_WEBHOOK_SECRET = 'still-too-short'; // minLength 32

    const result = check(env);
    const tooShort = result.errors.filter((e) => e.startsWith('TOO SHORT:'));
    expect(tooShort.some((e) => e.includes('SESSION_SECRET'))).toBe(true);
    expect(tooShort.some((e) => e.includes('IOT_WEBHOOK_SECRET'))).toBe(true);
  });

  it('rejects values outside allowedValues with INVALID VALUE', () => {
    const env = buildHealthyEnv();
    env.KMS_ADAPTER = 'aws-kms-fictional';

    const result = check(env);
    const invalid = result.errors.filter((e) => e.startsWith('INVALID VALUE:'));
    expect(invalid.some((e) => e.includes('KMS_ADAPTER'))).toBe(true);
    expect(invalid[0]).toContain('cloud-kms');
    expect(invalid[0]).toContain('in-memory-dev');
  });

  it('test mode tolerates placeholders and missing non-optional vars (CI smoke)', () => {
    const env: Record<string, string> = {};
    env.GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY';
    env.SESSION_SECRET = 'MY_PLACEHOLDER';
    env.KMS_ADAPTER = 'in-memory-dev';

    const result = check(env, { mode: 'test' });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.mode).toBe('test');
  });

  it('PLACEHOLDER_REGEX matches the documented prefixes', () => {
    expect(PLACEHOLDER_REGEX.test('YOUR_KEY')).toBe(true);
    expect(PLACEHOLDER_REGEX.test('MY_KEY')).toBe(true);
    expect(PLACEHOLDER_REGEX.test('REPLACE_ME')).toBe(true);
    expect(PLACEHOLDER_REGEX.test('PLACEHOLDER')).toBe(true);
    expect(PLACEHOLDER_REGEX.test('<paste-here>')).toBe(true);
    expect(PLACEHOLDER_REGEX.test('AIzaSyC-real-key')).toBe(false);
    expect(PLACEHOLDER_REGEX.test('https://example.ingest.us.sentry.io/1234')).toBe(false);
  });
});
