import { WebPlugin } from "@capacitor/core";
import type {
  NativeManDownPlugin,
  NativeManDownStartOptions,
  NativeManDownStatus,
} from "./definitions";

/** Web deliberately cannot claim background execution. */
export class NativeManDownWeb extends WebPlugin implements NativeManDownPlugin {
  async start(
    _options: NativeManDownStartOptions,
  ): Promise<NativeManDownStatus> {
    return { running: false, lastError: "native_man_down_unavailable_on_web" };
  }
  async stop(): Promise<void> {}
  async getStatus(): Promise<NativeManDownStatus> {
    return { running: false, lastError: "native_man_down_unavailable_on_web" };
  }
}
