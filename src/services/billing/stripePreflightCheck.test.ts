// Praeventio Guard — Stripe pre-flight tests.
//
// Hermetic. The preflight is pure-functional over the env dict we pass
// in, so we never mutate `process.env` — each case builds its own
// `env: NodeJS.ProcessEnv` from scratch.
//
// We assert on the stable `code` field of failures, not the human
// detail string, so wording can evolve without breaking tests.

import { describe, expect, it } from 'vitest';
import {
  runStripePreflight,
  STRIPE_SUPPORTED_CURRENCIES,
  STRIPE_CANONICAL_WEBHOOK_PATH,
  type StripePreflightInput,
} from './stripePreflightCheck.js';

/** Build a valid baseline env. Each test overrides specific keys. */
function liveEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    STRIPE_SECRET_KEY: 'sk_live_abc123example',
    STRIPE_PUBLISHABLE_KEY: 'pk_live_xyz789example',
    STRIPE_WEBHOOK_SECRET: 'whsec_topsecret123',
    NODE_ENV: 'production',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function testEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    STRIPE_SECRET_KEY: 'sk_test_abc123example',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_xyz789example',
    STRIPE_WEBHOOK_SECRET: 'whsec_topsecret123',
    NODE_ENV: 'development',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function baseInput(): StripePreflightInput {
  return {
    env: liveEnv(),
    tier: 'monthly',
    currency: 'USD',
    customerEmail: 'customer@example.com',
    webhookEndpoint: `https://app.example.com${STRIPE_CANONICAL_WEBHOOK_PATH}`,
  };
}

/** Pull the set of blocking codes for easy assertion. */
function blockingCodes(r: ReturnType<typeof runStripePreflight>): string[] {
  return r.blockingFailures.map((f) => f.code);
}

function warningCodes(r: ReturnType<typeof runStripePreflight>): string[] {
  return r.warnings.map((f) => f.code);
}

describe('runStripePreflight — happy paths', () => {
  it('returns ok=true for valid live keys + USD + email + https webhook', () => {
    const r = runStripePreflight(baseInput());
    expect(r.ok).toBe(true);
    expect(r.blockingFailures).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('returns ok=true for valid test keys in development', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: testEnv(),
    });
    expect(r.ok).toBe(true);
    expect(blockingCodes(r)).toEqual([]);
  });

  it('accepts every currency in the allowlist', () => {
    for (const cur of STRIPE_SUPPORTED_CURRENCIES) {
      const r = runStripePreflight({ ...baseInput(), currency: cur });
      expect(r.ok).toBe(true);
    }
  });

  it('accepts lowercase currency input (case-insensitive)', () => {
    const r = runStripePreflight({ ...baseInput(), currency: 'usd' });
    expect(r.ok).toBe(true);
  });

  it('treats customerEmail as optional', () => {
    const r = runStripePreflight({
      ...baseInput(),
      customerEmail: undefined,
    });
    expect(r.ok).toBe(true);
  });

  it('treats webhookEndpoint as optional', () => {
    const r = runStripePreflight({
      ...baseInput(),
      webhookEndpoint: undefined,
    });
    expect(r.ok).toBe(true);
  });
});

describe('runStripePreflight — missing env vars', () => {
  it('blocks when STRIPE_SECRET_KEY is missing', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: liveEnv({ STRIPE_SECRET_KEY: undefined }),
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_secret_key_missing');
  });

  it('blocks when STRIPE_SECRET_KEY is empty string', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: liveEnv({ STRIPE_SECRET_KEY: '   ' }),
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_secret_key_missing');
  });

  it('blocks when STRIPE_PUBLISHABLE_KEY is missing', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: liveEnv({ STRIPE_PUBLISHABLE_KEY: undefined }),
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_publishable_key_missing');
  });

  it('blocks when STRIPE_WEBHOOK_SECRET is missing', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: liveEnv({ STRIPE_WEBHOOK_SECRET: undefined }),
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_webhook_secret_missing');
  });
});

describe('runStripePreflight — key-shape attacks', () => {
  it('blocks when publishable key (pk_) is pasted into STRIPE_SECRET_KEY (security)', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: liveEnv({ STRIPE_SECRET_KEY: 'pk_live_leakedclientkey' }),
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_secret_key_is_publishable');
    // Recommendation should mention rotation.
    expect(r.recommendations.some((s) => /rotate/i.test(s))).toBe(true);
  });

  it('blocks when STRIPE_SECRET_KEY has an unrecognized prefix', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: liveEnv({ STRIPE_SECRET_KEY: 'rk_live_restrictedkey' }),
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_secret_key_invalid_prefix');
  });

  it('blocks when STRIPE_PUBLISHABLE_KEY has an unrecognized prefix', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: liveEnv({ STRIPE_PUBLISHABLE_KEY: 'sk_live_swappedintoclient' }),
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_publishable_key_invalid_prefix');
  });

  it('blocks when STRIPE_WEBHOOK_SECRET has wrong prefix', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: liveEnv({ STRIPE_WEBHOOK_SECRET: 'sk_live_notawebhook' }),
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_webhook_secret_invalid_prefix');
  });
});

