import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  native: true,
  platform: "android",
  plugin: { start: vi.fn(), stop: vi.fn() },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => H.native,
    getPlatform: () => H.platform,
  },
  registerPlugin: () => H.plugin,
}));
import { startNativeManDown, stopNativeManDown } from "./nativeManDownClient";

beforeEach(() => {
  H.native = true;
  H.platform = "android";
  H.plugin.stop.mockReset();
  H.plugin.start.mockReset();
});

describe("nativeManDownClient stop confirmation", () => {
  it.each(["web", "ios"])("reports unavailable on %s without invoking the plugin", async (platform) => {
    H.platform = platform;
    H.native = platform !== "web";
    await expect(stopNativeManDown()).resolves.toEqual({ stopped: false, reason: "not_android" });
    expect(H.plugin.stop).not.toHaveBeenCalled();
  });

  it("confirms a successful native stop", async () => {
    H.plugin.stop.mockResolvedValue(undefined);
    await expect(stopNativeManDown()).resolves.toEqual({ stopped: true });
    expect(H.plugin.stop).toHaveBeenCalledExactlyOnceWith();
  });

  it.each(["error", "string", "throw"])("reports native %s failures instead of absorbing them", async (failure) => {
    if (failure === "throw") H.plugin.stop.mockImplementation(() => { throw new Error("native disk"); });
    else H.plugin.stop.mockRejectedValue(failure === "error" ? new Error("native disk") : "native disk");
    await expect(stopNativeManDown()).resolves.toEqual({ stopped: false, reason: "native_error", error: "native disk" });
  });

  it("waits for the native acknowledgment before confirming the stop", async () => {
    let finish!: () => void;
    H.plugin.stop.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    let settled = false;
    const stopping = stopNativeManDown().then((result) => { settled = true; return result; });
    try {
      await Promise.resolve();
      expect(settled).toBe(false);
    } finally {
      finish();
    }
    await expect(stopping).resolves.toEqual({ stopped: true });
  });

  it("preserves native startup options and refusal reporting", async () => {
    const options = { projectId: "project", sessionId: "session", capability: "x".repeat(43), capabilityExpiresAt: "2099-01-01T00:00:00Z", inactivityThresholdMs: 30_000 };
    H.plugin.start.mockResolvedValue({ running: false, lastError: "sensor_unavailable" });
    await expect(startNativeManDown(options)).resolves.toEqual({ applied: false, reason: "native_error", error: "sensor_unavailable" });
    expect(H.plugin.start).toHaveBeenCalledWith(expect.objectContaining(options));
  });
});
