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
//   - --mode prod-secret-manager: assumes Cloud Run is the runtime and
//     that secrets come from Google Cloud Secret Manager rather than
//     local `.env`. Skips per-secret presence checks and only asserts
//     `GOOGLE_CLOUD_PROJECT` is set, then warns about which secrets
//     are expected to live in Secret Manager (so an operator can
//     cross-check with `gcloud secrets list`). Bucket V.5.
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
  // Optional dedicated pepper for the culture-pulse responder hash (worker-survey
  // anonymity, Ley Karín 21.643). When absent the hash keys off SESSION_SECRET,
  // so this is opt-in key-separation — but if set it MUST be a strong secret.
  { name: 'CULTURE_PULSE_PEPPER', purpose: 'culture-pulse responder-hash pepper (opcional; fallback SESSION_SECRET)', mode: 'prod', optional: true, minLength: 32 },

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
  // Sprint 39 Fase B.3: en prod SOLO se acepta cloud-kms. El boot ya falla
  // cerrado en server.ts via kmsPreflight.ts, este check duplica la
  // protección en el contrato de deploy para que un PR que cambie a
  // in-memory-dev en prod sea rechazado por CI antes del rollout.
  {
    name: 'KMS_ADAPTER',
    purpose: 'KEK source prod (debe ser cloud-kms en prod)',
    mode: 'prod',
    allowedValues: ['cloud-kms'],
  },
  {
    name: 'KMS_KEY_RESOURCE_NAME',
    purpose: 'KEK resource name prod (projects/.../cryptoKeys/...)',
    mode: 'prod',
    requiredIf: (env) => env.KMS_ADAPTER === 'cloud-kms',
  },

  // === MercadoPago prod contract (Sprint 39 Fase B.4) ===
  // BACKLOG: hasta Sprint 38 solo MP_IPN_SECRET estaba en el contrato.
  // Sin MP_ACCESS_TOKEN no se puede crear preferencia → checkout cae 503.
  { name: 'MP_ACCESS_TOKEN', purpose: 'MercadoPago Access Token prod', mode: 'prod' },
  { name: 'MP_ENV', purpose: 'MercadoPago environment (prod|sandbox)', mode: 'prod', allowedValues: ['prod', 'sandbox'] },

  // === B2D API key salt (2026-05-15 security) ===
  // Sin esto, B2D API keys se hashearían con un salt público conocido.
  // El servicio (`apiKeyService.ts:62`) ahora fail-closes en prod si no
  // está; este check duplica protección en el contrato de deploy.
  { name: 'B2D_API_KEY_SALT', purpose: 'Salt for hashing B2D API keys', mode: 'prod', minLength: 16 },

  // === Apple App Store Server API (Sprint 39 Fase A.2 — IAP validation) ===
  { name: 'APPLE_BUNDLE_ID', purpose: 'Apple bundle identifier', mode: 'prod' },
  { name: 'APPLE_API_KEY_PATH', purpose: 'Apple Connect API .p8 path', mode: 'prod' },
  { name: 'APPLE_KEY_ID', purpose: 'Apple Connect Key ID (10 chars)', mode: 'prod' },
  { name: 'APPLE_ISSUER_ID', purpose: 'Apple Connect Issuer ID (UUID)', mode: 'prod' },
  { name: 'ANDROID_PACKAGE_NAME', purpose: 'Android package name', mode: 'prod' },

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

  // === Self-hosted AI provider (opcional — feature OFF si ausente) ===
  // Endpoint OpenAI-compatible (vLLM / Ollama) para enrutar acciones IA
  // sin depender de cuotas Gemini. Ver docs/runbooks/SELFHOSTED_AI.md.
  // `example` se usa en los tests para construir un env sano que cumpla
  // el `pattern`.
  {
    name: 'AI_SELFHOSTED_BASE_URL',
    purpose: 'endpoint LLM self-hosted OpenAI-compatible (opcional; ausente = feature OFF)',
    mode: 'prod',
    optional: true,
    pattern: '^https?:\\/\\/',
    example: 'http://localhost:11434/v1',
  },
  {
    name: 'AI_SELFHOSTED_MODEL',
    purpose: 'modelo servido por el endpoint self-hosted (p.ej. mimo-7b)',
    mode: 'prod',
    // Requerido SOLO cuando el endpoint está configurado: sin modelo el
    // provider queda OFF en runtime, así que el deploy debe declararlo.
    requiredIf: (env) =>
      Boolean(env.AI_SELFHOSTED_BASE_URL && String(env.AI_SELFHOSTED_BASE_URL).trim()),
  },
];

const PLACEHOLDER_REGEX = /^(YOUR_|MY_|REPLACE_|PLACEHOLDER|<.*>)/i;

