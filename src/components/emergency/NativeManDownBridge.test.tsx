// @vitest-environment jsdom
// Global lifecycle contract: this bridge survives route changes because it is
// mounted above Routes. It starts native sampling only for the authenticated
// worker's own active session and stops it when that session disappears.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { LoneWorkerSession } from "../../services/loneWorker/loneWorkerService";
import { logger } from "../../utils/logger";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

let subscriber: ((sessions: LoneWorkerSession[]) => void) | null = null;
let onSubscriptionError: ((error: unknown) => void) | undefined;
let selectedProject: {
  id: string;
  settings?: { manDownInactivityThreshold?: number };
} | null = null;
let user: { uid: string } | null = null;

const mintNativeManDownCapability = vi.fn();
const startNativeManDown = vi.fn();
const stopNativeManDown = vi.fn();
const isAndroidNativeManDown = vi.fn();

vi.mock("../../contexts/FirebaseContext", () => ({
  useFirebase: () => ({ user }),
}));
vi.mock("../../contexts/ProjectContext", () => ({
  useProject: () => ({ selectedProject }),
}));
vi.mock("../../services/loneWorker/loneWorkerStore", () => ({
  subscribeActiveLoneWorkerSessions: (
    _projectId: string,
    onData: (sessions: LoneWorkerSession[]) => void,
    onError?: (error: unknown) => void,
  ) => {
    subscriber = onData;
    onSubscriptionError = onError;
    return () => {
      subscriber = null;
      onSubscriptionError = undefined;
    };
  },
}));
vi.mock("../../hooks/useLoneWorker", () => ({
  mintNativeManDownCapability: (...args: unknown[]) =>
    mintNativeManDownCapability(...args),
}));
vi.mock("../../services/mobile/nativeManDownClient", () => ({
  isAndroidNativeManDown: () => isAndroidNativeManDown(),
  startNativeManDown: (...args: unknown[]) => startNativeManDown(...args),
  stopNativeManDown: () => stopNativeManDown(),
}));
vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { NativeManDownBridge } from "./NativeManDownBridge";

