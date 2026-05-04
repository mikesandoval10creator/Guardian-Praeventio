#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// validate-env.cjs — Sprint 21 Ola 6 / Bucket U.
//
// Boot-time guard for production environment variables. Run before
// `npm start` (wired via "prestart" in package.json) so the server
// refuses to come up with placeholders left over from .env.example.
//
// Modes:
//   - default (prod): every non-optional var must be present, real, and
//     pass minLength + allowedValues checks. Exits 1 on any error.
//   - --mode test: optional vars are skipped silently and placeholder
//     values are accepted. Used by CI smoke jobs that only need the
//     shape of the env to be sane (real secrets are kept in GH secrets
//     and only injected for deploy jobs).
//
// Discovery: see docs/runbooks/SECRETS_RUNBOOK.md for how to obtain
// each value, expected format, where it is consumed in code, and the
// rotation cadence. STATE_OF_FUNCTIONALITY_2026-05-04.md tracks which
// features degrade silently if a given optional var is absent.
'use strict';

const REQUIRED_PROD = [
  // === Auth & Identity ===
  { name: 'GOOGLE_CLIENT_ID', purpose: 'OAuth Calendar + Fit', mode: 'prod' },
  { name: 'GOOGLE_CLIENT_SECRET', purpose: 'OAuth Calendar + Fit', mode: 'prod' },
  { name: 'SESSION_SECRET', purpose: 'express-session signing', mode: 'prod', minLength: 32 },

  // === Maps + Push ===
  { name: 'VITE_GOOGLE_MAPS_API_KEY', purpose: '4 mapas + Site25DPanel', mode: 'prod' },
  { name: 'VITE_FIREBASE_VAPID_KEY', purpose: 'Web Push FCM tokens', mode: 'prod' },

  // === Billing ===
  { name: 'WEBPAY_COMMERCE_CODE', purpose: 'Transbank prod', mode: 'prod' },
  { name: 'WEBPAY_API_KEY', purpose: 'Transbank prod', mode: 'prod' },
  { name: 'MP_IPN_SECRET', purpose: 'MercadoPago IPN HMAC', mode: 'prod', minLength: 16 },
  { name: 'KHIPU_RECEIVER_ID', purpose: 'Khipu prod (opcional)', mode: 'prod', optional: true },
  { name: 'KHIPU_SECRET', purpose: 'Khipu prod (opcional)', mode: 'prod', optional: true },
  { name: 'GOOGLE_PLAY_PACKAGE_NAME', purpose: 'Android billing', mode: 'prod' },
  { name: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', purpose: 'Android billing JWT', mode: 'prod' },
  { name: 'GOOGLE_PLAY_RTDN_TOPIC', purpose: 'Pub/Sub RTDN', mode: 'prod' },

  // === Telemetry & Errors ===
  { name: 'IOT_WEBHOOK_SECRET', purpose: 'HMAC telemetry HMAC', mode: 'prod', minLength: 32 },
  { name: 'SENTRY_DSN', purpose: 'Error tracking server', mode: 'prod' },
  { name: 'VITE_SENTRY_DSN', purpose: 'Error tracking client', mode: 'prod' },

  // === KMS ===
  {
    name: 'KMS_ADAPTER',
    purpose: 'KEK source prod',
    mode: 'prod',
    allowedValues: ['cloud-kms', 'in-memory-dev'],
  },

  // === AI ===
  { name: 'GEMINI_API_KEY', purpose: 'Gemini LLM', mode: 'prod' },

  // === Photogrammetry (opcional — features se desactivan si missing) ===
  {
    name: 'PHOTOGRAMMETRY_WORKER_URL',
    purpose: 'COLMAP CPU worker',
    mode: 'prod',
    optional: true,
  },
  {
    name: 'PHOTOGRAMMETRY_WORKER_TOKEN',
    purpose: 'COLMAP auth',
    mode: 'prod',
    optional: true,
  },

  // === DWG converter (opcional) ===
  { name: 'DWG_CONVERTER_URL', purpose: 'LibreDWG cloud function', mode: 'prod', optional: true },
  { name: 'DWG_CONVERTER_TOKEN', purpose: 'DWG converter auth', mode: 'prod', optional: true },

  // === SLM offline (opcional) ===
  {
    name: 'SLM_OFFLINE_ENABLED',
    purpose: 'Feature flag SLM offline',
    mode: 'prod',
    optional: true,
    allowedValues: ['true', 'false'],
  },
];

const PLACEHOLDER_REGEX = /^(YOUR_|MY_|REPLACE_|PLACEHOLDER|<.*>)/i;

/**
 * Runs the validation against a given env object and mode.
 * Pure: no console / process side effects. Returns
 * `{ errors, warnings, checked }` so tests can inspect.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {{ mode?: 'prod' | 'test' }} options
 */
function check(env, options = {}) {
  const mode = options.mode === 'test' ? 'test' : 'prod';
  const errors = [];
  const warnings = [];

  for (const spec of REQUIRED_PROD) {
    const value = env[spec.name];
    const isEmpty = !value || String(value).trim() === '';

    if (isEmpty) {
      if (spec.optional) {
        warnings.push(`${spec.name} (${spec.purpose}) — feature disabled`);
      } else if (mode === 'test') {
        // CI smoke: missing non-optional becomes a warning.
        warnings.push(`${spec.name} (${spec.purpose}) — missing in test mode`);
      } else {
        errors.push(`MISSING: ${spec.name} (${spec.purpose})`);
      }
      continue;
    }

    if (PLACEHOLDER_REGEX.test(String(value))) {
      if (mode === 'test') {
        warnings.push(`${spec.name} — placeholder accepted in test mode`);
        continue;
      }
      errors.push(
        `PLACEHOLDER: ${spec.name} = "${String(value).slice(0, 20)}..." — replace with real value`,
      );
      continue;
    }

    if (spec.minLength && String(value).length < spec.minLength) {
      errors.push(
        `TOO SHORT: ${spec.name} (${String(value).length} chars, min ${spec.minLength})`,
      );
      continue;
    }

    if (spec.allowedValues && !spec.allowedValues.includes(String(value))) {
      errors.push(
        `INVALID VALUE: ${spec.name} = "${value}" — allowed: ${spec.allowedValues.join(', ')}`,
      );
      continue;
    }
  }

  return { errors, warnings, checked: REQUIRED_PROD.length, mode };
}

/**
 * CLI entrypoint. Prints to stderr/stdout and exits non-zero on errors.
 * Tests should call `check()` directly and avoid this.
 */
function validate() {
  const argMode = process.argv.includes('--mode')
    ? process.argv[process.argv.indexOf('--mode') + 1]
    : 'prod';

  const result = check(process.env, { mode: argMode });

  if (result.errors.length > 0) {
    console.error('\nENV VALIDATION FAILED:\n');
    for (const e of result.errors) console.error('  ' + e);
    console.error('\nSee docs/runbooks/SECRETS_RUNBOOK.md for how to obtain each secret.\n');
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    console.warn('\nENV WARNINGS (non-blocking):\n');
    for (const w of result.warnings) console.warn('  ' + w);
    console.warn('');
  }

  console.log(
    `Env validation passed (${result.checked} vars checked, mode=${result.mode}).\n`,
  );
}

if (require.main === module) {
  validate();
}

module.exports = { validate, check, REQUIRED_PROD, PLACEHOLDER_REGEX };
