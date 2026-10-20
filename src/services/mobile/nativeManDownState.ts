// Coordination between the Android-owned ManDown foreground service and the
// WebView fall detector.
//
// Both can sample acceleration when a lone-worker session is active on
// Android: the native FGS (which keeps running while the WebView is suspended)
// and `FallDetectionMonitor` (Capacitor Motion in the WebView). Running both
// means a single fall can raise TWO emergencies, and — worse — the WebView
// `Motion.stop()` tears down motion listeners app-wide, so starting/stopping
// the WebView detector can kill the native listener.
//
// `NativeManDownBridge` publishes here when it has a CONFIRMED native authority;
// `FallDetectionMonitor` subscribes and yields to the native detector.

type Listener = (active: boolean) => void;

let active = false;
const listeners = new Set<Listener>();

/** Called by NativeManDownBridge when native monitoring is confirmed on/off. */
export function setNativeManDownActive(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // A subscriber must never break the safety bridge.
    }
  }
}

/** Stable getter for `useSyncExternalStore`. */
export function isNativeManDownActive(): boolean {
  return active;
}

/** Stable subscriber for `useSyncExternalStore`. */
export function subscribeNativeManDownActive(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. */
export function __resetNativeManDownStateForTests(): void {
  active = false;
  listeners.clear();
}
