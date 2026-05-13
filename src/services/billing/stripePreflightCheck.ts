// Praeventio Guard — Stripe pre-flight environment checks.
//
// Pure, side-effect-free motor that validates everything Stripe needs
// (env vars, currency allowlist, webhook URL shape, customer email,
// live/test consistency) BEFORE the server calls into the real Stripe
// SDK. Catches the boring-but-catastrophic class of bugs at boot or at
// the start of every checkout request:
//
//   • Pasting `pk_live_…` into `STRIPE_SECRET_KEY` (leaks the secret
//     key path and breaks payments simultaneously — classic config
//     swap mistake).
//   • `sk_live_…` paired with `pk_test_…` (charges go through but the
//     client-side hosted checkout never reconciles → silent revenue
//     loss).
//   • `http://` webhook endpoint (Stripe will refuse, but failing
//     here gives a clearer error than the upstream 4xx).
//   • Currency not in the platform allowlist (Stripe accepts ~135
//     currencies; we deliberately gate to the 10 we have FX + invoice
//     translations for).
//
// IMPORTANT CONTEXT (project_business_decisions_2026-05-03):
//   Stripe is the INTERNATIONAL rail only. Chile uses Transbank/Khipu
//   (CLP). Stripe is for USD / EUR / etc. card flows from clients
//   outside Chile. The preflight rejects CLP on purpose — if you see
//   CLP here, you're routing to the wrong adapter.
//
// Design notes:
//   • Pure function over `NodeJS.ProcessEnv` so call sites can fake
//     env in tests without monkeypatching `process.env`.
//   • Two-tier severity: `blockingFailures` halt checkout; `warnings`
//     surface to logs/admin dashboards but allow the flow to proceed
//     (e.g. test keys in production are usually a staging-deploy
//     fingerprint, not a release-blocker).
//   • Never logs the secret values back out — only reports prefixes.

/** Stripe key prefixes — split into namespaced consts for grep-ability. */
const SECRET_KEY_PREFIXES = ['sk_live_', 'sk_test_'] as const;
const PUBLISHABLE_KEY_PREFIXES = ['pk_live_', 'pk_test_'] as const;
const WEBHOOK_SECRET_PREFIX = 'whsec_';
const PUBLISHABLE_KEY_PREFIX_GENERIC = 'pk_';

/**
 * Currencies the platform is wired to invoice in. Anything else throws
 * at preflight rather than at Stripe (clearer error, faster fail).
 *
 * Note CLP is intentionally absent — see file header.
 */
const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'MXN',
  'COP',
  'ARS',
  'PEN',
  'BRL',
  'GBP',
  'AUD',
  'CAD',
] as const;

/** Canonical webhook path expected by `routes/billing.ts`. */
const CANONICAL_WEBHOOK_PATH = '/api/billing/stripe/webhook';

/**
 * Very intentional permissive regex — Stripe will do the authoritative
 * email validation. We just want to catch obvious typos like missing
 * `@` or no TLD before the network round-trip.
 */
const EMAIL_RE = /^[^@\s]+@[^.\s@]+\.[^\s@]+$/;

export type StripeTier = 'monthly' | 'annual' | 'one_time';

export interface StripePreflightInput {
  /** Environment to read from. Pass `process.env` in prod; fake in tests. */
  env: NodeJS.ProcessEnv;
  /** Tier being purchased. */
  tier: StripeTier;
  /** ISO 4217 currency code. Case-insensitive — we upper-case before comparing. */
  currency: string;
  /** Customer email — optional; Stripe can also collect on hosted checkout. */
  customerEmail?: string;
  /** Webhook URL to compare against canonical path. Optional during preflight. */
  webhookEndpoint?: string;
}

export interface StripePreflightFailure {
  /** Stable machine code (snake_case). Wire up to dashboards/alerts. */
  code: string;
  /** Human-readable detail. Never includes the raw secret value. */
  detail: string;
}

export interface StripePreflightResult {
  /** True iff there are zero blocking failures. Warnings do not flip this. */
  ok: boolean;
  blockingFailures: StripePreflightFailure[];
  warnings: StripePreflightFailure[];
  /** Actionable next-steps the caller should surface in the admin UI. */
  recommendations: string[];
}

/**
 * Run the Stripe pre-flight check.
 *
 * Never throws — always returns a `StripePreflightResult`. Callers
 * should branch on `.ok` and refuse to call the Stripe SDK if false.
 *
 * @example
 * const pf = runStripePreflight({ env: process.env, tier: 'monthly', currency: 'USD' });
 * if (!pf.ok) {
 *   logger.error('stripe.preflight.fail', { failures: pf.blockingFailures });
 *   return res.status(503).json({ error: 'stripe_not_ready', recommendations: pf.recommendations });
 * }
 */
