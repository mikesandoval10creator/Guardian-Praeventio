import { registerPlugin } from "@capacitor/core";
import type { NativeManDownPlugin } from "./definitions";

export const NativeManDown = registerPlugin<NativeManDownPlugin>(
  "NativeManDown",
  {
    web: () => import("./web").then((m) => new m.NativeManDownWeb()),
  },
);

export * from "./definitions";
