import { WebPlugin } from "@capacitor/core";
import type {
  NativeLoneWorkerPlugin,
  NativeLoneWorkerStartOptions,
  NativeLoneWorkerStatus,
} from "./definitions";

export class NativeLoneWorkerWeb extends WebPlugin implements NativeLoneWorkerPlugin {
  async start(_options: NativeLoneWorkerStartOptions): Promise<NativeLoneWorkerStatus> {
    return { running: false, lastError: "native_lone_worker_unavailable_on_web" };
  }

  async stop(): Promise<void> {
    // Deliberate no-op on web/iOS.
  }

  async getStatus(): Promise<NativeLoneWorkerStatus> {
    return { running: false };
  }
}
