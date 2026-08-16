import type { PluginListenerHandle } from "@capacitor/core";

export interface BatteryOptimizationPlugin {
  /**
   * Returns true if the OS battery-optimization list already excludes our
   * package. Always true on iOS / web (no battery-optimization gate there).
   */
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;

  /**
   * Opens the system Settings page where the user can flip the exemption
   * toggle for our package. Returns true if the intent was dispatched
   * (user may still deny), false if the platform rejected the intent.
   *
   * Android does NOT report whether the user actually flipped the toggle;
   * the caller should re-query `isIgnoringBatteryOptimizations` after the
   * user returns to the app.
   */
  openRequestIgnoreBatteryOptimizations(): Promise<{ opened: boolean }>;
}