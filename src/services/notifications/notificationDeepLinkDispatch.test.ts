// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { DEEP_LINK_EVENT_NAME } from "../../components/shared/DeepLinkHandler";
import { dispatchNotificationDeepLink } from "./notificationDeepLinkDispatch";

describe("dispatchNotificationDeepLink", () => {
  it("dispatches the resolved SOS path and project through the shared bridge", () => {
    const listener = vi.fn();
    window.addEventListener(DEEP_LINK_EVENT_NAME, listener as EventListener);

    dispatchNotificationDeepLink({
      type: "sos",
      projectId: "project-a",
      alertId: "alert/1",
    });

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({
      url: "/emergencia-avanzada?alertId=alert%2F1&projectId=project-a&source=push",
      projectId: "project-a",
    });

    window.removeEventListener(DEEP_LINK_EVENT_NAME, listener as EventListener);
  });

  it("dispatches the safe inbox fallback for missing data", () => {
    const listener = vi.fn();
    window.addEventListener(DEEP_LINK_EVENT_NAME, listener as EventListener);

    dispatchNotificationDeepLink(undefined);

    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({
      url: "/notifications?source=push",
      projectId: null,
    });

    window.removeEventListener(DEEP_LINK_EVENT_NAME, listener as EventListener);
  });
});
