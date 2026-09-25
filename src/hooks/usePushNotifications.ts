// Praeventio Guard — usePushNotifications
//
// The hook exposes the push state/API used by RootLayout, Notifications and
// Settings. Device/web listeners are owned by one module-level runtime so
// multiple consumers cannot duplicate delivery or remove each other's listeners.

import { useEffect, useState } from 'react';
import { logger } from '../utils/logger';
import { getMessagingInstance, getToken, onMessage } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../services/firebase';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { dispatchNotificationDeepLink } from '../services/notifications/notificationDeepLinkDispatch';
import { showForegroundPushNotification } from '../services/notifications/foregroundNotification';
import {
  ensureEmergencyChannel,
  getCriticalAlertStatus,
  criticalAlertsBlocked as isCriticalAlertsBlocked,
} from '../services/notifications/criticalNotificationChannel';

const criticalChannelDeps = {
  createChannel: (channel: Parameters<typeof PushNotifications.createChannel>[0]) =>
    PushNotifications.createChannel(channel),
  listChannels: () => PushNotifications.listChannels(),
  checkPermissions: () => PushNotifications.checkPermissions(),
};

export { dispatchNotificationDeepLink };

export interface RegisterTokenDeps {
  getIdToken: () => Promise<string | null>;
  fetchImpl: typeof fetch;
}

export interface RegisterTokenResult {
  ok: boolean;
  status?: number;
  error?: string;
}

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
    if (!res.ok) return { ok: false, status: res.status, error: `http_${res.status}` };
    return { ok: true, status: res.status };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'network_error' };
  }
}

type PushPermission = 'default' | 'granted' | 'denied' | 'prompt';

export interface PushRuntimeSnapshot {
  fcmToken: string | null;
  notificationPermissionStatus: PushPermission;
  hasPermission: boolean;
  lastRegisteredAt: number | null;
  registrationError: string | null;
  criticalAlertsBlocked: boolean;
}

interface ListenerHandle {
  remove: () => Promise<void> | void;
}

type PushSubscriber = (snapshot: PushRuntimeSnapshot) => void;

const initialPushSnapshot: PushRuntimeSnapshot = {
  fcmToken: null,
  notificationPermissionStatus: 'default',
  hasPermission: false,
  lastRegisteredAt: null,
  registrationError: null,
  criticalAlertsBlocked: false,
};

let pushSnapshot: PushRuntimeSnapshot = { ...initialPushSnapshot };
const pushSubscribers = new Set<PushSubscriber>();
let runtimeStarted = false;
let runtimeStartPromise: Promise<void> | null = null;
let runtimeGeneration = 0;
let webForegroundUnsubscribe: (() => void) | null = null;
let webMessaging: Exclude<Awaited<ReturnType<typeof getMessagingInstance>>, null> | null = null;
let nativeHandles: ListenerHandle[] = [];
let nativeRegistrationHandles: ListenerHandle[] = [];
let nativeRegistrationPromise: Promise<void> | null = null;
let permissionPromise: Promise<void> | null = null;
const registeredTokenKeys = new Set<string>();
const tokenRegistrationInFlight = new Map<string, Promise<RegisterTokenResult>>();

function publish(patch: Partial<PushRuntimeSnapshot>): void {
  pushSnapshot = { ...pushSnapshot, ...patch };
  for (const subscriber of pushSubscribers) {
    try {
      subscriber(pushSnapshot);
    } catch (error) {
      logger.warn('push runtime subscriber failed', { error: String(error) });
    }
  }
}

async function removeHandle(handle: ListenerHandle): Promise<void> {
  try {
    await handle.remove();
  } catch (error) {
    logger.warn('push runtime listener cleanup failed', { error: String(error) });
  }
}

async function removeHandles(handles: ListenerHandle[]): Promise<void> {
  await Promise.all(handles.map((handle) => removeHandle(handle)));
}

