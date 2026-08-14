import type { PluginListenerHandle } from "@capacitor/core";

export interface NativeManDownStartOptions {
  projectId: string;
  sessionId: string;
  /** Opaque capability issued by the authenticated server for this open session. */
  capability: string;
  /** Same-origin API base, e.g. https://app.praeventio.net. */
  apiBaseUrl: string;
  /** Server capability expiry; native sampling stops at this authority boundary. */
  capabilityExpiresAt: string;
  inactivityThresholdMs: number;
  impactThresholdMps2?: number;
  /** Worker-visible confirmation window before a suspected event becomes alert. */
  cancelWindowMs?: number;
}

export interface NativeManDownStatus {
  running: boolean;
  lastReportAt?: string;
  lastError?: string;
}

export interface NativeManDownPlugin {
  start(options: NativeManDownStartOptions): Promise<NativeManDownStatus>;
  stop(): Promise<void>;
  getStatus(): Promise<NativeManDownStatus>;
  addListener(
    eventName:
      | "nativeManDownSuspected"
      | "nativeManDownExpired"
      | "nativeManDownCancelled"
      | "nativeManDownError",
    listener: (event: {
      kind?: "impact" | "inactivity";
      deadlineMs?: number;
      error?: string;
    }) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
