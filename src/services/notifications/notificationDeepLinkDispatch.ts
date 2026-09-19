import { DEEP_LINK_EVENT_NAME } from "../../components/shared/DeepLinkHandler";
import { resolveNotificationDeepLink } from "./notificationDeepLink";

/**
 * Dispatch an FCM data payload through the application's authenticated
 * deep-link bridge. The resolver is total and falls back to /notifications
 * for missing or malformed data, so a notification click is never a no-op.
 */
export function dispatchNotificationDeepLink(
  data: Record<string, string> | undefined | null,
): void {
  if (typeof window === "undefined") return;
  const { url, projectId } = resolveNotificationDeepLink(data);
  window.dispatchEvent(
    new CustomEvent(DEEP_LINK_EVENT_NAME, { detail: { url, projectId } }),
  );
}
