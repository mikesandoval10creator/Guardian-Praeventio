// SPDX-License-Identifier: MIT
//
// webpayPreflight — boot-time guard for Webpay/Transbank production credentials.
//
// Ticket 3bfaa66d-...: WebpayAdapter.resolveOptions() falls back silently to
// Transbank's sandbox ("Tienda de Integración") when WEBPAY_COMMERCE_CODE or
// WEBPAY_API_KEY are missing — even in production. That means a deploy that
// forgets to inject the secret pair routes real customer transactions to the
// sandbox: cards are not charged, but customers see "pago exitoso" in the UI.
// Failure mode is silent and observable only via Sentry (no bank-side alert).
//
// This preflight mirrors kmsPreflight.ts: at server boot, if NODE_ENV=production
// and the Webpay env vars are missing, the process exits 1 with a FATAL log.
// The WebpayAdapter code is unchanged — its sandbox default is still correct
// for dev/CI. We add the production contract here so an ops mistake fails the
// deploy loudly instead of routing live payments to integration.
//
// Discovery 2026-08-17.

export interface WebpayBootConfigResult {
  ok: boolean;
  mode: 'production' | 'non-production';
  errors: string[];
  warnings: string[];
}

type WebpayBootEnv = {
  NODE_ENV?: string;
  WEBPAY_COMMERCE_CODE?: string;
  WEBPAY_API_KEY?: string;
  WEBPAY_ENV?: string;
  WEBPAY_ENVIRONMENT?: string;
};

export function validateWebpayBootConfig(env: WebpayBootEnv): WebpayBootConfigResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isProduction = env.NODE_ENV === 'production';

  if (!isProduction) {
    // Dev/test/CI: sandbox default is intentional. Emit a debug-only warning
    // when secrets ARE set in non-prod (operators often copy .env.example and
    // ship to staging without flipping NODE_ENV).
    if (env.WEBPAY_COMMERCE_CODE && env.WEBPAY_API_KEY) {
      warnings.push(
        'WEBPAY_COMMERCE_CODE+WEBPAY_API_KEY are set but NODE_ENV is not "production" — WebpayAdapter will use these credentials (or the explicit WEBPAY_ENV flag) for the current run.',
      );
    }
    return { ok: true, mode: 'non-production', errors, warnings };
  }

  // Production: require both env vars, OR an explicit init() override.
  // The webpayAdapter.isConfigured() helper already encodes this logic for
  // runtime; we just lift it to boot.
  if (!env.WEBPAY_COMMERCE_CODE) {
    errors.push(
      'Production requires WEBPAY_COMMERCE_CODE. Without it WebpayAdapter.resolveOptions() falls back silently to Transbank sandbox — real customer transactions would NOT be charged.',
    );
  }
  if (!env.WEBPAY_API_KEY) {
    errors.push(
      'Production requires WEBPAY_API_KEY. Without it WebpayAdapter.resolveOptions() falls back silently to Transbank sandbox.',
    );
  }

  // Detect the most common copy-paste mistake: NODE_ENV=production but
  // WEBPAY_ENV left at the .env.example default 'integration'.
  const envFlag = env.WEBPAY_ENV ?? env.WEBPAY_ENVIRONMENT;
  if (env.WEBPAY_COMMERCE_CODE && env.WEBPAY_API_KEY && envFlag === 'integration') {
    warnings.push(
      'WEBPAY_ENV="integration" but NODE_ENV="production". Confirm this is a staging deploy, not production: with NODE_ENV=production the adapter falls back to env vars (not the sandbox default), but the URL will point at integration.',
    );
  }

  return {
    ok: errors.length === 0,
    mode: 'production',
    errors,
    warnings,
  };
}