// Secrets expected to live in Google Cloud Secret Manager when
// --mode prod-secret-manager is used. Mirrors deploy.yml `secrets:` block
// + the 6 already-wired Sprint 21 secrets. Kept in sync manually because
// the deploy.yml is the source of truth for what Cloud Run actually
// receives at boot.
const SECRET_MANAGER_SECRETS = [
  // Sprint 21 — already wired
  'GEMINI_API_KEY',
  'SESSION_SECRET',
  'RESEND_API_KEY',
  'IOT_WEBHOOK_SECRET',
  'VITE_GOOGLE_MAPS_API_KEY',
  'VITE_OPENWEATHER_API_KEY',
  // Sprint 22 / Bucket V — pending bootstrap
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'VITE_FIREBASE_VAPID_KEY',
  'WEBPAY_COMMERCE_CODE',
  'WEBPAY_API_KEY',
  'MP_IPN_SECRET',
  'GOOGLE_PLAY_PACKAGE_NAME',
  'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
  'GOOGLE_PLAY_RTDN_TOPIC',
  'SENTRY_DSN',
  'VITE_SENTRY_DSN',
  'KHIPU_RECEIVER_ID',
  'KHIPU_SECRET',
  'PHOTOGRAMMETRY_WORKER_TOKEN',
  'DWG_CONVERTER_TOKEN',
  'MODAL_TOKEN',
];

/**
 * Runs the validation against a given env object and mode.
 * Pure: no console / process side effects. Returns
 * `{ errors, warnings, checked }` so tests can inspect.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {{ mode?: 'prod' | 'test' | 'prod-secret-manager' }} options
 */
function check(env, options = {}) {
  const requestedMode = options.mode;
  if (requestedMode === 'prod-secret-manager') {
    return checkProdSecretManager(env);
  }
  const mode = requestedMode === 'test' ? 'test' : 'prod';
  const errors = [];
  const warnings = [];

  for (const spec of REQUIRED_PROD) {
    const value = env[spec.name];
    const isEmpty = !value || String(value).trim() === '';

    // Conditional requirement: only enforce when predicate returns true.
    // Sprint 39 Fase B.3: e.g. KMS_KEY_RESOURCE_NAME es requerido SOLO
    // si KMS_ADAPTER=cloud-kms.
    const isRequiredHere =
      typeof spec.requiredIf === 'function' ? spec.requiredIf(env) : true;

    if (isEmpty) {
      if (spec.optional || !isRequiredHere) {
        if (spec.optional) {
          warnings.push(`${spec.name} (${spec.purpose}) — feature disabled`);
        }
        continue;
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

    // Shape check (e.g. URLs deben empezar con http(s)://). En test mode
    // se tolera igual que allowedValues: shape check ≠ prod policy.
    if (spec.pattern && !new RegExp(spec.pattern).test(String(value))) {
      if (mode === 'test') {
        warnings.push(
          `${spec.name} = "${String(value).slice(0, 20)}..." — pattern bypass in test mode ` +
            `(prod pattern: ${spec.pattern})`,
        );
        continue;
      }
      errors.push(
        `INVALID FORMAT: ${spec.name} — must match ${spec.pattern}` +
          (spec.example ? ` (e.g. ${spec.example})` : ''),
      );
      continue;
    }

    if (spec.allowedValues && !spec.allowedValues.includes(String(value))) {
      // En test mode toleramos valores fuera de allowedValues: el
      // contrato dice "test mode = shape check, no prod policy". Por
      // ejemplo, `KMS_ADAPTER=in-memory-dev` es ilegal en prod (Sprint
      // 39 B.3) pero es el valor canónico de dev/test. Sin esta
      // tolerancia, el CI smoke fallaría aunque la app corra como debe
      // en dev.
      if (mode === 'test') {
        warnings.push(
          `${spec.name} = "${value}" — allowedValues bypass in test mode ` +
            `(prod allowedValues: ${spec.allowedValues.join(', ')})`,
        );
        continue;
      }
      errors.push(
        `INVALID VALUE: ${spec.name} = "${value}" — allowed: ${spec.allowedValues.join(', ')}`,
      );
      continue;
    }
  }

  return { errors, warnings, checked: REQUIRED_PROD.length, mode };
}

/**
 * Bucket V.5 — Cloud Run runtime mode. We don't expect process.env to
 * contain the actual secret values during validation (those are
 * injected by Cloud Run from Secret Manager at boot). Instead we
 * assert the project plumbing is correct + emit warnings naming each
 * secret the operator should verify in `gcloud secrets list`.
 *
 * @param {NodeJS.ProcessEnv} env
 */
function checkProdSecretManager(env) {
  const errors = [];
  const warnings = [];

  if (!env.GOOGLE_CLOUD_PROJECT || String(env.GOOGLE_CLOUD_PROJECT).trim() === '') {
    errors.push(
      'MISSING: GOOGLE_CLOUD_PROJECT — required so secret-manager and ' +
        'cloud-run targets can be resolved without ambiguity.',
    );
  }

  for (const name of SECRET_MANAGER_SECRETS) {
    warnings.push(
      `${name} — expected in Secret Manager. Verify with: ` +
        `gcloud secrets describe ${name} --project="$GOOGLE_CLOUD_PROJECT"`,
    );
  }

  return {
    errors,
    warnings,
    checked: SECRET_MANAGER_SECRETS.length,
    mode: 'prod-secret-manager',
  };
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

module.exports = {
  validate,
  check,
  checkProdSecretManager,
  REQUIRED_PROD,
  PLACEHOLDER_REGEX,
  SECRET_MANAGER_SECRETS,
};
