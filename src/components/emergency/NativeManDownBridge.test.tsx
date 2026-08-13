// @vitest-environment jsdom
// Global lifecycle contract: this bridge survives route changes because it is
// mounted above Routes. It starts native sampling only for the authenticated
// worker's own active session and stops it when that session disappears.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { LoneWorkerSession } from "../../services/loneWorker/loneWorkerService";

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
  stopNativeManDown.mockResolvedValue(undefined);
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
    // Ignore the defensive stop emitted on the initial no-session mount.
    stopNativeManDown.mockClear();

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

  it("stops native monitoring when the active session ends or the subscription becomes unavailable", async () => {
    const view = render(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession()]));
    await waitFor(() => expect(startNativeManDown).toHaveBeenCalled());

    await act(async () => subscriber?.([]));
    await waitFor(() => expect(stopNativeManDown).toHaveBeenCalled());

    await act(async () =>
      onSubscriptionError?.(new Error("permission-denied")),
    );
    expect(view.container).toBeEmptyDOMElement();
  });

  it("is an honest no-op on web: it never mints a native authority", async () => {
    isAndroidNativeManDown.mockReturnValue(false);
    render(<NativeManDownBridge />);
    await act(async () => subscriber?.([activeSession()]));
    expect(mintNativeManDownCapability).not.toHaveBeenCalled();
    expect(startNativeManDown).not.toHaveBeenCalled();
  });
});
