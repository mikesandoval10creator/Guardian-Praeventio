// @vitest-environment jsdom

import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { logger } from "../../utils/logger";
import type { LoneWorkerSession } from "../../services/loneWorker/loneWorkerService";

let mockProject: { id: string } | null = { id: "project-1" };
let mockUser: { uid: string } | null = { uid: "worker-1" };
let subscriptionData: ((sessions: LoneWorkerSession[]) => void) | null = null;
let subscriptionError: ((error: unknown) => void) | null = null;

const subscribeActiveLoneWorkerSessions = vi.fn(
  (
    _projectId: string,
    onData: (sessions: LoneWorkerSession[]) => void,
    onError: (error: unknown) => void,
  ) => {
    subscriptionData = onData;
    subscriptionError = onError;
    return vi.fn();
  },
);
const mintNativeLoneWorkerCapability = vi.fn();
const startNativeLoneWorker = vi.fn();
const stopNativeLoneWorker = vi.fn();
const isAndroidNativeLoneWorker = vi.fn(() => true);

vi.mock("../../contexts/FirebaseContext", () => ({
  useFirebase: () => ({ user: mockUser }),
}));
vi.mock("../../contexts/ProjectContext", () => ({
  useProject: () => ({ selectedProject: mockProject }),
}));
vi.mock("../../services/loneWorker/loneWorkerStore", () => ({
  subscribeActiveLoneWorkerSessions: (...args: unknown[]) =>
    subscribeActiveLoneWorkerSessions(
      ...(args as [string, (s: LoneWorkerSession[]) => void, (e: unknown) => void]),
    ),
}));
vi.mock("../../hooks/useLoneWorker", () => ({
  mintNativeLoneWorkerCapability: (...args: unknown[]) =>
    mintNativeLoneWorkerCapability(...args),
}));
vi.mock("../../services/mobile/nativeLoneWorkerClient", () => ({
  isAndroidNativeLoneWorker: () => isAndroidNativeLoneWorker(),
  startNativeLoneWorker: (...args: unknown[]) => startNativeLoneWorker(...args),
  stopNativeLoneWorker: (...args: unknown[]) => stopNativeLoneWorker(...args),
}));
vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { NativeLoneWorkerBridge } from "./NativeLoneWorkerBridge";

function session(over: Partial<LoneWorkerSession> = {}): LoneWorkerSession {
  return {
    id: "session-1",
    workerUid: "worker-1",
    startedAt: "2026-09-26T17:00:00.000Z",
    checkInIntervalMin: 15,
    checkIns: [],
    status: "active",
    ...over,
  };
}