function activeSession(
  overrides: Partial<LoneWorkerSession> = {},
): LoneWorkerSession {
  return {
    id: "session-1",
    workerUid: "worker-1",
    status: "active",
    startedAt: new Date().toISOString(),
    checkInIntervalMin: 15,
    checkIns: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stopNativeManDown.mockReset();
  mintNativeManDownCapability.mockReset();
  subscriber = null;
  selectedProject = {
    id: "project-1",
    settings: { manDownInactivityThreshold: 45_000 },
  };
  user = { uid: "worker-1" };
  isAndroidNativeManDown.mockReturnValue(true);
  mintNativeManDownCapability.mockResolvedValue({
    sessionId: "session-1",
    capability: "x".repeat(43),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  startNativeManDown.mockResolvedValue({ applied: true });
  stopNativeManDown.mockResolvedValue({ stopped: true });
});

afterEach(async () => {
  await act(async () => cleanup());
});

describe("<NativeManDownBridge />", () => {
  it("starts native monitoring for the authenticated worker after navigating away from Emergencia", async () => {
    render(
      <>
        <span data-testid="other-route">otro módulo</span>
        <NativeManDownBridge />
      </>,
    );
    expect(subscriber).not.toBeNull();

    await act(async () =>
      subscriber?.([
        activeSession(),
        activeSession({ id: "other", workerUid: "other-worker" }),
      ]),
    );

    await waitFor(() =>
      expect(mintNativeManDownCapability).toHaveBeenCalledWith(
        "project-1",
        "session-1",
      ),
    );
    expect(startNativeManDown).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        sessionId: "session-1",
        inactivityThresholdMs: 45_000,
      }),
    );
  });

  it("continues native monitoring when the session becomes overdue, and stops only after explicit end", async () => {
    render(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession()]));
    await waitFor(() => expect(startNativeManDown).toHaveBeenCalledTimes(1));

    await act(async () =>
      subscriber?.([activeSession({ status: "overdue_critical" })]),
    );
    // The session ID is unchanged, so the already-running FGS stays alive;
    // it must not be restarted or stopped just because status escalated.
    await waitFor(() => expect(startNativeManDown).toHaveBeenCalledTimes(1));
    expect(stopNativeManDown).not.toHaveBeenCalled();

    await act(async () =>
      subscriber?.([
        activeSession({ status: "ended", endedAt: new Date().toISOString() }),
      ]),
    );
    await waitFor(() => expect(stopNativeManDown).toHaveBeenCalled());
  });

  it("stops native monitoring when a successful subscription confirms the session is absent", async () => {
    const view = render(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession()]));
    await waitFor(() => expect(startNativeManDown).toHaveBeenCalled());
    stopNativeManDown.mockClear();

    await act(async () => subscriber?.([]));
    await waitFor(() => expect(stopNativeManDown).toHaveBeenCalled());

    await act(async () =>
      onSubscriptionError?.(new Error("permission-denied")),
    );
    expect(view.container).toBeEmptyDOMElement();
  });

  it("preserves existing native protection while the first session read is unknown or fails", async () => {
    render(<NativeManDownBridge />);
    expect(stopNativeManDown).not.toHaveBeenCalled();
    await act(async () => onSubscriptionError?.(new Error("unavailable")));
    expect(stopNativeManDown).not.toHaveBeenCalled();
    expect(mintNativeManDownCapability).not.toHaveBeenCalled();
    await act(async () => subscriber?.([]));
    expect(stopNativeManDown).toHaveBeenCalledTimes(1);
  });

  it("does not stop or renew native protection when an active session read fails", async () => {
    render(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession()]));
    stopNativeManDown.mockClear();
    await act(async () => onSubscriptionError?.(new Error("unavailable")));
    expect(stopNativeManDown).not.toHaveBeenCalled();
    expect(startNativeManDown).toHaveBeenCalledTimes(1);
    expect(mintNativeManDownCapability).toHaveBeenCalledTimes(1);
    await act(async () => subscriber?.([]));
    expect(stopNativeManDown).toHaveBeenCalledTimes(1);
  });

  it.each(["project", "worker"])("does not reuse the previous session after changing %s", async (identity) => {
    const view = render(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession()]));
    stopNativeManDown.mockClear();
    if (identity === "project") selectedProject = { id: "project-2" };
    else user = { uid: "worker-2" };
    await act(async () => view.rerender(<NativeManDownBridge />));
    expect(mintNativeManDownCapability).toHaveBeenCalledTimes(1);
    expect(stopNativeManDown).toHaveBeenCalledTimes(1);
    await act(async () => subscriber?.([activeSession({ id: "session-2", workerUid: user!.uid })]));
    expect(mintNativeManDownCapability).toHaveBeenLastCalledWith(selectedProject!.id, "session-2");
    expect(startNativeManDown).toHaveBeenCalledTimes(2);
  });

  it("ignores data and errors from an unsubscribed identity", async () => {
    const view = render(<NativeManDownBridge />);
    const staleData = subscriber;
    const staleError = onSubscriptionError;
    selectedProject = { id: "project-2" };
    view.rerender(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession({ id: "session-2" })]));
    stopNativeManDown.mockClear();
    await act(async () => {
      staleData?.([]);
      staleError?.(new Error("unavailable"));
    });
    expect(stopNativeManDown).not.toHaveBeenCalled();
    expect(startNativeManDown).toHaveBeenCalledTimes(1);
  });

  it("stops on logout and ignores a capability arriving after that boundary", async () => {
    let resolveMint!: (value: { capability: string; expiresAt: string }) => void;
    mintNativeManDownCapability.mockImplementationOnce(() => new Promise((resolve) => { resolveMint = resolve; }));
    const view = render(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession()]));
    stopNativeManDown.mockClear();
    user = null;
    view.rerender(<NativeManDownBridge />);
    await act(async () => resolveMint({ capability: "x".repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    expect(stopNativeManDown).toHaveBeenCalledTimes(1);
    expect(startNativeManDown).not.toHaveBeenCalled();
  });

  it("waits for the previous identity stop before starting its replacement", async () => {
    const view = render(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession()]));
    let resolveStop!: (result: { stopped: true }) => void;
    stopNativeManDown.mockImplementationOnce(() => new Promise<{ stopped: true }>((resolve) => { resolveStop = resolve; }));
    selectedProject = { id: "project-2" };
    view.rerender(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession({ id: "session-2" })]));
    try {
      expect(mintNativeManDownCapability).toHaveBeenCalledTimes(1);
      expect(startNativeManDown).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => resolveStop?.({ stopped: true }));
    }
    expect(startNativeManDown).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "project-2", sessionId: "session-2" }));
  });

  it("preserves native protection when React unmounts without ending the session", async () => {
    const view = render(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession()]));
    stopNativeManDown.mockClear();
    await act(async () => view.unmount());
    expect(stopNativeManDown).not.toHaveBeenCalled();
  });

  it("does not stop restored protection during StrictMode replay or a failed first read", async () => {
    render(<StrictMode><NativeManDownBridge /></StrictMode>);
    await act(async () => onSubscriptionError?.(new Error("unavailable")));
    expect(stopNativeManDown).not.toHaveBeenCalled();
    expect(startNativeManDown).not.toHaveBeenCalled();
  });

  it("is an honest no-op on web: it never mints a native authority", async () => {
    isAndroidNativeManDown.mockReturnValue(false);
    render(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession()]));
    expect(mintNativeManDownCapability).not.toHaveBeenCalled();
    expect(startNativeManDown).not.toHaveBeenCalled();
  });

  it("keeps a failed stop visible across rerenders without disclosing native diagnostics", async () => {
    stopNativeManDown.mockResolvedValue({ stopped: false, reason: "native_error", error: "private disk path" });
    const view = render(<NativeManDownBridge />);
    await act(async () => subscriber?.([]));
    expect(screen.getByRole("alert")).toHaveTextContent("Cierre de ManDown pendiente");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private disk path");
    view.rerender(<NativeManDownBridge />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(stopNativeManDown).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("native_mandown_stop_failed", "private disk path");
  });

  it("coalesces retries and clears the warning only after a confirmed native stop", async () => {
    stopNativeManDown.mockResolvedValueOnce({ stopped: false, reason: "native_error", error: "disk" });
    render(<NativeManDownBridge />);
    await act(async () => subscriber?.([]));
    const pending = deferredStop();
    stopNativeManDown.mockReturnValueOnce(pending.promise);
    try {
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reintentar cierre de ManDown" })));
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button")).toBeDisabled();
      fireEvent.click(screen.getByRole("button"));
      expect(stopNativeManDown).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => pending.finish({ stopped: true }));
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks retry while session state is unknown, failed or active", async () => {
    stopNativeManDown.mockResolvedValueOnce({ stopped: false, reason: "native_error", error: "disk" });
    const view = render(<NativeManDownBridge />);
    await act(async () => subscriber?.([]));
    selectedProject = { id: "project-2" };
    stopNativeManDown.mockResolvedValue({ stopped: false, reason: "native_error", error: "disk" });
    await act(async () => view.rerender(<NativeManDownBridge />));
    expect(screen.getByRole("button")).toBeDisabled();
    const calls = stopNativeManDown.mock.calls.length;
    await act(async () => onSubscriptionError?.(new Error("unavailable")));
    fireEvent.click(screen.getByRole("button"));
    expect(stopNativeManDown).toHaveBeenCalledTimes(calls);
    await act(async () => subscriber?.([activeSession({ id: "replacement" })]));
    expect(screen.getByRole("button")).toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(stopNativeManDown).toHaveBeenCalledTimes(calls);
  });

  it("coalesces logout stops and displays a late failure while mounted", async () => {
    const view = render(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession()]));
    const pending = deferredStop();
    stopNativeManDown.mockReturnValue(pending.promise);
    try {
      user = null;
      await act(async () => view.rerender(<NativeManDownBridge />));
      expect(stopNativeManDown).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent("Confirmando cierre de ManDown");
    } finally {
      await act(async () => pending.finish({ stopped: false, reason: "native_error", error: "disk" }));
    }
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("logs a late failure after unmount without requesting another stop", async () => {
    const pending = deferredStop();
    stopNativeManDown.mockReturnValueOnce(pending.promise);
    const view = render(<NativeManDownBridge />);
    await act(async () => subscriber?.([]));
    await act(async () => view.unmount());
    await act(async () => pending.finish({ stopped: false, reason: "native_error", error: "late disk" }));
    expect(logger.error).toHaveBeenCalledWith("native_mandown_stop_failed", "late disk");
    expect(stopNativeManDown).toHaveBeenCalledTimes(1);
  });

  it("reports unexpected stop rejections without leaving an unhandled promise", async () => {
    stopNativeManDown.mockRejectedValueOnce(new Error("unexpected native fault"));
    render(<NativeManDownBridge />);
    await act(async () => subscriber?.([]));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(logger.error).toHaveBeenCalledWith("native_mandown_stop_failed", "unexpected native fault");
  });
});

function deferredStop() {
  let finish!: (result: { stopped: boolean; reason?: string; error?: string }) => void;
  const promise = new Promise<{ stopped: boolean; reason?: string; error?: string }>((resolve) => { finish = resolve; });
  return { promise, finish };
}
