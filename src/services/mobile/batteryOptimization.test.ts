// SPDX-License-Identifier: MIT
// MASVS-LIFE-SAFETY — Android foreground-service battery-optimization gate.
//
// The lone-worker check-in FGS can be killed within minutes of the screen
// turning off on Xiaomi / Huawei / Samsung if the app is on the OS
// battery-optimization list. The helper in src/services/mobile/batteryOptimization.ts
// queries PowerManager.isIgnoringBatteryOptimizations and opens the Settings
// intent for the user to flip the toggle. These tests pin both branches
// (already-exempt / not-exempt) plus the no-bridge path (web/iOS) and the
// bridge-throw failure mode.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setBatteryOptimizationBridge,
  getBatteryOptimizationStatus,
  requestBatteryOptimizationExclusion,
  shouldPromptForBatteryExclusion,
} from "./batteryOptimization";

const fakeBridge = () =>
  ({
    isIgnoringBatteryOptimizations: vi.fn(async () => true),
    openRequestIgnoreBatteryOptimizations: vi.fn(async () => true),
  }) as const;

describe("batteryOptimization — status query", () => {
  beforeEach(() => {
    __setBatteryOptimizationBridge(null);
  });
  afterEach(() => {
    __setBatteryOptimizationBridge(null);
  });

  it("returns 'unavailable' when no bridge is installed (web/iOS)", async () => {
    const status = await getBatteryOptimizationStatus();
    expect(status).toBe("unavailable");
  });

  it("returns 'already-exempt' when the bridge says ignoring=true", async () => {
    __setBatteryOptimizationBridge({
      isIgnoringBatteryOptimizations: async () => true,
      openRequestIgnoreBatteryOptimizations: async () => true,
    });
    expect(await getBatteryOptimizationStatus()).toBe("already-exempt");
  });

  it("returns 'not-exempt' when the bridge says ignoring=false", async () => {
    __setBatteryOptimizationBridge({
      isIgnoringBatteryOptimizations: async () => false,
      openRequestIgnoreBatteryOptimizations: async () => true,
    });
    expect(await getBatteryOptimizationStatus()).toBe("not-exempt");
  });

  it("returns 'unavailable' (NOT 'already-exempt') when the bridge throws — never silently mask a real OS failure", async () => {
    __setBatteryOptimizationBridge({
      isIgnoringBatteryOptimizations: async () => {
        throw new Error("PowerManager IPC denied");
      },
      openRequestIgnoreBatteryOptimizations: async () => true,
    });
    // The bridge threw — the helper MUST surface that as "unavailable" so the
    // caller decides whether to fall back to a degraded path. Silently
    // treating it as "already exempt" would hide an OS-level failure that
    // affects field devices (some Xiaomi battery-saver modes strip the IPC).
    expect(await getBatteryOptimizationStatus()).toBe("unavailable");
  });
});

describe("batteryOptimization — shouldPromptForBatteryExclusion policy", () => {
  beforeEach(() => __setBatteryOptimizationBridge(null));
  afterEach(() => __setBatteryOptimizationBridge(null));

  it("returns false when no bridge is installed (web/iOS — never badger)", async () => {
    expect(await shouldPromptForBatteryExclusion()).toBe(false);
  });

  it("returns true only when status is 'not-exempt'", async () => {
    __setBatteryOptimizationBridge({
      isIgnoringBatteryOptimizations: async () => false,
      openRequestIgnoreBatteryOptimizations: async () => true,
    });
    expect(await shouldPromptForBatteryExclusion()).toBe(true);

    __setBatteryOptimizationBridge({
      isIgnoringBatteryOptimizations: async () => true,
      openRequestIgnoreBatteryOptimizations: async () => true,
    });
    expect(await shouldPromptForBatteryExclusion()).toBe(false);
  });
});

describe("batteryOptimization — requestBatteryOptimizationExclusion", () => {
  beforeEach(() => __setBatteryOptimizationBridge(null));
  afterEach(() => __setBatteryOptimizationBridge(null));

  it("returns false when no bridge is installed", async () => {
    expect(await requestBatteryOptimizationExclusion()).toBe(false);
  });

  it("forwards to the bridge and returns its result", async () => {
    const bridge = fakeBridge();
    bridge.openRequestIgnoreBatteryOptimizations.mockResolvedValueOnce(true);
    __setBatteryOptimizationBridge(bridge);
    expect(await requestBatteryOptimizationExclusion()).toBe(true);
    expect(bridge.openRequestIgnoreBatteryOptimizations).toHaveBeenCalledTimes(1);
  });

  it("returns false (does NOT throw) when the bridge throws — caller logs and degrades", async () => {
    __setBatteryOptimizationBridge({
      isIgnoringBatteryOptimizations: async () => true,
      openRequestIgnoreBatteryOptimizations: async () => {
        throw new Error("OEM stripped the intent");
      },
    });
    // The caller (LoneWorker page) treats a `false` return as a soft failure
    // and tells the user to navigate Settings manually. The helper MUST NOT
    // propagate the exception — that would crash the page on a Xiaomi.
    expect(await requestBatteryOptimizationExclusion()).toBe(false);
  });
});