beforeEach(() => {
  mockProject = { id: "project-1" };
  mockUser = { uid: "worker-1" };
  subscriptionData = null;
  subscriptionError = null;
  subscribeActiveLoneWorkerSessions.mockClear();
  mintNativeLoneWorkerCapability.mockReset();
  startNativeLoneWorker.mockReset();
  stopNativeLoneWorker.mockReset();
  isAndroidNativeLoneWorker.mockReset();
  isAndroidNativeLoneWorker.mockReturnValue(true);
  vi.mocked(logger.error).mockClear();
  mintNativeLoneWorkerCapability.mockResolvedValue({
    sessionId: "session-1",
    capability: "a".repeat(32),
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  startNativeLoneWorker.mockResolvedValue({ applied: true });
  stopNativeLoneWorker.mockResolvedValue({ stopped: true });
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
});

describe("<NativeLoneWorkerBridge />", () => {
  it("starts the Android-owned service only after an open session is observed", async () => {
    render(<NativeLoneWorkerBridge />);
    expect(startNativeLoneWorker).not.toHaveBeenCalled();

    subscriptionData?.([session()]);

    await waitFor(() => expect(startNativeLoneWorker).toHaveBeenCalledWith({
      projectId: "project-1",
      sessionId: "session-1",
      capability: "a".repeat(32),
      capabilityExpiresAt: "2099-01-01T00:00:00.000Z",
      heartbeatIntervalMs: 30_000,
    }));
    expect(mintNativeLoneWorkerCapability).toHaveBeenCalledWith(
      "project-1",
      "session-1",
    );
  });

  it("stops on an observed terminal/empty session, not on a subscription error", async () => {
    render(<NativeLoneWorkerBridge />);
    subscriptionData?.([session()]);
    await waitFor(() => expect(startNativeLoneWorker).toHaveBeenCalled());
    stopNativeLoneWorker.mockClear();

    subscriptionError?.(new Error("offline"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stopNativeLoneWorker).not.toHaveBeenCalled();

    subscriptionData?.([]);
    await waitFor(() => expect(stopNativeLoneWorker).toHaveBeenCalled());
  });

  it("revokes native authority when the authenticated identity leaves the bridge", async () => {
    const view = render(<NativeLoneWorkerBridge />);
    subscriptionData?.([session()]);
    await waitFor(() => expect(startNativeLoneWorker).toHaveBeenCalled());

    view.unmount();
    await waitFor(() => expect(stopNativeLoneWorker).toHaveBeenCalled());
  });

  it("keeps a failed closure visible across rerenders without exposing native details", async () => {
    stopNativeLoneWorker.mockResolvedValue({ stopped: false, reason: "native_error", error: "private native path" });
    const view = render(<NativeLoneWorkerBridge />);
    await act(async () => { subscriptionData?.([]); });
    expect(screen.getByRole("alert").textContent).toContain("Cierre de vigilancia pendiente");
    expect(screen.getByRole("alert").textContent).not.toContain("private native path");
    view.rerender(<NativeLoneWorkerBridge />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(stopNativeLoneWorker).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith("native_lone_worker_stop_failed", "private native path");
  });

  it("clears the warning only after a confirmed retry and coalesces pending stop requests", async () => {
    stopNativeLoneWorker.mockResolvedValueOnce({ stopped: false, reason: "native_error", error: "disk" });
    render(<NativeLoneWorkerBridge />);
    await act(async () => { subscriptionData?.([]); });
    const pending = deferredStop();
    stopNativeLoneWorker.mockReturnValueOnce(pending.promise);
    try {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reintentar cierre" })); });
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByRole("button")).toHaveProperty("disabled", true);
      fireEvent.click(screen.getByRole("button"));
      expect(stopNativeLoneWorker).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => { pending.finish({ stopped: true }); });
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not allow retry while the session is unknown or active", async () => {
    stopNativeLoneWorker.mockResolvedValueOnce({ stopped: false, reason: "native_error", error: "disk" });
    render(<NativeLoneWorkerBridge />);
    await act(async () => { subscriptionData?.([]); });
    await act(async () => { subscriptionError?.(new Error("offline")); });
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button"));
    expect(stopNativeLoneWorker).toHaveBeenCalledOnce();
    await act(async () => { subscriptionData?.([session({ id: "new-session" })]); });
    expect(startNativeLoneWorker).toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button"));
    expect(stopNativeLoneWorker).toHaveBeenCalledOnce();
    await act(async () => { subscriptionData?.([]); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("waits for an identity-boundary stop before starting the new session", async () => {
    const view = render(<NativeLoneWorkerBridge />);
    await act(async () => { subscriptionData?.([session()]); });
    const pending = deferredStop();
    stopNativeLoneWorker.mockReturnValueOnce(pending.promise);
    mockProject = { id: "project-2" };
    try {
      view.rerender(<NativeLoneWorkerBridge />);
      await act(async () => { subscriptionData?.([session({ id: "session-2" })]); });
      expect(startNativeLoneWorker).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status").textContent).toContain("Confirmando cierre de vigilancia");
    } finally {
      await act(async () => { pending.finish({ stopped: true }); });
    }
    expect(startNativeLoneWorker).toHaveBeenLastCalledWith(expect.objectContaining({
      projectId: "project-2", sessionId: "session-2",
    }));
  });

  it("coalesces logout cleanup and exposes a late stop failure while still mounted", async () => {
    const view = render(<NativeLoneWorkerBridge />);
    await act(async () => { subscriptionData?.([session()]); });
    const pending = deferredStop();
    stopNativeLoneWorker.mockReturnValue(pending.promise);
    mockUser = null;
    try {
      await act(async () => { view.rerender(<NativeLoneWorkerBridge />); });
      expect(stopNativeLoneWorker).toHaveBeenCalledOnce();
    } finally {
      await act(async () => { pending.finish({ stopped: false, reason: "native_error", error: "private disk" }); });
    }
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button")).toHaveProperty("disabled", false);
  });

  it("records a late unmount stop failure without creating a visible notice", async () => {
    const view = render(<NativeLoneWorkerBridge />);
    await act(async () => { subscriptionData?.([session()]); });
    const pending = deferredStop();
    stopNativeLoneWorker.mockReturnValueOnce(pending.promise);
    view.unmount();
    await act(async () => { pending.finish({ stopped: false, reason: "native_error", error: "disk" }); });
    expect(logger.error).toHaveBeenCalledWith("native_lone_worker_stop_failed", "disk");
    expect(view.container.innerHTML).toBe("");
  });

  it("waits for the single cleanup stop across a StrictMode remount", async () => {
    const pending = deferredStop();
    stopNativeLoneWorker.mockReturnValue(pending.promise);
    try {
      await act(async () => { render(<StrictMode><NativeLoneWorkerBridge /></StrictMode>); });
      await act(async () => { subscriptionData?.([session()]); });
      expect(stopNativeLoneWorker).toHaveBeenCalledOnce();
      expect(startNativeLoneWorker).not.toHaveBeenCalled();
    } finally {
      await act(async () => { pending.finish({ stopped: true }); });
    }
    expect(startNativeLoneWorker).toHaveBeenCalledOnce();
  });
});

function deferredStop() {
  let finish!: (result: { stopped: boolean; reason?: string; error?: string }) => void;
  const promise = new Promise<{ stopped: boolean; reason?: string; error?: string }>((resolve) => { finish = resolve; });
  return { promise, finish };
}
