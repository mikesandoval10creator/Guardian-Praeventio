// Praeventio Guard — usePushNotifications (Round 16, R3 agent)
// ─────────────────────────────────────────────────────────────────────
// Wires the device-level push token (FCM web / APNs+FCM native) up to
// the server endpoint POST /api/push/register-token. The server stores
// the token under the calling user's UID (verified via Bearer ID token)
// and uses it later to fan-out incident alerts to supervisors.
//
// We extract the registration-to-server logic into the pure helper
// `registerTokenToServer` so it is unit-testable without jsdom or
// Capacitor mocks. The hook itself stays a thin React wrapper.

import { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import { getMessagingInstance, getToken, onMessage } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../services/firebase';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

export interface RegisterTokenDeps {
  /** Resolves the Firebase ID token for the current user, or null if unauth. */
  getIdToken: () => Promise<string | null>;
  /** Injectable fetch (real fetch in prod, mock in tests). */
  fetchImpl: typeof fetch;
}

export interface RegisterTokenResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * POST {token, platform} to /api/push/register-token with the user's ID token.
 *
 * - If there's no authenticated user, returns { ok: false, error: 'no_auth' }
 *   without making a network call. Push registration is best-effort, so we
 *   never throw — callers log a warning at most.
 * - On non-2xx response, returns { ok: false, status, error }.
 * - On network exception, returns { ok: false, error: <message> }.
 */
export async function registerTokenToServer(
  token: string,
  platform: string,
  deps: RegisterTokenDeps,
): Promise<RegisterTokenResult> {
  if (!token) return { ok: false, error: 'empty_token' };

  let idToken: string | null = null;
  try {
    idToken = await deps.getIdToken();
  } catch {
    return { ok: false, error: 'id_token_failed' };
  }
  if (!idToken) return { ok: false, error: 'no_auth' };

  try {
    // §2.20 (2026-05-23) — el `idToken` viene de `deps.getIdToken()`
    // (DI pattern). Para soportar el flow E2E donde el header completo
    // (`E2E <secret>:<uid>`) reemplaza al Bearer, detectamos shape:
    const authValue =
      idToken.startsWith('E2E ') || idToken.startsWith('Bearer ')
        ? idToken
        : `Bearer ${idToken}`;
    const res = await deps.fetchImpl('/api/push/register-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authValue,
      },
      body: JSON.stringify({ token, platform }),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `http_${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'network_error' };
  }
}

export function usePushNotifications() {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [notificationPermissionStatus, setNotificationPermissionStatus] = useState<
    NotificationPermission | 'granted' | 'denied' | 'prompt'
  >('default');
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [lastRegisteredAt, setLastRegisteredAt] = useState<number | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  // Helper closure that uses the live Firebase auth + global fetch.
  const reportTokenToServer = async (token: string) => {
    const platform = Capacitor.getPlatform();
    const result = await registerTokenToServer(token, platform, {
      // §2.20 (2026-05-23) — prefiero apiAuthHeader (E2E + Bearer
      // fallback) y devuelvo el header completo. registerTokenToServer
      // ya detecta si vino con prefix o no.
      getIdToken: async () => {
        try {
          const { apiAuthHeader } = await import('../lib/apiAuth');
          return await apiAuthHeader();
        } catch {
          return null;
        }
      },
      fetchImpl: ((input: any, init?: any) => fetch(input, init)) as typeof fetch,
    });
    if (result.ok) {
      setLastRegisteredAt(Date.now());
      setRegistrationError(null);
    } else {
      console.warn('[push] registro de token al servidor falló:', result.error);
      setRegistrationError(result.error ?? 'unknown');
    }
  };

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      PushNotifications.checkPermissions().then((res) => {
        setNotificationPermissionStatus(res.receive as NotificationPermission);
        setHasPermission(res.receive === 'granted');
      });
    } else if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermissionStatus(Notification.permission);
      setHasPermission(Notification.permission === 'granted');
    }
  }, []);

  const requestPermission = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        let permStatus = await PushNotifications.checkPermissions();

        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
          logger.warn('User denied push permission');
          setHasPermission(false);
          return;
        }
        setHasPermission(true);

        await PushNotifications.register();

        PushNotifications.addListener('registration', async (token) => {
          logger.info('Push registration success', { token: token.value });
          setFcmToken(token.value);
          // Fire-and-forget Firestore mirror (kept for backward compat).
          if (auth.currentUser) {
            try {
              await setDoc(
                doc(db, 'users', auth.currentUser.uid),
                { fcmToken: token.value, updatedAt: new Date() },
                { merge: true },
              );
            } catch (err) {
              console.warn('[push] firestore mirror failed:', err);
            }
          }
          // Server-side registration via /api/push/register-token.
          await reportTokenToServer(token.value);
        });

        PushNotifications.addListener('registrationError', (error: any) => {
          logger.error('Push registration error', { error });
          setRegistrationError('native_registration_error');
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          logger.debug('Push notification received', { notification });
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          logger.debug('Push action performed', { notification });
        });
      } else {
        const messaging = await getMessagingInstance();
        if (!messaging) {
          logger.warn('Messaging not supported in this browser');
          return;
        }

        const permission = await Notification.requestPermission();
        setNotificationPermissionStatus(permission);
        setHasPermission(permission === 'granted');

        if (permission === 'granted') {
          const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

          if (!vapidKey) {
            logger.warn('VITE_FIREBASE_VAPID_KEY is not set — push notifications will not work in production');
          }

          const token = await getToken(messaging, {
            vapidKey: vapidKey || undefined,
          });

          if (token) {
            setFcmToken(token);
            logger.info('FCM token acquired');

            if (auth.currentUser) {
              try {
                await setDoc(
                  doc(db, 'users', auth.currentUser.uid),
                  { fcmToken: token, updatedAt: new Date() },
                  { merge: true },
                );
              } catch (err) {
                console.warn('[push] firestore mirror failed:', err);
              }
            }
            await reportTokenToServer(token);
          } else {
            logger.warn('No FCM registration token available');
          }
        } else {
          logger.warn('Push notification permission denied by user');
        }
      }
    } catch (error) {
      logger.error('Error retrieving push token', { error });
    }
  };

  // Alias name requested by Round 16 R3 spec, kept alongside the legacy
  // `requestPermission` so existing callers (Settings, Notifications) don't
  // break.
  const registerForPushNotifications = requestPermission;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const setupMessaging = async () => {
      if (!Capacitor.isNativePlatform()) {
        const messaging = await getMessagingInstance();
        if (!messaging) return;

        unsubscribe = onMessage(messaging, (payload) => {
          logger.debug('FCM message received', { payload });
          if (payload.notification) {
            new Notification(payload.notification.title || 'New Notification', {
              body: payload.notification.body,
              icon: '/vite.svg',
            });
          }
        });
      }
    };

    setupMessaging();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
      if (Capacitor.isNativePlatform()) {
        PushNotifications.removeAllListeners();
      }
    };
  }, []);

  return {
    fcmToken,
    notificationPermissionStatus,
    hasPermission,
    requestPermission,
    registerForPushNotifications,
    lastRegisteredAt,
    registrationError,
  };
}
