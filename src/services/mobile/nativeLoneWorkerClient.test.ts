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

const startOptions = {
  projectId: "project-1",
  sessionId: "session-1",
  capability: "a".repeat(32),
  capabilityExpiresAt: "2099-01-01T00:00:00.000Z",
};

describe("nativeLoneWorkerClient", () => {
  it.each(["success", "error"] as const)("times out after 10 seconds and ignores a late native %s", async (outcome) => {
    vi.useFakeTimers();
    H.native = true;
    H.platform = "android";
    let resolveNative!: (value: { running: boolean }) => void;
    let rejectNative!: (error: Error) => void;
    H.plugin.start.mockReturnValue(new Promise<{ running: boolean }>((resolve, reject) => {
      resolveNative = resolve;
      rejectNative = reject;
    }));
    let result: Awaited<ReturnType<typeof startNativeLoneWorker>> | undefined;
    const pendingStart = startNativeLoneWorker(startOptions).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ applied: false, reason: "native_error", error: "native_lone_worker_start_timeout" });
    expect(vi.getTimerCount()).toBe(0);
    // Settle the native mock too: an intentionally orphaned fixture would hide
    // whether the bridge itself leaks promises in Vitest's async detector.
    if (outcome === "success") resolveNative({ running: true });
    else rejectNative(new Error("late_native_error"));
    await pendingStart;
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toEqual({ applied: false, reason: "native_error", error: "native_lone_worker_start_timeout" });
  });

  it.each(["success", "refusal", "rejection", "throw"] as const)("clears the timeout after immediate native %s", async (outcome) => {
    vi.useFakeTimers();
    H.native = true;
    H.platform = "android";
    if (outcome === "success") H.plugin.start.mockResolvedValue({ running: true });
    else if (outcome === "refusal") H.plugin.start.mockResolvedValue({ running: false });
    else if (outcome === "rejection") H.plugin.start.mockRejectedValue(new Error("native_failure"));
    else H.plugin.start.mockImplementation(() => { throw new Error("native_failure"); });

    await expect(startNativeLoneWorker(startOptions)).resolves.toEqual(
      outcome === "success"
        ? { applied: true }
        : { applied: false, reason: "native_error", error: outcome === "refusal" ? "native_lone_worker_not_running" : "native_failure" },
    );
    expect(vi.getTimerCount()).toBe(0);
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

  it("reports a confirmed native stop", async () => {
    H.native = true;
    H.platform = "android";
    H.plugin.stop.mockResolvedValue(undefined);
    await expect(stopNativeLoneWorker()).resolves.toEqual({ stopped: true });
  });

  it.each([new Error("cleanup_persist_failed"), "cleanup_persist_failed"])(
    "reports native stop failures instead of swallowing them (%s)", async (failure) => {
      H.native = true;
      H.platform = "android";
      H.plugin.stop.mockRejectedValue(failure);
      await expect(stopNativeLoneWorker()).resolves.toEqual({
        stopped: false, reason: "native_error", error: "cleanup_persist_failed",
      });
    },
  );

  it("reports a synchronous native stop refusal", async () => {
    H.native = true;
    H.platform = "android";
    H.plugin.stop.mockImplementation(() => { throw new Error("native_unavailable"); });
    await expect(stopNativeLoneWorker()).resolves.toEqual({
      stopped: false, reason: "native_error", error: "native_unavailable",
    });
  });

  it("does not claim a stop or call the plugin outside Android", async () => {
    await expect(stopNativeLoneWorker()).resolves.toEqual({ stopped: false, reason: "not_android" });
    expect(H.plugin.stop).not.toHaveBeenCalled();
  });
});