export function runStripePreflight(
  input: StripePreflightInput,
): StripePreflightResult {
  const blockingFailures: StripePreflightFailure[] = [];
  const warnings: StripePreflightFailure[] = [];
  const recommendations: string[] = [];

  const secret = input.env.STRIPE_SECRET_KEY;
  const publishable = input.env.STRIPE_PUBLISHABLE_KEY;
  const webhookSecret = input.env.STRIPE_WEBHOOK_SECRET;
  const nodeEnv = input.env.NODE_ENV;

  // 1. STRIPE_SECRET_KEY: presence + secret-shape check.
  if (!secret || secret.trim().length === 0) {
    blockingFailures.push({
      code: 'stripe_secret_key_missing',
      detail: 'STRIPE_SECRET_KEY env var is not set.',
    });
    recommendations.push(
      'Set STRIPE_SECRET_KEY in the deployment environment (use `sk_live_…` for production, `sk_test_…` for staging).',
    );
  } else if (secret.startsWith(PUBLISHABLE_KEY_PREFIX_GENERIC)) {
    // CRITICAL: pk_ in the secret slot is the canonical "I swapped the
    // dashboard fields" mistake. Treat as security-incident-adjacent.
    blockingFailures.push({
      code: 'stripe_secret_key_is_publishable',
      detail:
        'STRIPE_SECRET_KEY starts with `pk_`. That is a publishable (client) key — the actual secret key starts with `sk_`. Rotate immediately if this was committed anywhere.',
    });
    recommendations.push(
      'Rotate the publishable key in the Stripe dashboard (it may have been mistaken for the secret). Then paste the correct `sk_…` into STRIPE_SECRET_KEY.',
    );
  } else if (!SECRET_KEY_PREFIXES.some((p) => secret.startsWith(p))) {
    blockingFailures.push({
      code: 'stripe_secret_key_invalid_prefix',
      detail: `STRIPE_SECRET_KEY does not start with sk_live_ or sk_test_ (got prefix "${secret.slice(0, 8)}…").`,
    });
    recommendations.push(
      'Copy the secret key from https://dashboard.stripe.com/apikeys (it begins with `sk_live_` or `sk_test_`).',
    );
  }

  // 2. STRIPE_PUBLISHABLE_KEY.
  if (!publishable || publishable.trim().length === 0) {
    blockingFailures.push({
      code: 'stripe_publishable_key_missing',
      detail: 'STRIPE_PUBLISHABLE_KEY env var is not set.',
    });
    recommendations.push(
      'Set STRIPE_PUBLISHABLE_KEY in the deployment environment (`pk_live_…` or `pk_test_…`).',
    );
  } else if (!PUBLISHABLE_KEY_PREFIXES.some((p) => publishable.startsWith(p))) {
    blockingFailures.push({
      code: 'stripe_publishable_key_invalid_prefix',
      detail: `STRIPE_PUBLISHABLE_KEY does not start with pk_live_ or pk_test_ (got prefix "${publishable.slice(0, 8)}…").`,
    });
    recommendations.push(
      'Copy the publishable key from https://dashboard.stripe.com/apikeys (it begins with `pk_live_` or `pk_test_`).',
    );
  }

  // 3. STRIPE_WEBHOOK_SECRET.
  if (!webhookSecret || webhookSecret.trim().length === 0) {
    blockingFailures.push({
      code: 'stripe_webhook_secret_missing',
      detail: 'STRIPE_WEBHOOK_SECRET env var is not set.',
    });
    recommendations.push(
      'Create a webhook endpoint in https://dashboard.stripe.com/webhooks and copy its signing secret (`whsec_…`) into STRIPE_WEBHOOK_SECRET.',
    );
  } else if (!webhookSecret.startsWith(WEBHOOK_SECRET_PREFIX)) {
    blockingFailures.push({
      code: 'stripe_webhook_secret_invalid_prefix',
      detail: `STRIPE_WEBHOOK_SECRET does not start with "whsec_" (got prefix "${webhookSecret.slice(0, 8)}…").`,
    });
    recommendations.push(
      'Use the signing secret from the Stripe webhook detail page — it always starts with `whsec_`.',
    );
  }

  // 4. live/test consistency. Only checked if both keys passed prefix
  //    validation — otherwise the user gets stacked confusing errors.
  if (
    secret &&
    publishable &&
    SECRET_KEY_PREFIXES.some((p) => secret.startsWith(p)) &&
    PUBLISHABLE_KEY_PREFIXES.some((p) => publishable.startsWith(p))
  ) {
    const secretIsLive = secret.startsWith('sk_live_');
    const publishableIsLive = publishable.startsWith('pk_live_');
    if (secretIsLive !== publishableIsLive) {
      blockingFailures.push({
        code: 'stripe_live_test_mismatch',
        detail: `STRIPE_SECRET_KEY is ${secretIsLive ? 'live' : 'test'} but STRIPE_PUBLISHABLE_KEY is ${publishableIsLive ? 'live' : 'test'}. Mixed modes silently break payments.`,
      });
      recommendations.push(
        'Use both live keys together (sk_live_… + pk_live_…) or both test keys together (sk_test_… + pk_test_…). Never mix.',
      );
    }
  }

  // 5. test-keys-in-production warning (non-blocking — sometimes
  //    intentional during staging deploys to prod-like env).
  if (
    secret &&
    secret.startsWith('sk_test_') &&
    nodeEnv === 'production'
  ) {
    warnings.push({
      code: 'stripe_test_keys_in_production',
      detail:
        'STRIPE_SECRET_KEY is a test key (`sk_test_…`) but NODE_ENV is "production". Real customers will see "test mode" badges and no charges will settle.',
    });
    recommendations.push(
      'If this deployment is production-facing, swap to live keys (`sk_live_…` + `pk_live_…`).',
    );
  }

  // 6. currency allowlist.
  const currencyUpper = input.currency.toUpperCase();
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currencyUpper)) {
    blockingFailures.push({
      code: 'stripe_unsupported_currency',
      detail: `Currency "${input.currency}" is not in the Stripe allowlist. Supported: ${SUPPORTED_CURRENCIES.join(', ')}.`,
    });
    if (currencyUpper === 'CLP') {
      // Chile-specific hint — route to the right rail.
      recommendations.push(
        'CLP transactions must go through the Webpay/Khipu adapter, not Stripe. See `routes/billing.ts` paymentMethod routing.',
      );
    } else {
      recommendations.push(
        `Either request "${currencyUpper}" be added to SUPPORTED_CURRENCIES in stripePreflightCheck.ts, or quote the customer in one of: ${SUPPORTED_CURRENCIES.join(', ')}.`,
      );
    }
  }

  // 7. customerEmail validation — only if provided.
  if (input.customerEmail !== undefined) {
    if (!EMAIL_RE.test(input.customerEmail)) {
      blockingFailures.push({
        code: 'stripe_customer_email_invalid',
        detail: `customerEmail "${input.customerEmail}" failed shape validation (expected basic local@domain.tld).`,
      });
      recommendations.push(
        'Confirm the email collected in checkout has an `@`, a domain, and a TLD before calling Stripe.',
      );
    }
  }

  // 8. webhookEndpoint shape — only if provided. We allow localhost on
  //    http:// for dev (Stripe CLI listens on localhost), but reject
  //    any other http:// URL.
  if (input.webhookEndpoint !== undefined && input.webhookEndpoint.length > 0) {
    const wh = input.webhookEndpoint;
    const isLocalhost =
      wh.includes('://localhost') || wh.includes('://127.0.0.1');
    if (wh.startsWith('http://') && !isLocalhost) {
      blockingFailures.push({
        code: 'stripe_webhook_endpoint_insecure',
        detail: `Webhook endpoint "${wh}" uses http://. Stripe requires HTTPS for non-localhost webhook delivery.`,
      });
      recommendations.push(
        'Front the webhook endpoint with HTTPS (e.g. Cloud Run, Vercel, or a TLS-terminating reverse proxy).',
      );
    } else if (!wh.startsWith('https://') && !isLocalhost) {
      blockingFailures.push({
        code: 'stripe_webhook_endpoint_invalid_scheme',
        detail: `Webhook endpoint "${wh}" must start with https:// (or localhost http:// for dev).`,
      });
      recommendations.push(
        'Set the webhook endpoint to an https:// URL.',
      );
    }

    // Canonical path warning — non-blocking.
    if (!wh.endsWith(CANONICAL_WEBHOOK_PATH)) {
      warnings.push({
        code: 'stripe_webhook_endpoint_non_canonical_path',
        detail: `Webhook endpoint "${wh}" does not end with "${CANONICAL_WEBHOOK_PATH}". The server-side handler only listens on that path.`,
      });
      recommendations.push(
        `Point the Stripe dashboard webhook at <your-host>${CANONICAL_WEBHOOK_PATH}.`,
      );
    }
  }

  // tier currently has no semantic preflight — Stripe Price IDs are
  // validated server-side. We accept it for future-proofing (e.g.
  // annual-only currencies) and so the call site is shaped right.
  void input.tier;

  return {
    ok: blockingFailures.length === 0,
    blockingFailures,
    warnings,
    recommendations,
  };
}

/** Exported for tests + admin dashboards listing accepted currencies. */
export const STRIPE_SUPPORTED_CURRENCIES = SUPPORTED_CURRENCIES;
/** Exported for tests + dashboard help text. */
export const STRIPE_CANONICAL_WEBHOOK_PATH = CANONICAL_WEBHOOK_PATH;
