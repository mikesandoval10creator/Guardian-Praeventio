import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  native: false,
  platform: "web" as "web" | "android",
  plugin: {
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => H.native,
    getPlatform: () => H.platform,
  },
  registerPlugin: () => H.plugin,
}));

import {
  getNativeLoneWorkerStatus,
  isAndroidNativeLoneWorker,
  nativeLoneWorkerApiOrigin,
  startNativeLoneWorker,
  stopNativeLoneWorker,
} from "./nativeLoneWorkerClient";

beforeEach(() => {
  H.native = false;
  H.platform = "web";
  H.plugin.start.mockReset();
  H.plugin.stop.mockReset();
  H.plugin.getStatus.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe("nativeLoneWorkerClient", () => {
  it("reports a start timeout after 10 seconds if the service never acknowledges", async () => {
    vi.useFakeTimers();
    H.native = true;
    H.platform = "android";
    H.plugin.start.mockImplementation(() => new Promise(() => {}));
    let result: Awaited<ReturnType<typeof startNativeLoneWorker>> | undefined;
    void startNativeLoneWorker({
      projectId: "project-1", sessionId: "session-1", capability: "a".repeat(32),
      capabilityExpiresAt: "2099-01-01T00:00:00.000Z",
    }).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ applied: false, reason: "native_error", error: "native_lone_worker_start_timeout" });
  });
  it("is a no-op outside native Android", async () => {
    const result = await startNativeLoneWorker({
      projectId: "project-1",
      sessionId: "session-1",
      capability: "a".repeat(32),
      capabilityExpiresAt: "2099-01-01T00:00:00.000Z",
    });

    expect(result).toEqual({ applied: false, reason: "not_android" });
    expect(H.plugin.start).not.toHaveBeenCalled();
    expect(isAndroidNativeLoneWorker()).toBe(false);
  });

  it("starts with the HTTPS production origin and never sends a Firebase token", async () => {
    H.native = true;
    H.platform = "android";
    H.plugin.start.mockResolvedValue({ running: true });

    const result = await startNativeLoneWorker({
      projectId: "project-1",
      sessionId: "session-1",
      capability: "opaque-capability",
      capabilityExpiresAt: "2099-01-01T00:00:00.000Z",
      heartbeatIntervalMs: 30_000,
    });

    expect(result).toEqual({ applied: true });
    expect(H.plugin.start).toHaveBeenCalledWith({
      projectId: "project-1",
      sessionId: "session-1",
      capability: "opaque-capability",
      capabilityExpiresAt: "2099-01-01T00:00:00.000Z",
      heartbeatIntervalMs: 30_000,
      apiBaseUrl: "https://app.praeventio.net",
    });
    expect(JSON.stringify(H.plugin.start.mock.calls)).not.toContain("firebase");
    expect(nativeLoneWorkerApiOrigin()).toBe("https://app.praeventio.net");
  });

  it("reports a native service refusal instead of claiming protection", async () => {
    H.native = true;
    H.platform = "android";
    H.plugin.start.mockResolvedValue({
      running: false,
      lastError: "location_permission_required",
    });

    await expect(
      startNativeLoneWorker({
        projectId: "project-1",
        sessionId: "session-1",
        capability: "a".repeat(32),
        capabilityExpiresAt: "2099-01-01T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      applied: false,
      reason: "native_error",
      error: "location_permission_required",
    });
  });

  it("keeps stop and status idempotent on Android", async () => {
    H.native = true;
    H.platform = "android";
    H.plugin.stop.mockResolvedValue(undefined);
    H.plugin.getStatus.mockResolvedValue({
      running: true,
      lastHeartbeatAt: "2026-09-26T17:00:00.000Z",
    });

    await stopNativeLoneWorker();
    expect(H.plugin.stop).toHaveBeenCalledOnce();
    await expect(getNativeLoneWorkerStatus()).resolves.toEqual({
      running: true,
      lastHeartbeatAt: "2026-09-26T17:00:00.000Z",
    });
  });
});