async function reportTokenToServer(token: string): Promise<RegisterTokenResult> {
  const result = await registerTokenToServer(token, Capacitor.getPlatform(), {
    getIdToken: async () => {
      try {
        const { apiAuthHeader } = await import('../lib/apiAuth');
        return await apiAuthHeader();
      } catch {
        return null;
      }
    },
    fetchImpl: fetch,
  });

  if (result.ok) {
    publish({ lastRegisteredAt: Date.now(), registrationError: null });
  } else {
    publish({ registrationError: result.error ?? 'unknown' });
    logger.warn('push token registration failed', { error: result.error });
  }
  return result;
}

async function handleToken(token: string): Promise<RegisterTokenResult> {
  const uid = auth.currentUser?.uid;
  const tokenKey = uid ? `${uid}:${Capacitor.getPlatform()}:${token}` : null;
  publish({ fcmToken: token });
  if (tokenKey && registeredTokenKeys.has(tokenKey)) return { ok: true };
  if (tokenKey) {
    const inFlight = tokenRegistrationInFlight.get(tokenKey);
    if (inFlight) return inFlight;
  }

  const registration = (async () => {
    if (auth.currentUser) {
      try {
        await setDoc(
          doc(db, 'users', auth.currentUser.uid),
          { fcmToken: token, updatedAt: new Date() },
          { merge: true },
        );
      } catch (error) {
        logger.warn('push firestore token mirror failed', { error: String(error) });
      }
    }
    const result = await reportTokenToServer(token);
    if (result.ok && tokenKey) registeredTokenKeys.add(tokenKey);
    return result;
  })();

  if (tokenKey) tokenRegistrationInFlight.set(tokenKey, registration);
  try {
    return await registration;
  } finally {
    if (tokenKey) tokenRegistrationInFlight.delete(tokenKey);
  }
}

async function refreshPermissionState(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const permission = await PushNotifications.checkPermissions();
      publish({
        notificationPermissionStatus: permission.receive as PushPermission,
        hasPermission: permission.receive === 'granted',
      });
    } catch (error) {
      logger.warn('native push permission check failed', { error: String(error) });
      publish({ criticalAlertsBlocked: true });
    }
    try {
      const status = await getCriticalAlertStatus(criticalChannelDeps);
      publish({ criticalAlertsBlocked: isCriticalAlertsBlocked(status) });
    } catch (error) {
      logger.warn('critical push channel check failed', { error: String(error) });
      publish({ criticalAlertsBlocked: true });
    }
    return;
  }

  if (typeof Notification !== 'undefined') {
    const permission = Notification.permission as PushPermission;
    publish({
      notificationPermissionStatus: permission,
      hasPermission: permission === 'granted',
      criticalAlertsBlocked: permission !== 'granted',
    });
  }
}

async function ensureNativeRegistrationListeners(): Promise<void> {
  if (nativeRegistrationHandles.length > 0) return;
  if (nativeRegistrationPromise) return nativeRegistrationPromise;

  nativeRegistrationPromise = (async () => {
    const registrationHandle = await PushNotifications.addListener('registration', (token) => {
      void handleToken(token.value);
    });
    const errorHandle = await PushNotifications.addListener('registrationError', (error) => {
      logger.error('push registration error', { error });
      publish({ registrationError: 'native_registration_error' });
    });
    if (pushSubscribers.size === 0) {
      await removeHandles([registrationHandle, errorHandle]);
      return;
    }
    nativeRegistrationHandles = [registrationHandle, errorHandle];
  })().finally(() => {
    nativeRegistrationPromise = null;
  });
  return nativeRegistrationPromise;
}

async function startRuntime(): Promise<void> {
  const generation = runtimeGeneration;
  if (Capacitor.isNativePlatform()) {
    const receivedHandle = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      logger.debug('Push notification received', { notification });
    });
    const actionHandle = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      logger.debug('Push action performed', { action });
      try {
        const data = (action?.notification?.data ?? undefined) as
          | Record<string, string>
          | undefined;
        dispatchNotificationDeepLink(data);
      } catch (error) {
        logger.warn('push action deep-link dispatch failed', { error: String(error) });
      }
    });
    if (generation !== runtimeGeneration || pushSubscribers.size === 0) {
      await removeHandles([receivedHandle, actionHandle]);
      return;
    }
    nativeHandles = [receivedHandle, actionHandle];
  } else {
    const messaging = await getMessagingInstance();
    if (messaging && generation === runtimeGeneration && pushSubscribers.size > 0) {
      webMessaging = messaging;
      webForegroundUnsubscribe = onMessage(messaging, (payload) => {
        logger.debug('FCM message received', { payload });
        showForegroundPushNotification(payload);
      });
    }
  }

  if (generation !== runtimeGeneration || pushSubscribers.size === 0) return;
  await refreshPermissionState();
  runtimeStarted = true;
}

