// Praeventio Guard — WebAuthn Relying Party ID resolver (single source).
//
// Background (P0 prod bug, 2026-06): four signing routes resolved the
// WebAuthn RP ID with `process.env.WEBAUTHN_RP_ID ?? 'localhost'`, and the
// Cloud Run deploy never set `WEBAUTHN_RP_ID`. The result: in production the
// authenticator's assertion was verified against rpId `localhost` while the
// browser produced its assertion bound to `app.praeventio.net`, so EVERY
// signature failed (a hard breakage of passkey signing for SUSESO / DTE /
// DS-67 / DS-76 / curriculum). sitebookSignRoutes.ts already read the env,
// but the other routes silently fell back.
//
// Contract:
//   - env set  → return it verbatim (the deployed RP ID, e.g.
//     `app.praeventio.net`).
//   - env unset + NODE_ENV === 'production' → THROW (fail-loud). A misconfig
//     must surface in the deploy log / first request rather than silently
//     verifying every signature against `localhost` and rejecting valid
//     passkeys. This mirrors the adjacent boot-time `expectedOrigin` guard in
//     curriculum.ts that `process.exit(1)`s on an http:// origin in prod.
//   - env unset + dev / test → fall back to `localhost` (the WebAuthn dev
//     RP ID; matches the @simplewebauthn convention and existing tests).
//
// NOTE: this resolves only the RP ID (a bare host, e.g. `app.praeventio.net`),
// NOT the expected origin (the full https:// URL). The crypto verification
// itself (verifyAuthenticationResponse) is untouched.

/**
 * Resolve the WebAuthn Relying Party ID from the environment.
 *
 * @throws Error when `WEBAUTHN_RP_ID` is unset (or empty) while
 *   `NODE_ENV === 'production'` — fail-loud rather than silently using
 *   `localhost`, which would reject every valid passkey signature in prod.
 */
export function getWebauthnRpId(): string {
  const value = process.env.WEBAUTHN_RP_ID;
  if (value && value.length > 0) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[webauthn] WEBAUTHN_RP_ID is required in production. Set it (e.g. ' +
        'app.praeventio.net) in the Cloud Run env so passkey signatures ' +
        'verify against the real RP ID instead of localhost.',
    );
  }
  return 'localhost';
}

/**
 * Resolve the expected WebAuthn ceremony ORIGIN (full https:// URL) from the
 * environment, fail-LOUD in production. The sibling of `getWebauthnRpId`, but
 * for origin binding. Routes had used `process.env.APP_BASE_URL ?? 'http://
 * localhost:5173'` inline — fine for signing (a wrong-origin signature is
 * voidable) but UNSAFE for the irreversible account-anonymize endpoint, where a
 * localhost-bound assertion passing in a misconfigured prod deploy = permanent
 * data loss. Mirrors the boot guard in curriculum.ts.
 *
 * @throws Error in production when APP_BASE_URL/APP_URL is unset or http://.
 */
export function getWebauthnExpectedOrigin(): string {
  const origin = process.env.APP_BASE_URL ?? process.env.APP_URL;
  if (process.env.NODE_ENV === 'production') {
    if (!origin || origin.length === 0) {
      throw new Error(
        '[webauthn] APP_BASE_URL/APP_URL is required in production for WebAuthn ' +
          'origin binding. Set it (e.g. https://app.praeventio.net) in the Cloud Run env.',
      );
    }
    if (origin.startsWith('http://')) {
      throw new Error(
        '[webauthn] expectedOrigin must be https:// in production — refusing an http:// origin.',
      );
    }
    return origin;
  }
  return origin ?? 'http://localhost:5173';
}
