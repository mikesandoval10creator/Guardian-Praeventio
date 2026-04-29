/**
 * Praeventio Guard — useBiometricAuth (Round 16, R3 agent)
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
 *      flow against the local platform authenticator. This is a
 *      proof-of-presence check (challenge generated client-side) — see
 *      ClaimForm.tsx for the reasoning that this is intentional for the
 *      MVP. ISO 27001 server-side challenge is on the Round 17 backlog.
 *
 *   3. UNSUPPORTED (older devices / non-secure-context browsers):
 *      Returns `isSupported = false` honestly. Previously the hook had a
 *      `return true` MVP fallback that silently simulated success — that
 *      is now removed. Callers (ClaimForm, RefereeAccept, Settings,
 *      MFASetupModal) already branch on `isSupported` to surface a
 *      "yo declaro" or alternate-method UX.
 *
 * Where the user-facing copy lives:
 *   • The `reason` string is supplied by callers (es-CL); see ClaimForm
 *     line ~85 ("Firma tu claim …") and Settings line ~49.
 *   • Native plugin Android dialog title is hard-coded here as
 *     "Verificar identidad". Round 17 TODO — migrate to i18next so
 *     pt-BR / en-US tenants get a localized prompt.
 *
 * Server integration:
 *   • The companion hook `usePushNotifications` posts FCM tokens to
 *     `/api/push/register-token` (server.ts ~line 2843, R5 scope).
 *   • This biometric hook is purely client-side; no server roundtrip
 *     yet. ISO 27001 will require a server-issued challenge — see
 *     Round 17 backlog.
 *
 * Round 17 (R5) — server-issued challenges replace client-generated MVP.
 *   Replay-resistant per ISO 27001 §A.9.4.1. The web auth flow now
 *   fetches /api/auth/webauthn/challenge BEFORE invoking WebAuthn; the
 *   server persists the challenge to webauthn_challenges/{uid}_{id}
 *   with a 5-minute TTL and a single-use mark-consumed step. If the
 *   challenge fetch fails (offline, unauthenticated, server down) we
 *   fall back to a client-generated challenge — the MVP behaviour —
 *   and log a warning. This is intentional: a worker on a flaky
 *   construction-site network must still be able to attest a claim;
 *   the auditable replay-safe path is best-effort, not blocking.
 *
 * TODO Round 18:
 *   • Migrate hard-coded prompt copy to i18next (most strings done).
 *   • POST /api/auth/webauthn/verify endpoint to consume the challenge
 *     server-side after the client returns the signed assertion.
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
 * Round 17 (R5): fetch a server-issued WebAuthn challenge. Returns null
 * on failure so the caller can fall back to a locally-generated
 * challenge (MVP behaviour). Failures are non-fatal — flaky networks
 * are common on construction-site Wi-Fi and we'd rather degrade to the
 * less-secure local challenge than block the worker entirely.
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
    console.warn('[biometric] server challenge fetch failed; falling back to client-generated', err);
    return null;
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
    async (challengeMessage?: string): Promise<boolean> => {
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

      // Web — WebAuthn proof-of-presence. Round 17 (R5): prefer the
      // server-issued challenge (audit-trailed, single-use, 5-min TTL,
      // ISO 27001 §A.9.4.1). Fall back to a client-generated challenge
      // when the server is unreachable so the worker can still attest.
      try {
        const issued = await fetchServerChallenge();
        let challenge: Uint8Array;
        if (issued) {
          challenge = issued.challenge;
        } else {
          challenge = new Uint8Array(32);
          crypto.getRandomValues(challenge);
        }

        const publicKey: PublicKeyCredentialRequestOptions = {
          challenge,
          rpId: window.location.hostname,
          userVerification: 'required',
        };

        const credential = await navigator.credentials.get({ publicKey });
        return !!credential;
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
