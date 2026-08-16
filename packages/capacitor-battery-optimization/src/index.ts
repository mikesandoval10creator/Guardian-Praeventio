import { registerPlugin } from "@capacitor/core";
import type { BatteryOptimizationPlugin } from "./definitions";

export const BatteryOptimization = registerPlugin<BatteryOptimizationPlugin>(
  "BatteryOptimization",
  {
    web: () => import("./web").then((m) => new m.BatteryOptimizationWeb()),
  },
);

export * from "./definitions";