/**
 * React hook that surfaces reconciliation run status to the UI.
 *
 * Sprint 32 / Bucket Stream — pairs with
 * `src/services/slm/reconciliationAutoTrigger.ts`. The trigger service runs
 * in plain JS (so the service-level test suite stays in node env); this
 * hook is the React seam that turns the custom-event stream into
 * re-renderable state.
 *
 * Three pieces of state exposed:
 *
 *   1. `lastRunAt`  — epoch ms of the last completed (non-skipped) run, or
 *                     null if the hook has never seen a run.
 *   2. `lastStats`  — full `ReconciliationStats` payload of the last run
 *                     (skipped or not). The toast component reads this to
 *                     decide what banner colour to draw.
 *   3. `running`    — true between the moment a run is initiated via
 *                     `triggerNow()` and the moment the matching stats
 *                     event arrives.
 *
 * `triggerNow()` is opt-in: the caller passes a `triggerFn` (typically the
 * `triggerNow` from the trigger handle the app shell mounted). The hook
 * never imports the trigger module — that keeps the hook independent of
 * the FCM-aware service wiring and trivial to unit-test in jsdom.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RECONCILIATION_STATS_EVENT,
  type ReconciliationStats,
} from '../services/slm/reconciliationAutoTrigger';

export interface UseReconciliationStatusOptions {
  /**
   * Optional function the consumer of the hook can wire to the actual
   * trigger handle. When omitted, calling `triggerNow()` becomes a no-op
   * that still flips `running` momentarily (so the UI can show feedback
   * even before the service is mounted — e.g. during route preloading).
   */
  triggerFn?: () => Promise<ReconciliationStats>;
}

export interface UseReconciliationStatusResult {
  /** Epoch ms of the most recent completed (non-skipped) run, or null. */
  lastRunAt: number | null;
  /** Most recent stats payload (skipped or not), or null. */
  lastStats: ReconciliationStats | null;
  /** True while a manually-triggered run is in flight. */
  running: boolean;
  /** Force a run via the consumer-supplied trigger function. */
  triggerNow: () => Promise<ReconciliationStats | null>;
}

export function useReconciliationStatus(
  options: UseReconciliationStatusOptions = {},
): UseReconciliationStatusResult {
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const [lastStats, setLastStats] = useState<ReconciliationStats | null>(null);
  const [running, setRunning] = useState<boolean>(false);

  const triggerRef = useRef<UseReconciliationStatusOptions['triggerFn']>(options.triggerFn);
  useEffect(() => {
    triggerRef.current = options.triggerFn;
  }, [options.triggerFn]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStats = (evt: Event): void => {
      const detail = (evt as CustomEvent<ReconciliationStats>).detail;
      if (!detail) return;
      setLastStats(detail);
      if (!detail.skipped) {
        setLastRunAt(detail.finishedAt);
      }
      setRunning(false);
    };
    window.addEventListener(RECONCILIATION_STATS_EVENT, onStats as EventListener);
    return () => {
      window.removeEventListener(RECONCILIATION_STATS_EVENT, onStats as EventListener);
    };
  }, []);

  const triggerNow = useCallback(async (): Promise<ReconciliationStats | null> => {
    const fn = triggerRef.current;
    if (typeof fn !== 'function') {
      // No-op trigger: still flash `running` so the UI can show feedback.
      setRunning(true);
      setRunning(false);
      return null;
    }
    setRunning(true);
    try {
      const result = await fn();
      // The stats event will normally flip `running` back to false; the
      // finally block below is the belt-and-braces guard for cases where
      // the trigger resolved synchronously without dispatching (test
      // harness, custom stub).
      return result;
    } finally {
      setRunning(false);
    }
  }, []);

  return { lastRunAt, lastStats, running, triggerNow };
}
