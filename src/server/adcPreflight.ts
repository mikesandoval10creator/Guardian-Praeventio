// SPDX-License-Identifier: MIT
//
// adcPreflight — boot-time guard for Google Application Default Credentials.
//
// Ticket 409aa66d-... (discovered by the PR #1883 image probes): without any
// ADC the server boots fine ("Server running on http://localhost:3000") and
// then dies with an unhandled rejection (google-auth NO_ADC_FOUND) thrown by
// the background subscriptions (role_claims_sync / assigned_sites_sync /
// distributedLease). With an ADC present — even one without real IAM
// authorization, as in the CI probes' synthetic service account — the process
// survives and serves the full contract. That makes ADC a runtime requirement,
// not an optional enhancer.
//
// This preflight mirrors kmsPreflight.ts / webpayPreflight.ts: at boot, if
// NODE_ENV=production and no resolvable ADC exists, the process exits 1 with a
// FATAL log instead of crashing later from a background listener. It does NOT
// suppress unhandledRejection globally (that would mask unrelated bugs) and it
// does NOT fetch tokens — presence and shape only, so a credential that parses
// but lacks IAM authorization (production's normal boot state before the first
// authorized call) still passes.
//
// Resolvable ADC means either:
//   - GOOGLE_APPLICATION_CREDENTIALS points at a readable, well-formed
//     credential file (service_account, external_account, authorized_user or
//     impersonated_service_account), or
//   - the process runs inside a GCP-managed runtime that provides ambient
//     credentials through the metadata server (Cloud Run K_SERVICE, App Engine
//     GAE_ENV, Cloud Functions FUNCTION_TARGET) — Workload Identity needs no
//     env var and must keep working.
//
// Discovery 2026-10-29 (run 40971562065, api-server.log).

import { existsSync, readFileSync } from "node:fs";

export interface AdcBootConfigResult {
  ok: boolean;
  mode: 'production' | 'non-production';
  errors: string[];
  warnings: string[];
}
type AdcBootEnv = {
  NODE_ENV?: string;
  GOOGLE_APPLICATION_CREDENTIALS?: string;
  K_SERVICE?: string;
  GAE_ENV?: string;
  FUNCTION_TARGET?: string;
};

/** Injectable file IO so the guard stays a pure function under test. */
export type AdcBootFileIO = {
  existsSync(path: string): boolean;
  readFileSync(path: string): string;
};

const CRED_TYPES_REQUIRING_EMAIL_AND_KEY = new Set(['service_account']);
const CRED_TYPES_REQUIRING_CREDENTIAL_SOURCE = new Set(['external_account']);
const KNOWN_CRED_TYPES = new Set([
  'service_account',
  'external_account',
  'authorized_user',
  'impersonated_service_account',
]);

function defaultFileIO(): AdcBootFileIO {
  // Static ESM import (node:fs) — a lazy `require` is not available under the
  // tsx/ESM loader the server and the full-stack harness boot with. The
  // readFileSync wrapper pins the overload to the `(path) => string` shape
  // this module uses (raw JSON text).
  return {
    existsSync: (path: string) => existsSync(path),
    readFileSync: (path: string) => readFileSync(path, 'utf8'),
  };
}

function validateCredentialFile(path: string, fileIO: AdcBootFileIO): string[] {
  const errors: string[] = [];
  if (!fileIO.existsSync(path)) {
    errors.push(
      `GOOGLE_APPLICATION_CREDENTIALS points at "${path}" but the file does not exist — ADC cannot be resolved and the server would crash later with NO_ADC_FOUND from background listeners`,
    );
    return errors;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileIO.readFileSync(path));
  } catch {
    errors.push(
      `GOOGLE_APPLICATION_CREDENTIALS file "${path}" is not valid JSON — ADC cannot be resolved`,
    );
    return errors;
  }
  const cred = parsed as { type?: unknown; client_email?: unknown; private_key?: unknown; credential_source?: unknown };
  const type = typeof cred.type === 'string' ? cred.type : '';
  if (!KNOWN_CRED_TYPES.has(type)) {
    errors.push(
      `GOOGLE_APPLICATION_CREDENTIALS file "${path}" has unrecognized "type" "${type}" (expected one of: ${[...KNOWN_CRED_TYPES].join(', ')})`,
    );
    return errors;
  }
  if (CRED_TYPES_REQUIRING_EMAIL_AND_KEY.has(type)) {
    if (!cred.client_email || !cred.private_key) {
      errors.push(
        `GOOGLE_APPLICATION_CREDENTIALS file "${path}" is a ${type} without client_email/private_key — ADC cannot be resolved`,
      );
    }
  }
  if (CRED_TYPES_REQUIRING_CREDENTIAL_SOURCE.has(type)) {
    if (!cred.credential_source) {
      errors.push(
        `GOOGLE_APPLICATION_CREDENTIALS file "${path}" is an ${type} without credential_source — ADC cannot be resolved`,
      );
    }
  }
  return errors;
}

export function validateAdcBootConfig(
  env: AdcBootEnv,
  fileIO: AdcBootFileIO = defaultFileIO(),
): AdcBootConfigResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isProduction = env.NODE_ENV === 'production';
  const credPath = env.GOOGLE_APPLICATION_CREDENTIALS;
  const ambientGcpRuntime = Boolean(env.K_SERVICE || env.GAE_ENV || env.FUNCTION_TARGET);

  if (credPath) {
    const fileErrors = validateCredentialFile(credPath, fileIO);
    if (isProduction) {
      errors.push(...fileErrors);
    } else if (fileErrors.length > 0) {
      warnings.push(
        `non-production: ${fileErrors.join('; ')} (not fatal outside production)`,
      );
    }
  } else if (isProduction && !ambientGcpRuntime) {
    errors.push(
      'GOOGLE_APPLICATION_CREDENTIALS is not set and this is not a GCP-managed runtime (no K_SERVICE/GAE_ENV/FUNCTION_TARGET) — no resolvable ADC. The server would boot and then crash with NO_ADC_FOUND from background listeners. Provide a service-account key file or run on Cloud Run/App Engine/Cloud Functions with Workload Identity.',
    );
  }

  return {
    ok: errors.length === 0,
    mode: isProduction ? 'production' : 'non-production',
    errors,
    warnings,
  };
}
