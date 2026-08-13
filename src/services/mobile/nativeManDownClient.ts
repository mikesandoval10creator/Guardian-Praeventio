// Praeventio Guard — bridge to the Android-owned ManDown foreground service.
//
// This module registers by native plugin name instead of importing the package's
// generated JS bundle. Capacitor discovers the Android module from Gradle; this
// keeps `tsc --noEmit` independent from a build artefact under packages/*/dist.
// The native service accepts only a server-minted short-lived capability, never
// a Firebase token or persistent project secret.

import { Capacitor, registerPlugin } from "@capacitor/core";

export interface NativeManDownStartOptions {
  projectId: string;
  sessionId: string;
  capability: string;
  /** Server authority boundary; native sampling stops after this instant. */
  capabilityExpiresAt: string;
  apiBaseUrl: string;
  inactivityThresholdMs: number;
  impactThresholdMps2?: number;
  cancelWindowMs?: number;
}

type NativeManDownStatus = { running: boolean; lastError?: string };

type NativeManDownPlugin = {
  start(options: NativeManDownStartOptions): Promise<NativeManDownStatus>;
  stop(): Promise<void>;
};

const NativeManDown = registerPlugin<NativeManDownPlugin>("NativeManDown");

export type NativeManDownApplyResult =
  | { applied: true }
  | {
      applied: false;
      reason: "not_android" | "missing_public_origin" | "native_error";
      error?: string;
    };

/** The native process must call a production HTTPS origin, never capacitor://. */
export function nativeManDownApiOrigin(): string | null {
  // Store builds must remain able to reach Guardian even if VITE_APP_URL was
  // omitted from the frontend bundle. This is the canonical production origin,
  // already bound by Android App Links and deploy configuration; a deployment
  // may still override it with a different HTTPS origin through VITE_APP_URL.
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

export function isAndroidNativeManDown(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function startNativeManDown(
  options: Omit<NativeManDownStartOptions, "apiBaseUrl">,
): Promise<NativeManDownApplyResult> {
  if (!isAndroidNativeManDown())
    return { applied: false, reason: "not_android" };
  const apiBaseUrl = nativeManDownApiOrigin();
  if (!apiBaseUrl) return { applied: false, reason: "missing_public_origin" };
  try {
    const status = await NativeManDown.start({ ...options, apiBaseUrl });
    return status.running
      ? { applied: true }
      : {
          applied: false,
          reason: "native_error",
          error: status.lastError ?? "native_service_not_running",
        };
  } catch (error) {
    return {
      applied: false,
      reason: "native_error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function stopNativeManDown(): Promise<void> {
  if (!isAndroidNativeManDown()) return;
  try {
    await NativeManDown.stop();
  } catch {
    // Stopping a no-longer-running FGS is intentionally idempotent.
  }
}
