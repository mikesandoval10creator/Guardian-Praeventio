import { registerPlugin } from "@capacitor/core";
import type { NativeLoneWorkerPlugin } from "./definitions";

export const NativeLoneWorker = registerPlugin<NativeLoneWorkerPlugin>(
  "NativeLoneWorker",
  {
    web: () => import("./web").then((m) => new m.NativeLoneWorkerWeb()),
  },
);

export * from "./definitions";
