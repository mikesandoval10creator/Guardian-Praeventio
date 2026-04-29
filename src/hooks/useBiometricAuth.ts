/**
 * Praeventio Guard — useBiometricAuth (Round 18, R6 agent)
 * ─────────────────────────────────────────────────────────────────────
 * 3-tier strategy for biometric / proof-of-presence authentication:
 *
 *   1. NATIVE (iOS / Android via Capacitor):
 *      Uses the `@aparajita/capacitor-biometric-auth` plugin — TouchID /
 *      FaceID on iOS, fingerprint / face on Android. The plugin throws
 *      a `BiometryError` on failure (cancel, lockout, not-enrolled, …),
 *      which we map to `false` so callers keep their boolean ergonomics.
 *
 *   2. WEB (modern browsers):
 *      Falls back to the WebAuthn `navigator.credentials.get/create`
 *      flow against the local platform authenticator.
 *
 *   3. UNSUPPORTED (older devices / non-secure-context browsers):
 *      Returns `isSupported = false` honestly.
 *
 * Where the user-facing copy lives:
 *   • The `reason` string is supplied by callers (es-CL).
 *   • Native plugin prompt copy now goes through i18next (`biometric.*`).
 *
 * ─────────────────────────────────────────────────────────────────────
 * THREAT MODEL — Round 18 R6 (closes Round 17 MEDIUM #1)
 * ─────────────────────────────────────────────────────────────────────
 * Round 17 R5 shipped the server challenge cache + GET /webauthn/challenge.
 * The MVP fallback was: if the server is unreachable, use a client-
 * generated challenge. That left a downgrade vector — an attacker who
 * could induce a server-unreachable state (DNS poisoning, captive portal,
 * adversarial proxy) could force the client into the unsafe path and then
 * replay a captured assertion indefinitely.
 *
 * Round 18 R6 closes the gap with an explicit `purpose` parameter:
 *
 *   • `purpose: 'login'` and `purpose: 'claim-signing'` are SENSITIVE
 *     flows. They MUST use a server-issued challenge AND verify the
 *     resulting assertion against POST /api/auth/webauthn/verify.
 *     If the challenge fetch fails OR the verify endpoint rejects the
 *     assertion, the hook returns `false` IMMEDIATELY. There is no
 *     client-generated fallback. This closes the downgrade vector.
 *
 *   • `purpose: 'enroll-test'` is a low-stakes "check your biometric
 *     works" flow on the Settings page. It keeps the MVP behavior
 *     (best-effort server challenge with client-generated fallback)
 *     because failing the check on a flaky network would otherwise
 *     gaslight the worker into thinking their fingerprint stopped
 *     working. The audit trail still records the ceremony.
 *
 *   • Default (no `purpose` argument) is treated as `'login'` —
 *     fail-closed by default so any legacy caller that has not been
 *     audited yet inherits the safe behavior.
 *
 * After WebAuthn assertion succeeds locally (web path), sensitive
 * flows POST to /api/auth/webauthn/verify with the assertion. The
 * server consumes the challenge atomically (single-use, TTL-bounded).
 * Any 401 from /verify maps to `false`.
 *
 * TODO Round 19:
 *   • Integrate @simplewebauthn/server CBOR + signature check on the
 *     server side (so `auth.webauthn.verified` audit rows attest
 *     cryptographically, not just challenge-consume).
 *   • Surface BiometryErrorType.biometryLockout to the caller so the UI
 *     can show "intenta nuevamente en X minutos" instead of generic fail.
 */

import { useState, useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
// Round 17 (R4): replace hard-coded Spanish prompts with i18next.
// Hook is non-component, so we import the i18n singleton directly
// instead of using `useTranslation`. Keys live under `biometric`.
import i18n from '../i18n';
import { auth } from '../services/firebase';

type Platform = 'web' | 'ios' | 'android';

/**
 * Round 18 R6 — sensitivity classification for the biometric ceremony.
 *
 *   • 'login'         — sensitive. Fail-closed if server unreachable.
 *   • 'claim-signing' — sensitive. Fail-closed (curriculum cosign).
 *   • 'enroll-test'   — low-stakes. Best-effort (kept for the Settings
 *                       "verify your biometric works" UX so a flaky
 *                       construction-site network doesn't fake-fail
 *                       the worker's fingerprint check).
 *
 * The default (no argument) is 'login' — fail-closed by default so
 * legacy callers inherit the safe behavior.
 */
export type BiometricPurpose = 'login' | 'claim-signing' | 'enroll-test';

function isSensitivePurpose(p: BiometricPurpose): boolean {
  return p === 'login' || p === 'claim-signing';
}

function detectPlatform(): Platform {
  try {
    const p = Capacitor.getPlatform();
    if (p === 'ios' || p === 'android') return p;
  } catch {
    // Capacitor not available — treat as web.
  }
  return 'web';
}

function detectWebAuthnSupport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials
  );
}

