import { dispatchNotificationDeepLink } from "./notificationDeepLinkDispatch";

export interface ForegroundPushPayload {
  notification?: {
    title?: string;
    body?: string;
  };
  data?: Record<string, string>;
}

export interface ForegroundNotificationHandle {
  readonly title: string;
  readonly options?: NotificationOptions;
  onclick: ((event: Event) => void) | null;
  close(): void;
}

export interface ForegroundNotificationConstructor {
  new (
    title: string,
    options?: NotificationOptions,
  ): ForegroundNotificationHandle;
}

export interface ForegroundNotificationDeps {
  NotificationCtor?: ForegroundNotificationConstructor;
  dispatchDeepLink?: (data: Record<string, string> | undefined) => void;
  focusWindow?: () => void;
}

/**
 * Render a foreground FCM payload as a clickable browser notification.
 *
 * The FCM data map is preserved in NotificationOptions and fed to the same
 * deep-link resolver used by native taps. Missing data resolves to the safe
 * notifications inbox rather than leaving the click as a no-op.
 */
export function showForegroundPushNotification(
  payload: ForegroundPushPayload,
  deps: ForegroundNotificationDeps = {},
): ForegroundNotificationHandle | null {
  if (!payload.notification) return null;

  const NotificationCtor =
    deps.NotificationCtor ??
    (typeof Notification !== "undefined"
      ? (Notification as unknown as ForegroundNotificationConstructor)
      : undefined);
  if (!NotificationCtor) return null;

  const dispatchDeepLink =
    deps.dispatchDeepLink ?? dispatchNotificationDeepLink;
  const focusWindow =
    deps.focusWindow ??
    (() => {
      if (typeof window !== "undefined") window.focus();
    });

  const notification = new NotificationCtor(
    payload.notification.title || "Praeventio Guard",
    {
      body: payload.notification.body,
      icon: "/icon.svg",
      data: payload.data,
    },
  );

  notification.onclick = (event) => {
    event.preventDefault();
    try {
      focusWindow();
    } catch {
      // Some browsers reject focus() without a user activation. Navigation
      // must still proceed through the deep-link bridge.
    }
    dispatchDeepLink(payload.data);
    notification.close();
  };

  return notification;
}
