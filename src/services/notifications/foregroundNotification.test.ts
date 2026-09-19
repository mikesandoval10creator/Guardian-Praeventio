import { describe, expect, it, vi } from "vitest";
import { showForegroundPushNotification } from "./foregroundNotification";

class FakeBrowserNotification {
  static instances: FakeBrowserNotification[] = [];
  onclick: ((event: Event) => void) | null = null;
  close = vi.fn();

  constructor(
    public readonly title: string,
    public readonly options?: NotificationOptions,
  ) {
    FakeBrowserNotification.instances.push(this);
  }
}

function deps() {
  return {
    NotificationCtor: FakeBrowserNotification,
    dispatchDeepLink: vi.fn(),
    focusWindow: vi.fn(),
  };
}

describe("showForegroundPushNotification", () => {
  it("preserves FCM data and dispatches its deep link when clicked", () => {
    FakeBrowserNotification.instances = [];
    const injected = deps();
    const data = { type: "sos", projectId: "project-a", alertId: "alert-1" };

    const shown = showForegroundPushNotification(
      {
        notification: {
          title: "SOS activo",
          body: "Trabajador solicita ayuda",
        },
        data,
      },
      injected,
    );

    expect(shown).toBe(FakeBrowserNotification.instances[0]);
    expect(shown?.title).toBe("SOS activo");
    expect(shown?.options).toMatchObject({
      body: "Trabajador solicita ayuda",
      icon: "/icon.svg",
      data,
    });

    const preventDefault = vi.fn();
    shown?.onclick?.({ preventDefault } as unknown as Event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(injected.focusWindow).toHaveBeenCalledOnce();
    expect(injected.dispatchDeepLink).toHaveBeenCalledOnce();
    expect(injected.dispatchDeepLink).toHaveBeenCalledWith(data);
    expect(shown?.close).toHaveBeenCalledOnce();
  });

  it("uses a safe title and routes missing data to the resolver fallback", () => {
    FakeBrowserNotification.instances = [];
    const injected = deps();

    const shown = showForegroundPushNotification(
      { notification: { body: "Sin título" } },
      injected,
    );

    expect(shown?.title).toBe("Praeventio Guard");
    shown?.onclick?.({ preventDefault: vi.fn() } as unknown as Event);
    expect(injected.dispatchDeepLink).toHaveBeenCalledWith(undefined);
  });

  it("continues deep-link dispatch when window focus throws", () => {
    FakeBrowserNotification.instances = [];
    const dispatchDeepLink = vi.fn();
    const data = { emergencyType: "hazmat", projectId: "project-a" };
    const shown = showForegroundPushNotification(
      { notification: { title: "Zona peligrosa" }, data },
      {
        NotificationCtor: FakeBrowserNotification,
        dispatchDeepLink,
        focusWindow: () => {
          throw new Error("focus blocked");
        },
      },
    );

    expect(() =>
      shown?.onclick?.({ preventDefault: vi.fn() } as unknown as Event),
    ).not.toThrow();
    expect(dispatchDeepLink).toHaveBeenCalledWith(data);
    expect(shown?.close).toHaveBeenCalledOnce();
  });

  it("returns null when the browser Notification API is unavailable", () => {
    // Assign explicitly so the probe remains deterministic if the runner later
    // adds a Notification polyfill.
    vi.stubGlobal("Notification", undefined);

    const shown = showForegroundPushNotification({
      notification: { title: "SOS activo" },
      data: { type: "sos", alertId: "alert-1" },
    });

    expect(shown).toBeNull();
    vi.unstubAllGlobals();
  });

  it("does not create a browser notification when the FCM notification block is absent", () => {
    FakeBrowserNotification.instances = [];
    const injected = deps();

    const shown = showForegroundPushNotification(
      { data: { type: "sos", alertId: "alert-1" } },
      injected,
    );

    expect(shown).toBeNull();
    expect(FakeBrowserNotification.instances).toHaveLength(0);
    expect(injected.dispatchDeepLink).not.toHaveBeenCalled();
  });
});