/**
 * Round 17 (R5) + Round 18 (R6): fetch a server-issued WebAuthn challenge.
 *
 * Returns null on ANY failure (no auth user, network error, non-2xx,
 * malformed response). Callers MUST decide what to do with null based on
 * the sensitivity of the flow:
 *
 *   • Sensitive flows (login, claim-signing) — return null = abort the
 *     ceremony. DO NOT fall back to a client-generated challenge; that
 *     reopens the downgrade attack vector R6 R17 flagged.
 *   • Low-stakes flows (enroll-test) — null is acceptable and the caller
 *     may fall back to a client-generated challenge so a flaky network
 *     doesn't block the worker's fingerprint-check UX.
 */
async function fetchServerChallenge(): Promise<{ challengeId: string; challenge: Uint8Array } | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    const idToken = await user.getIdToken();
    const res = await fetch('/api/auth/webauthn/challenge', {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.challengeId || typeof data.challenge !== 'string') return null;
    // Server returns base64; decode back into the bytes WebAuthn needs.
    const bin = atob(data.challenge);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { challengeId: String(data.challengeId), challenge: bytes };
  } catch (err) {
    console.warn('[biometric] server challenge fetch failed', err);
    return null;
  }
}

/**
 * Round 18 (R6): round-trip the WebAuthn assertion through the server-
 * side /verify endpoint, which atomically consumes the challenge so a
 * captured assertion cannot be replayed. Returns true if the server
 * confirms the verification, false on any failure (no user, network
 * error, non-2xx, malformed response).
 *
 * The body shape mirrors the production handler in
 * src/server/routes/curriculum.ts (POST /api/auth/webauthn/verify).
 */
async function verifyAssertionWithServer(
  challengeId: string,
  assertion: PublicKeyCredential,
): Promise<boolean> {
  try {
    const user = auth.currentUser;
    if (!user) return false;
    const idToken = await user.getIdToken();
    const response = assertion.response as AuthenticatorAssertionResponse;
    const toB64 = (buf: ArrayBuffer): string => {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    };
    const res = await fetch('/api/auth/webauthn/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        challengeId,
        clientDataJSON: toB64(response.clientDataJSON),
        authenticatorData: toB64(response.authenticatorData),
        signature: toB64(response.signature),
      }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.verified === true;
  } catch (err) {
    console.warn('[biometric] /verify roundtrip failed', err);
    return false;
  }
}

