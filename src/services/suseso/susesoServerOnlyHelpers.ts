// Praeventio Guard — Sprint 49 D.8.a.
//
// SUSESO server-only helpers. Loaded ONLY from server routes
// (`src/server/routes/suseso.ts`) — never imported from client bundles.
// Vite tree-shaking would still nominally exclude this file from the
// browser build, but the contract is enforced by code review: any
// `import ... from 'services/suseso/susesoServerOnlyHelpers'` that lands
// in a file under `src/components/`, `src/hooks/`, or `src/services/api/`
// is a CI block.
//
// Responsibilities:
//   1. `loadSusesoCredentials()` — read `SUSESO_MUTUALITY_ID` and
//      `SUSESO_EMPLOYER_TOKEN` from `process.env`. Fail-fast on missing
//      values so a misconfigured deploy never silently signs a form
//      with `undefined` credentials.
//   2. `verifyEmployerSignature(token, payload)` — verify the HMAC-SHA256
//      of a canonical payload against the employer's pre-issued token.
//      Used by `/api/suseso/diat/render` + `/diep/render` to confirm
//      the admin user actually holds the company-issued signing token
//      (cross-checks "you are admin in Firebase" with "you hold the
//      employer key" — a two-factor binding for the legal liability
//      transfer from the platform to the empresa).
//
// Plan maestro directive 3: NO push automático a SUSESO API.
// `loadSusesoCredentials` returns identifiers used to STAMP the rendered
// PDF (mutualidad logo, employer token used to sign), not to authenticate
// against any SUSESO endpoint — there is no such endpoint to call.

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Credential bundle loaded from server-only environment variables.
 *
 * `mutualityId` is the public identifier (achs|mutual_seguridad|ist|isl)
 * that gets STAMPED on the PDF header — it tells the form-reader which
 * mutualidad the empresa is affiliated with. It is not a secret, but
 * lives in env vars so a multi-tenant deploy can override per-tenant
 * without code changes.
 *
 * `employerToken` is the HMAC key used to sign the per-form payload at
 * render time. The empresa configures it once (during onboarding) and
 * it never leaves the server. Rotation: change the env var + redeploy;
 * previously-signed forms remain verifiable because the signature is
 * embedded in the form record, not recomputed at verify time.
 */
export interface SusesoCredentials {
  mutualityId: string;
  employerToken: string;
}

/**
 * Load SUSESO credentials from env. Throws synchronously on missing
 * values — boot-time failure is preferred over runtime surprise.
 *
 * The two env vars MUST be set in production:
 *   - `SUSESO_MUTUALITY_ID` — one of achs|mutual_seguridad|ist|isl
 *   - `SUSESO_EMPLOYER_TOKEN` — opaque high-entropy string (≥32 chars)
 *
 * Test fixtures: tests may inject a custom `env` map to avoid mutating
 * `process.env` between specs.
 */
export function loadSusesoCredentials(
  env: NodeJS.ProcessEnv = process.env,
): SusesoCredentials {
  const mutualityId = env.SUSESO_MUTUALITY_ID;
  const employerToken = env.SUSESO_EMPLOYER_TOKEN;

  if (!mutualityId || typeof mutualityId !== 'string') {
    throw new Error(
      'SUSESO credentials missing: SUSESO_MUTUALITY_ID is not set. ' +
        'Configure the env var before booting the server.',
    );
  }
  const allowed = new Set(['achs', 'mutual_seguridad', 'ist', 'isl']);
  if (!allowed.has(mutualityId)) {
    throw new Error(
      `SUSESO credentials invalid: SUSESO_MUTUALITY_ID="${mutualityId}" is not a recognized mutualidad. ` +
        `Allowed: ${Array.from(allowed).join(', ')}.`,
    );
  }
  if (!employerToken || typeof employerToken !== 'string') {
    throw new Error(
      'SUSESO credentials missing: SUSESO_EMPLOYER_TOKEN is not set. ' +
        'Configure the env var before booting the server.',
    );
  }
  if (employerToken.length < 32) {
    throw new Error(
      'SUSESO credentials weak: SUSESO_EMPLOYER_TOKEN must be at least 32 chars. ' +
        'Generate one with `openssl rand -hex 32`.',
    );
  }
  return { mutualityId, employerToken };
}

/**
 * Canonical-serialize a payload object for HMAC. We sort keys
 * alphabetically and JSON.stringify so a re-ordered client body
 * produces the SAME signature input — otherwise a trivial key reorder
 * would forge a mismatch.
 */
export function canonicalize(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys) ordered[k] = payload[k];
  return JSON.stringify(ordered);
}

/**
 * Verify the HMAC-SHA256 of a payload against a hex-encoded signature
 * token. Returns `true` only on exact match (constant-time compare).
 *
 * The empresa pre-computes `hmac(employerToken, canonicalize(payload))`
 * client-side using a Cloud Function or a one-time admin UI, and the
 * admin includes the resulting hex token in the render request. The
 * server recomputes and compares — if the admin doesn't hold the
 * employer-issued token, the request is rejected even with a valid
 * Firebase admin role.
 *
 * Rationale: prevents an attacker who somehow obtains an admin Firebase
 * session (e.g. via XSS, although our CSP blocks inline scripts) from
 * generating fraudulent SUSESO forms. The HMAC adds a second factor:
 * "you must also know the empresa's signing secret".
 */
export function verifyEmployerSignature(
  token: string,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!token || typeof token !== 'string') return false;
  if (!/^[0-9a-f]{64}$/i.test(token)) return false;
  let creds: SusesoCredentials;
  try {
    creds = loadSusesoCredentials(env);
  } catch {
    return false;
  }
  const expectedHex = createHmac('sha256', creds.employerToken)
    .update(canonicalize(payload))
    .digest('hex');
  // Constant-time compare to avoid token-byte-leak via timing.
  const a = Buffer.from(token.toLowerCase(), 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
