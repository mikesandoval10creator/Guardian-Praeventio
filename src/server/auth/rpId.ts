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
