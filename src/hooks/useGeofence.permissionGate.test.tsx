// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nativePermissionMock = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock("@capacitor/geolocation", () => ({
  Geolocation: { checkPermissions: nativePermissionMock.checkPermissions },
}));

import { useGeofence, type GeofenceZone } from "./useGeofence";
import {
  acknowledgeLocationDisclosure,
  notifyLocationPermissionGateSettled,
} from "../services/location/locationPermissionRequest";

const ZONE: GeofenceZone = {
  id: "zone-a",
  name: "Zona A",
  type: "RESTRICTED",
  coordinates: [
    [
      [-71, -34],
      [-70, -34],
      [-70, -33],
      [-71, -33],
      [-71, -34],
    ],
  ],
};

const watchPosition = vi.fn(() => 42);
const clearWatch = vi.fn();

beforeEach(() => {
  localStorage.clear();
  watchPosition.mockClear();
  clearWatch.mockClear();
  nativePermissionMock.checkPermissions.mockReset().mockResolvedValue({
    location: "prompt",
    coarseLocation: "prompt",
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition, clearWatch },
  });
});

describe("useGeofence prominent-disclosure gate", () => {
  it("does not start a native watcher before disclosure acknowledgement", async () => {
    const { result } = renderHook(() => useGeofence([ZONE]));

    await waitFor(() =>
      expect(nativePermissionMock.checkPermissions).toHaveBeenCalled(),
    );
    expect(watchPosition).not.toHaveBeenCalled();
    expect(result.current.permissionState).toBe("pending");
  });

  it("starts the deferred watcher after the gate-owned permission prompt settles", async () => {
    renderHook(() => useGeofence([ZONE]));
    await waitFor(() =>
      expect(nativePermissionMock.checkPermissions).toHaveBeenCalledTimes(1),
    );
    expect(watchPosition).not.toHaveBeenCalled();

    act(() => {
      acknowledgeLocationDisclosure();
      notifyLocationPermissionGateSettled();
    });

    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
  });

  it("starts immediately when the OS permission was already granted", async () => {
    nativePermissionMock.checkPermissions.mockResolvedValue({
      location: "granted",
      coarseLocation: "granted",
    });

    renderHook(() => useGeofence([ZONE]));

    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
  });
});
