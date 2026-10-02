// @vitest-environment jsdom

import React, { type PropsWithChildren } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  projectId: "project-a",
  addNotification: vi.fn(),
  emit: vi.fn(async () => undefined),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock("../../contexts/ProjectContext", () => ({
  useProject: () => ({
    selectedProject: { id: H.projectId, settings: { geofences: [] } },
  }),
}));
vi.mock("../../contexts/FirebaseContext", () => ({
  useFirebase: () => ({ user: { uid: "worker-1" } }),
}));
vi.mock("../../contexts/NotificationContext", () => ({
  useNotifications: () => ({ addNotification: H.addNotification }),
}));
vi.mock("../../hooks/useRestrictedZones", () => ({
  listRestrictedZonesBySite: vi.fn(async () => ({ zones: [] })),
}));
vi.mock("../../services/firebase", () => ({
  db: {},
  auth: { currentUser: { tenantId: "tenant-1" } },
  serverTimestamp: vi.fn(),
}));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  addDoc: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn(),
}));
vi.mock("../../services/systemEngine/eventLog", () => ({
  buildEnvelope: vi.fn(),
  emit: H.emit,
}));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: PropsWithChildren) => children,
  motion: { div: ({ children }: PropsWithChildren) => <div>{children}</div> },
}));

import { GeofenceAlert } from "./GeofenceAlert";

const watchPosition = vi.fn<Geolocation["watchPosition"]>(() => 42);
const clearWatch = vi.fn();
const unavailableNotice = {
  title: "Geolocalización no disponible",
  message:
    "Tu dispositivo no permite ubicación en este momento. La geocerca no está activa.",
  type: "error",
};

function position(): GeolocationPosition {
  return {
    coords: {
      latitude: -33.5,
      longitude: -70.5,
      accuracy: 5,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  H.projectId = "project-a";
  H.addNotification.mockClear();
  H.emit.mockClear();
  watchPosition.mockClear();
  clearWatch.mockClear();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition, clearWatch },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GeofenceAlert with the real GPS hook and event wrapper", () => {
  it("notifies the worker when a silent GPS reaches the first-fix deadline", async () => {
    await act(async () => {
      render(<GeofenceAlert />);
    });
    act(() => vi.advanceTimersByTime(7_999));
    expect(H.addNotification).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(H.addNotification).toHaveBeenCalledExactlyOnceWith(
      unavailableNotice,
    );
    expect(H.emit).not.toHaveBeenCalled();
  });

  it("notifies a new project failure even when the previous project never recovered", async () => {
    const view = render(<GeofenceAlert />);
    await act(async () => undefined);
    act(() => vi.advanceTimersByTime(8_000));
    expect(H.addNotification).toHaveBeenCalledTimes(1);
    H.projectId = "project-b";
    view.rerender(<GeofenceAlert />);
    await act(async () => undefined);
    act(() => vi.advanceTimersByTime(8_000));
    expect(H.addNotification).toHaveBeenCalledTimes(2);
    expect(H.addNotification).toHaveBeenLastCalledWith(unavailableNotice);
  });

  it("notifies once per failure episode on the same GPS watcher", async () => {
    await act(async () => {
      render(<GeofenceAlert />);
    });
    const [success, error] = watchPosition.mock.calls.at(-1)!;
    const timeout: GeolocationPositionError = {
      code: 3,
      message: "GPS timeout",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    };
    act(() => error?.(timeout));
    act(() => error?.(timeout));
    expect(H.addNotification).toHaveBeenCalledTimes(1);
    act(() => success(position()));
    act(() => error?.(timeout));
    expect(H.addNotification).toHaveBeenCalledTimes(2);
    expect(H.addNotification).toHaveBeenLastCalledWith(unavailableNotice);
    expect(H.emit).not.toHaveBeenCalled();
  });

  it("notifies again on a new GPS failure after recovery", async () => {
    const view = render(<GeofenceAlert />);
    await act(async () => undefined);
    act(() => vi.advanceTimersByTime(8_000));
    expect(H.addNotification).toHaveBeenCalledTimes(1);
    act(() => watchPosition.mock.calls.at(-1)![0](position()));

    H.projectId = "project-b";
    await act(async () => {
      view.rerender(<GeofenceAlert />);
    });
    act(() => vi.advanceTimersByTime(8_000));
    expect(H.addNotification).toHaveBeenCalledTimes(2);
    expect(H.addNotification).toHaveBeenLastCalledWith(unavailableNotice);
    expect(H.emit).not.toHaveBeenCalled();
  });
});
