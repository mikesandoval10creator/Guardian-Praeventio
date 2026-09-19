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

import { useSpeedMonitor } from "./speedTrigger";
import {
  acknowledgeLocationDisclosure,
  notifyLocationPermissionGateSettled,
} from "../location/locationPermissionRequest";

const watchPosition = vi.fn(() => 77);
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

describe("useSpeedMonitor prominent-disclosure gate", () => {
  it("does not start its native GPS watcher before disclosure acknowledgement", async () => {
    const { result } = renderHook(() => useSpeedMonitor(true));

    await waitFor(() =>
      expect(nativePermissionMock.checkPermissions).toHaveBeenCalled(),
    );
    expect(watchPosition).not.toHaveBeenCalled();
    expect(result.current.isStale).toBe(true);
  });

  it("starts after the disclosure-owned permission prompt settles", async () => {
    renderHook(() => useSpeedMonitor(true));
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

  it("starts immediately when native location permission already exists", async () => {
    nativePermissionMock.checkPermissions.mockResolvedValue({
      location: "granted",
      coarseLocation: "granted",
    });

    renderHook(() => useSpeedMonitor(true));

    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
  });
});
