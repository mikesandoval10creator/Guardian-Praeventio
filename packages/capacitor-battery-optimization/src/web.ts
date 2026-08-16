import { WebPlugin } from "@capacitor/core";
import type { BatteryOptimizationPlugin } from "./definitions";

/**
 * Web deliberately cannot put the app on a battery-optimization exemption
 * list — there is no such gate in browsers. Both queries return "already
 * exempt" so the call sites in the web/iOS code paths gracefully skip the
 * "request exemption" prompt. The FGS start path is a no-op on web anyway
 * (foregroundServiceClient.ts platform guard), so battery optimization is
 * only relevant on Android.
 */
export class BatteryOptimizationWeb extends WebPlugin implements BatteryOptimizationPlugin {
  async isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }> {
    return { ignoring: true };
  }

  async openRequestIgnoreBatteryOptimizations(): Promise<{ opened: boolean }> {
    return { opened: true };
  }
}