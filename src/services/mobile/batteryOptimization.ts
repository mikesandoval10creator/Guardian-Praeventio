/**
 * Praeventio Guard — Android battery-optimization exclusion helper.
 *
 * Why this exists
 * ───────────────
 * The lone-worker check-in foreground service (foregroundServiceType
 * "location|health") MUST keep running while the worker's phone is in their
 * pocket with the screen off. Xiaomi / Huawei / Samsung / OnePlus ship
 * aggressive battery savers that terminate a foreground service within minutes
 * unless the app is on the OS-level exemption list
 * (`Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`).
 *
 * The system exemption is the ONLY mechanism that survives the user closing
 * recent apps, force-stopping the app, or letting the screen timeout. Without
 * it, the worker believes the session is running, but the OS has silently
 * killed the FGS — so the 5-minute escalation cron never fires, the man-down
 * accelerometer stops sampling, and the worker is invisible to the supervisor.
 *
 * Permissions + manifest
 * ──────────────────────
 * `android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is declared in
 * `android/app/src/main/AndroidManifest.xml`. Play Console accepts it for
 * genuine life-safety apps (we qualify via SOS / man-down / evacuation /
 * gas-alert foreground flows) but rejects apps that request it without a
 * justified use case. The intent to add the app to the exemption list MUST
 * come from a user gesture — Android rejects programmatic exemptions.
 *
 * Lifecycle
 * ─────────
 * The exemption status is queried via `PowerManager.isIgnoringBatteryOptimizations`
 * (API 23+). On older OS versions the query returns `true` because battery
 * optimization is opt-in; we treat those devices as already exempt.
 *
 * Platform guard
 * ──────────────
 * This helper is a no-op on web / iOS — battery optimization is Android-only.
 * Every public function returns a typed result so the call sites can branch
 * on the platform without a try/catch.
 *
 * Testability
 * ───────────
 * The native intent / PowerManager bridge is injected through
 * `__setBatteryOptimizationBridge` so the unit suite can drive the success,
 * failure, and "already exempt" branches without importing the real platform
 * module. The injected bridge is intentionally narrow — only the two methods
 * this helper actually calls.
 */

// The shape of the platform-side helper. The default implementation lives in
// `__setBatteryOptimizationBridge` (set once by the Android entry point);
// tests inject a fake. Keeping the surface tiny (two methods) prevents the
// helper from accidentally growing into a general-purpose bridge module.
export interface BatteryOptimizationBridge {
  /**
   * Returns true if the OS battery optimization list already excludes our
   * package. On iOS/web, returns true (no battery-optimization gate).
   */
  isIgnoringBatteryOptimizations(): Promise<boolean>;

  /**
   * Opens the system Settings page where the user can flip the exemption
   * toggle for our package. Returns true if the user finished the flow
   * (either granted or denied), false if the platform rejected the intent
   * (e.g. Android < 23, OEM that removed the activity, browser that
   * blocks the navigation). On iOS/web, returns true immediately.
   *
   * NOTE: Android does NOT return whether the user actually flipped the
   * toggle. The caller should re-query `isIgnoringBatteryOptimizations`
   * after the user returns to the app.
   */
  openRequestIgnoreBatteryOptimizations(): Promise<boolean>;
}

let bridge: BatteryOptimizationBridge | null = null;

/**
 * Test-only injection point. Production code never calls this; the Android
 * entry point sets a real bridge once on boot. Tests pass a fake that
 * drives the success / failure branches deterministically.
 */
export function __setBatteryOptimizationBridge(
  injected: BatteryOptimizationBridge | null,
): void {
  bridge = injected;
}

/**
 * One-time wiring. Called from the app boot path on Android to bind the
 * helper to the real Capacitor plugin. On web/iOS this is a no-op (the web
 * plugin always reports "already exempt" + "opened: true"). Safe to call
 * multiple times — the last call wins.
 *
 * Implementation note: we wrap the dynamic import in an async IIFE so the
 * TS compiler treats this as an `await import(...)` inside a function body
 * — the same shape that passes typecheck for the other `@praeventio/*`
 * file: deps in the repo (`@praeventio/capacitor-proximity`, etc.). A
 * bare top-level `import("...")` with a `.then()` resolves the module at
 * typecheck time and complains that the file: dep has no built dist in
 * node_modules at install time.
 */
export function installBatteryOptimizationBridge(): void {
  void (async () => {
    try {
      const { BatteryOptimization } = await import(
        "@praeventio/capacitor-battery-optimization"
      );
      bridge = {
        async isIgnoringBatteryOptimizations() {
          return (
            await BatteryOptimization.isIgnoringBatteryOptimizations()
          ).ignoring;
        },
        async openRequestIgnoreBatteryOptimizations() {
          return (
            await BatteryOptimization.openRequestIgnoreBatteryOptimizations()
          ).opened;
        },
      };
    } catch {
      // Plugin not present (web build that tree-shook it out, or test env).
      // Leave bridge as null → calls return "unavailable" → caller no-ops.
    }
  })();
}

export type BatteryOptimizationStatus =
  /** OS already exempts the app — no UI needed. */
  | "already-exempt"
  /** App is NOT exempted — caller should prompt the user. */
  | "not-exempt"
  /** Bridge not available (web / iOS / pre-bridge boot). Treat as no-op. */
  | "unavailable";

/**
 * Read-only status query. The caller decides whether to surface a UI prompt.
 */
export async function getBatteryOptimizationStatus(): Promise<BatteryOptimizationStatus> {
  if (!bridge) return "unavailable";
  try {
    const ignoring = await bridge.isIgnoringBatteryOptimizations();
    return ignoring ? "already-exempt" : "not-exempt";
  } catch {
    // Bridge threw — treat as unknown and let the caller fall back to its
    // own degraded path. We do NOT swallow the error into "already-exempt"
    // because that would silently mask a real OS failure (Xiaomi strips the
    // PowerManager IPC in some battery-saver modes).
    return "unavailable";
  }
}

/**
 * Returns true if the user-facing prompt should be shown. Centralizes the
 * policy so the LoneWorker page doesn't reinvent it (and so the policy can
 * be unit-tested in one place).
 *
 * Decision matrix:
 *   bridge not injected       → false (web/iOS, no-op)
 *   bridge query throws       → false (let caller fail loud, do not hide)
 *   already exempt            → false (nothing to ask)
 *   not exempt + no error     → true
 */
export async function shouldPromptForBatteryExclusion(): Promise<boolean> {
  const status = await getBatteryOptimizationStatus();
  return status === "not-exempt";
}

/**
 * Open the system Settings intent that lets the user flip the exemption.
 *
 * This MUST be called from a user gesture (button click). Android silently
 * ignores programmatic invocations on some OEMs.
 *
 * The caller is responsible for re-querying `isIgnoringBatteryOptimizations`
 * after the user returns to the app — Android does not tell us what they
 * chose.
 */
export async function requestBatteryOptimizationExclusion(): Promise<boolean> {
  if (!bridge) return false;
  try {
    return await bridge.openRequestIgnoreBatteryOptimizations();
  } catch {
    // Intent rejected (no activity to handle it, OEM that blocks it). The
    // caller should treat this as a soft failure and log it — the worker
    // can still start the FGS, it just won't be on the exemption list.
    return false;
  }
}