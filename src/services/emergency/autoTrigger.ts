/**
 * Guardian Praeventio — emergency auto-trigger predicates.
 *
 * Each predicate returns `true` when its signal source indicates an
 * active emergency. The current implementations are conservative stubs
 * that return `false` so the UI never auto-engages an emergency until
 * the real signal sources are wired in. Each stub documents the file
 * path to the eventual source of truth.
 */

/**
 * Adverse climate detection.
 *
 * Real source: `src/contexts/SensorContext.tsx` exposes weather/UV
 * telemetry, and `src/services/environmentBackend.ts` runs the
 * meteorological evaluation. Eventually this should subscribe to the
 * sensor stream and return `true` on red-flag conditions (e.g. UV ≥ 11,
 * tropical storm, lightning within radius).
 */
export async function checkAdverseClimate(): Promise<boolean> {
  return false;
}

/**
 * Sismo (earthquake) detection.
 *
 * Real source: a `DeviceMotionEvent` listener thresholding the moving
 * RMS of `acceleration.{x,y,z}` over ~3s. We deliberately do NOT add
 * the listener here yet — see `src/components/emergency/FallDetectionMonitor.tsx`
 * for the existing accelerometer pattern; sismo detection should reuse
 * that subscription rather than duplicating it.
 */
export async function checkSismo(): Promise<boolean> {
  return false;
}

/**
 * Company-declared emergency.
 *
 * Real source: `src/contexts/EmergencyContext.tsx` holds
 * `isEmergencyActive` driven by Firestore `emergency_events`. This
 * predicate cannot import the React context outside of a component, so
 * the orchestrator below relies on event/window bridges. A future
 * iteration should expose a vanilla subscriber on EmergencyContext
 * (e.g. an EventTarget) so this stub can read it without a React tree.
 */
export async function checkCompanyEmergency(): Promise<boolean> {
  return false;
}

/**
 * Starts the background monitor. Calls `onTrigger` exactly once per
 * emergency edge (rising). Returns a cleanup function.
 *
 * Polling interval is 30s — cheap, and the predicates are stubs today.
 * When real signals are wired, prefer event-driven hooks (sensor
 * subscriptions, Firestore onSnapshot bridges) over polling.
 */
export function startEmergencyMonitor(onTrigger: () => void): () => void {
  let cancelled = false;
  let lastState = false;

  const tick = async (): Promise<void> => {
    if (cancelled) return;
    try {
      const [climate, sismo, company] = await Promise.all([
        checkAdverseClimate(),
        checkSismo(),
        checkCompanyEmergency(),
      ]);
      const active = climate || sismo || company;
      if (active && !lastState) onTrigger();
      lastState = active;
    } catch {
      // Predicates must never throw, but be defensive.
    }
  };

  const interval = setInterval(() => { void tick(); }, 30_000);

  return (): void => {
    cancelled = true;
    clearInterval(interval);
  };
}
