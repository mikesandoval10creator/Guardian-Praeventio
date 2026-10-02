// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  native: false,
  checkPermissions: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => platform.native },
}));
vi.mock("@capacitor/geolocation", () => ({
  Geolocation: { checkPermissions: platform.checkPermissions },
}));

import { useGeofence } from "./useGeofence";

const watchPosition = vi.fn<Geolocation["watchPosition"]>(() => 42);
const clearWatch = vi.fn();

function gpsError(code: 1 | 2 | 3): GeolocationPositionError {
  return {
    code,
    message: "GPS test error",
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };
}

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
  platform.native = false;
  platform.checkPermissions.mockReset();
  watchPosition.mockReset().mockReturnValue(42);
  clearWatch.mockReset();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition, clearWatch },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useGeofence GPS availability", () => {
  it("degrades after eight seconds when the GPS invokes neither callback", () => {
    const { result } = renderHook(() => useGeofence([]));
    expect(watchPosition).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(7_999));
    expect(result.current.permissionState).toBe("pending");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.permissionState).toBe("unavailable");
    expect(result.current.currentLocation).toBeNull();
    expect(clearWatch).not.toHaveBeenCalled();
  });

  it("surfaces an explicit GPS timeout without waiting for the watchdog", () => {
    const { result } = renderHook(() => useGeofence([]));
    act(() => watchPosition.mock.calls[0][1]?.(gpsError(3)));
    expect(result.current.permissionState).toBe("unavailable");
  });

  it("ignores callbacks retained by a disposed project watcher", () => {
    const onZonesChanged = vi.fn();
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useGeofence([], onZonesChanged, scopeKey),
      { initialProps: { scopeKey: "tenant:project-a" } },
    );
    const [oldSuccess, oldError] = watchPosition.mock.calls[0];
    rerender({ scopeKey: "tenant:project-b" });

    act(() => oldSuccess(position()));
    act(() => oldError?.(gpsError(1)));
    expect(onZonesChanged).not.toHaveBeenCalled();
    expect(result.current.permissionState).toBe("pending");
    expect(result.current.currentLocation).toBeNull();
  });

  it("resets a previous project fix before waiting for the new project GPS", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useGeofence([], undefined, scopeKey),
      { initialProps: { scopeKey: "project-a" } },
    );
    act(() => watchPosition.mock.calls[0][0](position()));
    expect(result.current.permissionState).toBe("granted");
    rerender({ scopeKey: "project-b" });
    expect(result.current.permissionState).toBe("pending");
    expect(result.current.currentLocation).toBeNull();
    act(() => vi.advanceTimersByTime(8_000));
    expect(result.current.permissionState).toBe("unavailable");
  });

  it("recovers from watchdog degradation when a delayed first fix arrives", () => {
    const { result } = renderHook(() => useGeofence([]));
    act(() => vi.advanceTimersByTime(8_000));
    expect(result.current.permissionState).toBe("unavailable");
    act(() => watchPosition.mock.calls[0][0](position()));
    expect(result.current.permissionState).toBe("granted");
    expect(result.current.currentLocation).toEqual({ lat: -33.5, lng: -70.5 });
  });

  it("cancels the watchdog on a successful first fix", () => {
    const { result } = renderHook(() => useGeofence([]));
    act(() => watchPosition.mock.calls[0][0](position()));
    act(() => vi.advanceTimersByTime(8_000));
    expect(result.current.permissionState).toBe("granted");
  });

  it("does not overwrite a permission denial when the watchdog deadline passes", () => {
    const { result } = renderHook(() => useGeofence([]));
    act(() => watchPosition.mock.calls[0][1]?.(gpsError(1)));
    act(() => vi.advanceTimersByTime(8_000));
    expect(result.current.permissionState).toBe("denied");
  });

  it("clears the watcher and watchdog on unmount and ignores retained callbacks", () => {
    const onZonesChanged = vi.fn();
    const { unmount } = renderHook(() => useGeofence([], onZonesChanged));
    const [success, error] = watchPosition.mock.calls[0];
    unmount();
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(vi.getTimerCount()).toBe(0);
    act(() => success(position()));
    act(() => error?.(gpsError(3)));
    expect(onZonesChanged).not.toHaveBeenCalled();
  });

  it("gives a replacement project watcher its own full first-fix deadline", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useGeofence([], undefined, scopeKey),
      { initialProps: { scopeKey: "project-a" } },
    );
    act(() => vi.advanceTimersByTime(7_000));
    rerender({ scopeKey: "project-b" });
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.permissionState).toBe("pending");
    act(() => vi.advanceTimersByTime(7_000));
    expect(result.current.permissionState).toBe("unavailable");
  });

  it("does not degrade intentional waiting at the native disclosure gate", async () => {
    localStorage.clear();
    platform.native = true;
    platform.checkPermissions.mockResolvedValue({ location: "prompt" });
    const { result } = renderHook(() => useGeofence([]));
    await act(async () => undefined);
    act(() => vi.advanceTimersByTime(60_000));
    expect(watchPosition).not.toHaveBeenCalled();
    expect(result.current.permissionState).toBe("pending");
  });
});