function ensureRuntimeStarted(): Promise<void> {
  if (runtimeStarted) return Promise.resolve();
  if (runtimeStartPromise) return runtimeStartPromise;
  runtimeStartPromise = startRuntime()
    .catch((error) => {
      logger.error('push runtime startup failed', { error: String(error) });
      publish({ registrationError: 'runtime_start_failed' });
    })
    .finally(() => {
      runtimeStartPromise = null;
    });
  return runtimeStartPromise;
}

async function stopRuntime(): Promise<void> {
  if (pushSubscribers.size > 0) return;
  runtimeGeneration += 1;
  runtimeStarted = false;
  const handles = [...nativeHandles, ...nativeRegistrationHandles];
  nativeHandles = [];
  nativeRegistrationHandles = [];
  webForegroundUnsubscribe?.();
  webForegroundUnsubscribe = null;
  webMessaging = null;
  await removeHandles(handles);
}

function subscribePushRuntime(subscriber: PushSubscriber): () => void {
  pushSubscribers.add(subscriber);
  subscriber(pushSnapshot);
  void ensureRuntimeStarted();
  return () => {
    pushSubscribers.delete(subscriber);
    if (pushSubscribers.size === 0) void stopRuntime();
  };
}

function requestPushPermission(): Promise<void> {
  if (permissionPromise) return permissionPromise;
  permissionPromise = (async () => {
    await ensureRuntimeStarted();
    if (Capacitor.isNativePlatform()) {
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions();
      publish({
        notificationPermissionStatus: permission.receive as PushPermission,
        hasPermission: permission.receive === 'granted',
      });
      if (permission.receive !== 'granted') {
        publish({ criticalAlertsBlocked: true });
        logger.warn('user denied push permission');
        return;
      }
      publish({ criticalAlertsBlocked: false });
      await ensureEmergencyChannel(criticalChannelDeps);
      // Install before register: native registration events cannot race past us.
      await ensureNativeRegistrationListeners();
      await PushNotifications.register();
      return;
    }

    const messaging = webMessaging ?? await getMessagingInstance();
    if (!messaging) {
      logger.warn('messaging not supported in this browser');
      return;
    }
    webMessaging = messaging;
    const permission = await Notification.requestPermission();
    publish({
      notificationPermissionStatus: permission,
      hasPermission: permission === 'granted',
      criticalAlertsBlocked: permission !== 'granted',
    });
    if (permission !== 'granted') return;

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) logger.warn('VITE_FIREBASE_VAPID_KEY is not set — web push may not work');
    const token = await getToken(messaging, { vapidKey: vapidKey || undefined });
    if (token) await handleToken(token);
    else logger.warn('no FCM registration token available');
  })()
    .catch((error) => {
      logger.error('push permission flow failed', { error: String(error) });
    })
    .finally(() => {
      permissionPromise = null;
    });
  return permissionPromise;
}

/** Test-only lifecycle reset; production consumers use subscriber cleanup. */
export async function __resetPushNotificationRuntimeForTests(): Promise<void> {
  pushSubscribers.clear();
  await stopRuntime();
  pushSnapshot = { ...initialPushSnapshot };
  registeredTokenKeys.clear();
  tokenRegistrationInFlight.clear();
  permissionPromise = null;
  nativeRegistrationPromise = null;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushRuntimeSnapshot>(() => pushSnapshot);
  useEffect(() => subscribePushRuntime(setState), []);

  return {
    ...state,
    requestPermission: requestPushPermission,
    registerForPushNotifications: requestPushPermission,
  };
}
