import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { logger } from '../../utils/logger';
import { dispatchNotificationDeepLink } from './notificationDeepLinkDispatch';

interface NativeListenerHandle {
  remove: () => Promise<void> | void;
}

let installed = false;
let listenerHandle: NativeListenerHandle | null = null;
let installPromise: Promise<void> | null = null;

function notificationData(action: unknown): Record<string, string> | undefined {
  const candidate = (action as { notification?: { data?: unknown } } | null)?.notification?.data;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;

  const entries = Object.entries(candidate).filter(([, value]) => typeof value === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Install before React mounts so a cold-start push action cannot be lost while
 * the lazy router tree is still loading. DeepLinkBridge buffers its dispatch
 * until DeepLinkHandler subscribes.
 */
export function installNativePushActionBridge(): Promise<void> {
  if (!Capacitor.isNativePlatform() || installed) return Promise.resolve();
  if (installPromise) return installPromise;

  installPromise = Promise.resolve()
    .then(() =>
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        try {
          dispatchNotificationDeepLink(notificationData(action));
        } catch (error) {
          logger.warn('cold-start push action dispatch failed', { error: String(error) });
        }
      }),
    )
    .then((handle) => {
      listenerHandle = handle;
      installed = true;
    })
    .catch((error) => {
      logger.warn('cold-start push action listener failed to register', { error: String(error) });
    })
    .finally(() => {
      installPromise = null;
    });

  return installPromise;
}

/** Test-only cleanup; the production bridge lives for the app process lifetime. */
export async function __resetNativePushActionBridgeForTests(): Promise<void> {
  const handle = listenerHandle;
  listenerHandle = null;
  installed = false;
  installPromise = null;
  if (handle) await handle.remove();
}
