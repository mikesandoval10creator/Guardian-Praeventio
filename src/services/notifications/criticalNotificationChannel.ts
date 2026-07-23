// Praeventio Guard — critical (emergency) notification channel + status.
//
// [P1][VIDA] Android twin of the iOS Critical Alerts task. Two REAL, testable
// pieces that do not depend on a device:
//
//  1. A DEDICATED emergency channel at IMPORTANCE_HIGH so SOS / evacuation /
//     man-down pushes render as a heads-up popup with sound — instead of
//     landing on whatever default channel FCM picks. Today the only channel in
//     the app is the lone-worker foreground service (importance 'low'), so a
//     critical push had no high-priority home.
//
//  2. Detection of the "critical alerts are OFF" state. On Android 13+ a worker
//     who denied POST_NOTIFICATIONS silently receives NOTHING — including
//     evacuation and SOS — and the app never told them. `getCriticalAlertStatus`
//     surfaces that so the UI can warn and offer recovery.
//
// PLATFORM WALL (honest): true Do-Not-Disturb override (`setBypassDnd(true)`)
// is NOT exposed by @capacitor/push-notifications — its Channel type has no
// bypassDnd field. That override, plus the deep-link into the OS notification
// settings for recovery, need a thin native addition and on-device
// verification; tracked as a separate follow-up. IMPORTANCE_HIGH here is the
// maximum the JS API allows and already delivers heads-up + sound.

import type { Channel } from '@capacitor/push-notifications';

/** Stable id — the server targets this channel on critical FCM messages. */
export const EMERGENCY_CHANNEL_ID = 'praeventio_emergency';

/**
 * The emergency channel. `importance: 4` is NotificationManager.IMPORTANCE_HIGH
 * (heads-up + sound); `visibility: 1` is VISIBILITY_PUBLIC so an evacuation
 * order is legible on the lock screen without unlocking.
 */
export const EMERGENCY_CHANNEL: Channel = {
  id: EMERGENCY_CHANNEL_ID,
  name: 'Emergencias y evacuación',
  description:
    'Alertas críticas de seguridad: SOS, evacuación y hombre caído. Mantén este canal activo — de esto depende tu seguridad.',
  importance: 4,
  visibility: 1,
  lights: true,
  vibration: true,
};

/**
 * Injected slice of `@capacitor/push-notifications` so the service is pure and
 * unit-testable without Capacitor/jsdom (same DI pattern as
 * `registerTokenToServer`).
 */
export interface CriticalChannelDeps {
  createChannel: (channel: Channel) => Promise<void>;
  listChannels: () => Promise<{ channels: Array<{ id: string }> }>;
  checkPermissions: () => Promise<{ receive: string }>;
}

/**
 * Create the emergency channel if it does not already exist. Idempotent and
 * total: it never throws (push registration must not crash on a channel error),
 * and it still creates the channel if `listChannels` is unsupported.
 *
 * @returns `true` if it created the channel this call, `false` otherwise.
 */
export async function ensureEmergencyChannel(
  deps: CriticalChannelDeps,
): Promise<boolean> {
  let alreadyExists = false;
  try {
    const { channels } = await deps.listChannels();
    alreadyExists = channels.some((c) => c.id === EMERGENCY_CHANNEL_ID);
  } catch {
    // listChannels not available on this device — fall through and create;
    // createChannel is idempotent on Android.
    alreadyExists = false;
  }

  if (alreadyExists) return false;

  try {
    await deps.createChannel(EMERGENCY_CHANNEL);
    return true;
  } catch {
    return false;
  }
}

export interface CriticalAlertStatus {
  /** True only when the OS will actually deliver notifications. */
  enabled: boolean;
  /** Raw permission state ('granted' | 'denied' | 'prompt' | 'unknown'). */
  permission: string;
}

/**
 * Read whether critical alerts can reach the worker. Fails CLOSED: if the
 * permission cannot be read, we report `enabled: false` so the UI warns rather
 * than assuming the worker is covered when they might not be.
 */
export async function getCriticalAlertStatus(
  deps: Pick<CriticalChannelDeps, 'checkPermissions'>,
): Promise<CriticalAlertStatus> {
  try {
    const { receive } = await deps.checkPermissions();
    return { enabled: receive === 'granted', permission: receive };
  } catch {
    return { enabled: false, permission: 'unknown' };
  }
}

/** A worker whose critical alerts are OFF — the UI must warn and offer recovery. */
export function criticalAlertsBlocked(status: CriticalAlertStatus): boolean {
  return status.enabled === false;
}