describe('runStripePreflight — live/test consistency', () => {
  it('blocks when secret is live but publishable is test', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: liveEnv({ STRIPE_PUBLISHABLE_KEY: 'pk_test_xyz789example' }),
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_live_test_mismatch');
  });

  it('blocks when secret is test but publishable is live', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: testEnv({ STRIPE_PUBLISHABLE_KEY: 'pk_live_xyz789example' }),
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_live_test_mismatch');
  });
});

describe('runStripePreflight — test keys in production (warning, not blocking)', () => {
  it('warns but does not block on sk_test_ + NODE_ENV=production', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: testEnv({ NODE_ENV: 'production' }),
    });
    expect(r.ok).toBe(true);
    expect(warningCodes(r)).toContain('stripe_test_keys_in_production');
  });

  it('does not warn on sk_test_ when NODE_ENV is not production', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: testEnv({ NODE_ENV: 'development' }),
    });
    expect(warningCodes(r)).not.toContain('stripe_test_keys_in_production');
  });
});

describe('runStripePreflight — currency allowlist', () => {
  it('blocks CLP and routes the user to Webpay/Khipu', () => {
    const r = runStripePreflight({ ...baseInput(), currency: 'CLP' });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_unsupported_currency');
    // Specific recommendation should mention the right rail.
    expect(r.recommendations.some((s) => /Webpay|Khipu/i.test(s))).toBe(true);
  });

  it('blocks an unknown currency code', () => {
    const r = runStripePreflight({ ...baseInput(), currency: 'XYZ' });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_unsupported_currency');
  });
});

describe('runStripePreflight — customerEmail validation', () => {
  it('blocks malformed email (missing @)', () => {
    const r = runStripePreflight({
      ...baseInput(),
      customerEmail: 'not-an-email.com',
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_customer_email_invalid');
  });

  it('blocks malformed email (missing TLD)', () => {
    const r = runStripePreflight({
      ...baseInput(),
      customerEmail: 'foo@localhost',
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_customer_email_invalid');
  });

  it('accepts a valid email', () => {
    const r = runStripePreflight({
      ...baseInput(),
      customerEmail: 'cliente.global@example.co.uk',
    });
    expect(r.ok).toBe(true);
  });
});

describe('runStripePreflight — webhook endpoint', () => {
  it('blocks http:// non-localhost webhook', () => {
    const r = runStripePreflight({
      ...baseInput(),
      webhookEndpoint: `http://app.example.com${STRIPE_CANONICAL_WEBHOOK_PATH}`,
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain('stripe_webhook_endpoint_insecure');
  });

  it('allows http://localhost for dev webhook listener', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: testEnv(),
      webhookEndpoint: `http://localhost:3000${STRIPE_CANONICAL_WEBHOOK_PATH}`,
    });
    expect(r.ok).toBe(true);
  });

  it('warns when webhook path is not canonical', () => {
    const r = runStripePreflight({
      ...baseInput(),
      webhookEndpoint: 'https://app.example.com/some/other/path',
    });
    expect(r.ok).toBe(true);
    expect(warningCodes(r)).toContain(
      'stripe_webhook_endpoint_non_canonical_path',
    );
  });

  it('blocks non-http(s) webhook scheme', () => {
    const r = runStripePreflight({
      ...baseInput(),
      webhookEndpoint: `ftp://app.example.com${STRIPE_CANONICAL_WEBHOOK_PATH}`,
    });
    expect(r.ok).toBe(false);
    expect(blockingCodes(r)).toContain(
      'stripe_webhook_endpoint_invalid_scheme',
    );
  });
});

describe('runStripePreflight — recommendations + structure', () => {
  it('returns recommendations for every blocking failure category', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: liveEnv({
        STRIPE_SECRET_KEY: undefined,
        STRIPE_PUBLISHABLE_KEY: undefined,
        STRIPE_WEBHOOK_SECRET: undefined,
      }),
      currency: 'CLP',
      customerEmail: 'broken',
    });
    expect(r.ok).toBe(false);
    expect(r.blockingFailures.length).toBeGreaterThanOrEqual(4);
    expect(r.recommendations.length).toBeGreaterThanOrEqual(4);
  });

  it('never echoes secret values in failure details', () => {
    const r = runStripePreflight({
      ...baseInput(),
      env: liveEnv({ STRIPE_SECRET_KEY: 'pk_live_FULL_LEAKED_SECRET_VALUE' }),
    });
    const allDetails = r.blockingFailures.map((f) => f.detail).join(' ');
    expect(allDetails).not.toContain('FULL_LEAKED_SECRET_VALUE');
  });
});
