// Praeventio Guard — Round 21 B1 Phase 5 split.
//
// Proactive Project Health Check loop. Originally a `setInterval(..., 6h)`
// inside the `app.listen` callback in server.ts. Extracted here so:
//
//   • Unit tests can drive interval timing with `vi.useFakeTimers()` and
//     verify the loop calls the safety-engine pass per project.
//   • Graceful shutdown can `stop()` the interval (returned handle).
//   • The 6h cadence is overridable for tests via `intervalMs`.
//
// Side-effect contract: zero work happens at import time. Calling
// `setupHealthCheckInterval` schedules the loop and returns a `stop()`
// handle. Errors inside an iteration are caught and logged — they MUST
// NOT kill the timer.

import type admin from 'firebase-admin';

export const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface HealthCheckDeps {
  db: admin.firestore.Firestore;
  /** Interval in ms. Defaults to 6h. */
  intervalMs?: number;
  /**
   * Override the safety-engine entry point (default: dynamic import of
   * `src/services/safetyEngineBackend.js`). Tests inject a stub.
   */
  performProjectSafetyHealthCheck?: (projectId: string) => Promise<unknown>;
}

export interface HealthCheckHandle {
  stop: () => void;
}

export function setupHealthCheckInterval(
  deps: HealthCheckDeps,
): HealthCheckHandle {
  const intervalMs = deps.intervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS;

  const tick = async () => {
    try {
      const projects = await deps.db.collection('projects').get();
      const performCheck =
        deps.performProjectSafetyHealthCheck ??
        (await loadDefaultSafetyEngine());

      for (const project of projects.docs) {
        await performCheck(project.id).catch((e) =>
          console.error(`Error in health check for ${project.id}:`, e),
        );
      }
    } catch (error) {
      console.error('Error in background health checks:', error);
    }
  };

  const handle = setInterval(tick, intervalMs);

  return {
    stop: () => {
      clearInterval(handle);
    },
  };
}

async function loadDefaultSafetyEngine(): Promise<
  (projectId: string) => Promise<unknown>
> {
  const mod = await import('../../services/safetyEngineBackend.js');
  return mod.performProjectSafetyHealthCheck;
}
