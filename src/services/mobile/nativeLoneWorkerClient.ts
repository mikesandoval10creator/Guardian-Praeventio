// Praeventio Guard — bridge to the Android-owned ordinary lone-worker service.
//
// The native process receives only a short-lived session capability. It owns
// heartbeat/location scheduling and its durable outbox after the WebView is
// suspended; Firebase credentials never cross this boundary.

import { Capacitor, registerPlugin } from "@capacitor/core";

export interface NativeLoneWorkerStartOptions {
  projectId: string;
  sessionId: string;
  capability: string;
  capabilityExpiresAt: string;
  heartbeatIntervalMs?: number;
}

type NativeLoneWorkerStatus = {
  running: boolean;
  lastHeartbeatAt?: string;
  lastError?: string;
};

type NativeLoneWorkerPlugin = {
  start(options: NativeLoneWorkerStartOptions & { apiBaseUrl: string }): Promise<NativeLoneWorkerStatus>;
  stop(): Promise<void>;
  getStatus(): Promise<NativeLoneWorkerStatus>;
};

const NativeLoneWorker = registerPlugin<NativeLoneWorkerPlugin>("NativeLoneWorker");

export type NativeLoneWorkerApplyResult =
  | { applied: true; lastError?: string }
  | {
      applied: false;
      reason: "not_android" | "missing_public_origin" | "native_error";
      error?: string;
    };

/** The service must call a production HTTPS origin, never capacitor://. */
export function nativeLoneWorkerApiOrigin(): string | null {
  const candidate = (
    (import.meta.env.VITE_APP_URL as string | undefined) ??
    "https://app.praeventio.net"
  ).trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isAndroidNativeLoneWorker(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export async function startNativeLoneWorker(
  options: NativeLoneWorkerStartOptions,
): Promise<NativeLoneWorkerApplyResult> {
  if (!isAndroidNativeLoneWorker()) {
    return { applied: false, reason: "not_android" };
  }
  const apiBaseUrl = nativeLoneWorkerApiOrigin();
  if (!apiBaseUrl) {
    return { applied: false, reason: "missing_public_origin" };
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const status = await Promise.race([
      NativeLoneWorker.start({ ...options, apiBaseUrl }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("native_lone_worker_start_timeout")), 10_000);
      }),
    ]);
    return status.running
      ? { applied: true, ...(status.lastError ? { lastError: status.lastError } : {}) }
      : {
          applied: false,
          reason: "native_error",
          error: status.lastError ?? "native_lone_worker_not_running",
        };
  } catch (error) {
    return {
      applied: false,
      reason: "native_error",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function stopNativeLoneWorker(): Promise<void> {
  if (!isAndroidNativeLoneWorker()) return;
  try {
    await NativeLoneWorker.stop();
  } catch {
    // Explicit stop is idempotent when Android already reclaimed the service.
  }
}

export async function getNativeLoneWorkerStatus(): Promise<NativeLoneWorkerStatus> {
  if (!isAndroidNativeLoneWorker()) return { running: false };
  try {
    return await NativeLoneWorker.getStatus();
  } catch (error) {
    return {
      running: false,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}
