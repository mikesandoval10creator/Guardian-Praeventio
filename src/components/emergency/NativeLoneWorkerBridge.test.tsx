// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
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
  isAndroidNativeLoneWorker.mockClear();
  mintNativeLoneWorkerCapability.mockResolvedValue({
    sessionId: "session-1",
    capability: "a".repeat(32),
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  startNativeLoneWorker.mockResolvedValue({ applied: true });
  stopNativeLoneWorker.mockResolvedValue(undefined);
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
});