export const useBiometricAuth = () => {
  const platform = detectPlatform();
  const isNative = platform === 'ios' || platform === 'android';

  // Web: synchronous capability check. Native: optimistic until checkBiometry runs.
  const [isSupported, setIsSupported] = useState<boolean>(
    isNative ? true : detectWebAuthnSupport(),
  );

  // On native, ask the plugin whether biometry is actually available
  // (hardware present + user enrolled + device secured).
  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    BiometricAuth.checkBiometry()
      .then((res) => {
        if (cancelled) return;
        setIsSupported(!!res?.isAvailable);
      })
      .catch(() => {
        if (cancelled) return;
        setIsSupported(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isNative]);

  const authenticate = useCallback(
    async (
      challengeMessage?: string,
      purpose: BiometricPurpose = 'login',
    ): Promise<boolean> => {
      const reason = challengeMessage || i18n.t('biometric.reason_login');
      if (!isSupported) {
        // Honest "unsupported_device" — no silent simulation anymore.
        console.warn('[biometric]', i18n.t('biometric.unsupported'));
        return false;
      }

      if (isNative) {
        try {
          await BiometricAuth.authenticate({
            reason,
            allowDeviceCredential: true,
            androidTitle: i18n.t('biometric.verify_identity'),
            androidSubtitle: reason,
            cancelTitle: i18n.t('biometric.cancel'),
          });
          return true;
        } catch (error: any) {
          // Plugin throws BiometryError on cancel / lockout / failure.
          console.warn('[biometric] Native auth rechazada:', error?.code ?? error?.message);
          return false;
        }
      }

      // Web — WebAuthn proof-of-presence. Round 18 (R6): the
      // server-issued challenge is MANDATORY for sensitive flows
      // ('login', 'claim-signing'). On unreachable server we fail-closed
      // and return false IMMEDIATELY; falling back to a client-generated
      // challenge would reopen the downgrade attack vector. Low-stakes
      // 'enroll-test' keeps the MVP best-effort fallback.
      const sensitive = isSensitivePurpose(purpose);
      try {
        const issued = await fetchServerChallenge();
        let challenge: Uint8Array;
        let serverIssuedId: string | null = null;
        if (issued) {
          challenge = issued.challenge;
          serverIssuedId = issued.challengeId;
        } else if (!sensitive) {
          challenge = new Uint8Array(32);
          crypto.getRandomValues(challenge);
        } else {
          // Sensitive + no server challenge → fail-closed.
          console.warn(
            '[biometric] sensitive flow aborted: server challenge unreachable (purpose=%s)',
            purpose,
          );
          return false;
        }

        const publicKey: PublicKeyCredentialRequestOptions = {
          challenge,
          rpId: window.location.hostname,
          userVerification: 'required',
        };

        const credential = await navigator.credentials.get({ publicKey });
        if (!credential) return false;

        // Sensitive flows MUST round-trip the assertion through /verify
        // so the server can atomically consume the challenge. A 401
        // there means replay / expiry / mismatch — fail-closed.
        if (sensitive && serverIssuedId) {
          const verified = await verifyAssertionWithServer(
            serverIssuedId,
            credential as PublicKeyCredential,
          );
          if (!verified) {
            console.warn('[biometric] /verify rejected — fail-closed');
            return false;
          }
        }
        return true;
      } catch (error) {
        console.error('Error en autenticación biométrica:', error);
        return false;
      }
    },
    [isSupported, isNative],
  );

  const register = useCallback(
    async (username: string): Promise<boolean> => {
      if (!isSupported) return false;

      if (isNative) {
        // The native plugin enrolls at the OS level; from the app's POV
        // "register" just verifies the user can authenticate right now.
        try {
          await BiometricAuth.authenticate({
            reason: i18n.t('biometric.reason_enroll', { username }),
            allowDeviceCredential: true,
            androidTitle: i18n.t('biometric.enroll_title'),
            cancelTitle: i18n.t('biometric.cancel'),
          });
          return true;
        } catch (error: any) {
          console.warn('[biometric] Native enroll rechazado:', error?.code ?? error?.message);
          return false;
        }
      }

      try {
        // Round 17 (R5): prefer server-issued challenge for the
        // registration ceremony too. Same fallback rationale as
        // authenticate(): better to enroll on a flaky link than block.
        const issued = await fetchServerChallenge();
        let challenge: Uint8Array;
        if (issued) {
          challenge = issued.challenge;
        } else {
          challenge = new Uint8Array(32);
          crypto.getRandomValues(challenge);
        }
        const userId = new Uint8Array(16);
        crypto.getRandomValues(userId);

        const publicKey: PublicKeyCredentialCreationOptions = {
          challenge,
          rp: {
            name: 'Praeventio Guard',
            id: window.location.hostname,
          },
          user: {
            id: userId,
            name: username,
            displayName: username,
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },
            { alg: -257, type: 'public-key' },
          ],
          authenticatorSelection: {
            userVerification: 'required',
            residentKey: 'required',
            requireResidentKey: true,
          },
          timeout: 60000,
          attestation: 'none',
        };

        const credential = await navigator.credentials.create({ publicKey });
        return !!credential;
      } catch (error) {
        console.error('Error en registro biométrico:', error);
        return false;
      }
    },
    [isSupported, isNative],
  );

  return { isSupported, authenticate, register, platform };
};
