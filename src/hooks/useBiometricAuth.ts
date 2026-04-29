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
 * TODO Round 17:
 *   • Migrate hard-coded prompt copy to i18next.
 *   • Wire WebAuthn to a server-issued challenge (auditable, replay-safe).
 *   • Surface BiometryErrorType.biometryLockout to the caller so the UI
 *     can show "intenta nuevamente en X minutos" instead of generic fail.
 */

import { useState, useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';

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
    async (challengeMessage: string = 'Autenticación requerida'): Promise<boolean> => {
      if (!isSupported) {
        // Honest "unsupported_device" — no silent simulation anymore.
        console.warn('[biometric] Dispositivo sin biometría disponible.');
        return false;
      }

      if (isNative) {
        try {
          await BiometricAuth.authenticate({
            reason: challengeMessage,
            allowDeviceCredential: true,
            androidTitle: 'Verificar identidad',
            androidSubtitle: challengeMessage,
            cancelTitle: 'Cancelar',
          });
          return true;
        } catch (error: any) {
          // Plugin throws BiometryError on cancel / lockout / failure.
          console.warn('[biometric] Native auth rechazada:', error?.code ?? error?.message);
          return false;
        }
      }

      // Web — WebAuthn local proof-of-presence.
      try {
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);

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
            reason: `Activar autenticación biométrica para ${username}`,
            allowDeviceCredential: true,
            androidTitle: 'Activar biometría',
            cancelTitle: 'Cancelar',
          });
          return true;
        } catch (error: any) {
          console.warn('[biometric] Native enroll rechazado:', error?.code ?? error?.message);
          return false;
        }
      }

      try {
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);
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
