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

type CheckResult = {
  errors: string[];
  warnings: string[];
  checked: number;
  mode: 'prod' | 'test' | 'prod-secret-manager';
};

const { check, REQUIRED_PROD, PLACEHOLDER_REGEX, SECRET_MANAGER_SECRETS } = validator as {
  check: (
    env: Record<string, string | undefined>,
    options?: { mode?: 'prod' | 'test' | 'prod-secret-manager' },
  ) => CheckResult;
  REQUIRED_PROD: Array<{
    name: string;
    purpose: string;
    optional?: boolean;
    minLength?: number;
    allowedValues?: string[];
    // Sprint 39 B.3: predicado opcional para enforcement condicional
    // (e.g. KMS_KEY_RESOURCE_NAME solo se exige si KMS_ADAPTER='cloud-kms').
    requiredIf?: (env: Record<string, string | undefined>) => boolean;
    // Provider layer 2026-06: shape check (regex) + valor de ejemplo que
    // lo satisface (usado por buildHealthyEnv).
    pattern?: string;
    example?: string;
  }>;
  PLACEHOLDER_REGEX: RegExp;
  SECRET_MANAGER_SECRETS: string[];
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
    // Specs with a shape check carry an `example` that satisfies it.
    if (spec.example) {
      env[spec.name] = spec.example;
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
    // Should flag every non-optional spec EXCEPT those guarded by
    // requiredIf (e.g. KMS_KEY_RESOURCE_NAME, que solo se exige cuando
    // KMS_ADAPTER === 'cloud-kms' — con env vacío el predicado es
    // false y la spec se salta sin generar MISSING).
    const requiredCount = REQUIRED_PROD.filter(
      (s) => !s.optional && !s.requiredIf,
    ).length;
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
    // Sprint 39 B.3 cerró 'in-memory-dev' como valor prod aceptado; el
    // único allowedValue en prod es 'cloud-kms'. El mensaje de error
    // refleja eso (no incluye 'in-memory-dev' ya).
    expect(invalid[0]).toContain('cloud-kms');
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

  // === Bucket V.6 — prod-secret-manager mode ===

  it('prod-secret-manager mode requires GOOGLE_CLOUD_PROJECT', () => {
    const result = check({}, { mode: 'prod-secret-manager' });
    expect(result.mode).toBe('prod-secret-manager');
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('GOOGLE_CLOUD_PROJECT');
  });

  it('prod-secret-manager mode passes with only GOOGLE_CLOUD_PROJECT set, warns per secret', () => {
    const result = check(
      { GOOGLE_CLOUD_PROJECT: 'praeventio-541ad' },
      { mode: 'prod-secret-manager' },
    );
    expect(result.errors).toEqual([]);
    // One warning per Secret Manager secret pointing at the gcloud command.
    expect(result.warnings.length).toBe(SECRET_MANAGER_SECRETS.length);
    expect(result.warnings.every((w) => w.includes('gcloud secrets describe'))).toBe(true);
    expect(result.checked).toBe(SECRET_MANAGER_SECRETS.length);
  });

  it('prod-secret-manager mode covers the 22 expected secrets (6 wired + 16 new)', () => {
    expect(SECRET_MANAGER_SECRETS).toContain('GEMINI_API_KEY');
    expect(SECRET_MANAGER_SECRETS).toContain('SENTRY_DSN');
    expect(SECRET_MANAGER_SECRETS).toContain('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
    expect(SECRET_MANAGER_SECRETS.length).toBe(22);
    // No duplicates.
    expect(new Set(SECRET_MANAGER_SECRETS).size).toBe(SECRET_MANAGER_SECRETS.length);
  });

  // === Self-hosted AI provider (provider layer 2026-06) ===

  it('AI_SELFHOSTED_BASE_URL absent → no error (feature OFF) and no AI_SELFHOSTED_MODEL requirement', () => {
    const env = buildHealthyEnv();
    delete env.AI_SELFHOSTED_BASE_URL;
    delete env.AI_SELFHOSTED_MODEL;
    const result = check(env);
    expect(result.errors).toEqual([]);
  });

  it('AI_SELFHOSTED_BASE_URL with a non-URL shape → INVALID FORMAT in prod mode', () => {
    const env = buildHealthyEnv();
    env.AI_SELFHOSTED_BASE_URL = 'localhost:11434'; // missing http(s)://
    const result = check(env);
    expect(
      result.errors.some(
        (e) => e.startsWith('INVALID FORMAT:') && e.includes('AI_SELFHOSTED_BASE_URL'),
      ),
    ).toBe(true);
  });

  it('AI_SELFHOSTED_BASE_URL set WITHOUT AI_SELFHOSTED_MODEL → MISSING (requiredIf)', () => {
    const env = buildHealthyEnv();
    env.AI_SELFHOSTED_BASE_URL = 'http://localhost:11434/v1';
    delete env.AI_SELFHOSTED_MODEL;
    const result = check(env);
    expect(
      result.errors.some((e) => e.startsWith('MISSING:') && e.includes('AI_SELFHOSTED_MODEL')),
    ).toBe(true);
  });

  it('healthy self-hosted pair (URL + model) passes', () => {
    const env = buildHealthyEnv();
    env.AI_SELFHOSTED_BASE_URL = 'http://vllm.internal:8000/v1';
    env.AI_SELFHOSTED_MODEL = 'XiaomiMiMo/MiMo-7B-RL';
    expect(check(env).errors).toEqual([]);
  });

  it('test mode tolerates a bad URL shape (warning, not error)', () => {
    const result = check({ AI_SELFHOSTED_BASE_URL: 'not-a-url' }, { mode: 'test' });
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes('AI_SELFHOSTED_BASE_URL'))).toBe(true);
  });

  // === SII PSE credentials (sii-noop-guard 2026-06-12) ===

  it('SII_PSE absent → no error (prod fails-closed at runtime, not at env check)', () => {
    const env = buildHealthyEnv();
    delete env.SII_PSE;
    delete env.BSALE_ACCESS_TOKEN;
    delete env.BSALE_OFFICE_ID;
    delete env.OPENFACTURA_API_KEY;
    delete env.SIMPLEAPI_API_KEY;
    delete env.LIBREDTE_API_TOKEN;
    const result = check(env);
    expect(result.errors).toEqual([]);
  });

  it('SII_PSE=bsale WITHOUT credentials → MISSING for both BSALE_* vars', () => {
    const env = buildHealthyEnv();
    env.SII_PSE = 'bsale';
    delete env.BSALE_ACCESS_TOKEN;
    delete env.BSALE_OFFICE_ID;
    const result = check(env);
    expect(
      result.errors.some((e) => e.startsWith('MISSING:') && e.includes('BSALE_ACCESS_TOKEN')),
    ).toBe(true);
    expect(
      result.errors.some((e) => e.startsWith('MISSING:') && e.includes('BSALE_OFFICE_ID')),
    ).toBe(true);
  });

  it('SII_PSE=bsale WITH credentials → passes', () => {
    const env = buildHealthyEnv();
    env.SII_PSE = 'bsale';
    env.BSALE_ACCESS_TOKEN = 'bsale-real-token-abcdef0123456789';
    env.BSALE_OFFICE_ID = '42';
    expect(check(env).errors).toEqual([]);
  });

  it('SII_PSE=openfactura WITHOUT its key → MISSING OPENFACTURA_API_KEY', () => {
    const env = buildHealthyEnv();
    env.SII_PSE = 'openfactura';
    delete env.OPENFACTURA_API_KEY;
    const result = check(env);
    expect(
      result.errors.some((e) => e.startsWith('MISSING:') && e.includes('OPENFACTURA_API_KEY')),
    ).toBe(true);
    // The Bsale creds are NOT required when SII_PSE=openfactura.
    expect(result.errors.some((e) => e.includes('BSALE_ACCESS_TOKEN'))).toBe(false);
  });

  it('SII_PSE=noop is a valid (allowed) value and requires no PSE creds', () => {
    const env = buildHealthyEnv();
    env.SII_PSE = 'noop';
    delete env.BSALE_ACCESS_TOKEN;
    delete env.BSALE_OFFICE_ID;
    delete env.OPENFACTURA_API_KEY;
    const result = check(env);
    expect(result.errors).toEqual([]);
  });

  it('SII_PSE with an unknown value → INVALID VALUE', () => {
    const env = buildHealthyEnv();
    env.SII_PSE = 'factura-imaginaria';
    const result = check(env);
    expect(
      result.errors.some((e) => e.startsWith('INVALID VALUE:') && e.includes('SII_PSE')),
    ).toBe(true);
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
