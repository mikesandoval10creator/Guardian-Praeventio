/**
 * `<ReconciliationStatusToast />` — passive listener that draws a transient
 * toast/banner each time a reconciliation pass completes.
 *
 * Sprint 32 / Bucket Stream — the visible end of the stream the trigger
 * service starts. The component is purely reactive: it does not initiate
 * runs, it does not own state beyond the visible toast list, and it does
 * not import the trigger service (the hook does). Mounting this component
 * once near the root of the app is enough to make every completed run
 * surface to the user.
 *
 * Render rules:
 *
 *   - `succeeded > 0` → green success toast: "Sincronizadas N consultas".
 *   - `failed > 0` and `succeeded === 0` → amber warning toast: "N consultas
 *     con error — revisar Settings".
 *   - `failed > 0` and `succeeded > 0` → green success toast augmented with
 *     the failure count on a second line, so the user sees progress AND
 *     the partial failure in one banner.
 *   - `attempted === 0` or `skipped === true` → silent (no toast). The
 *     empty case happens every time the device comes online without any
 *     queued sessions; spamming the user with "0 consultas sincronizadas"
 *     would teach them to ignore the toast.
 *
 * Accessibility:
 *   - Toasts render inside a `role="status"` region with `aria-live="polite"`
 *     so screen readers announce them without interrupting the user.
 *   - Each toast carries its own `role="alert"` only for the failure case
 *     (where the user genuinely needs to act).
 *   - The dismiss button is keyboard-reachable and labelled in Spanish to
 *     match the rest of the UI copy.
 *
 * Test surface: the component accepts an `autoDismissMs` prop (defaults to
 * 5_000) so the test suite can drive deterministic auto-dismissal without
 * fake timers gymnastics, and `forceStats` to render with a static payload
 * for snapshot-style assertions.
 */

import React from 'react';
import {
  RECONCILIATION_STATS_EVENT,
  type ReconciliationStats,
} from '../../services/slm/reconciliationAutoTrigger';

export interface ReconciliationStatusToastProps {
  /**
   * Milliseconds after which the toast auto-dismisses. Defaults to 5_000.
   * Pass `0` (or a negative number) to disable auto-dismiss (the toast
   * stays until the user clicks the X).
   */
  autoDismissMs?: number;
  /**
   * When provided, the component renders a toast for this payload directly
   * without subscribing to the window event. Used by tests + storybook.
   */
  forceStats?: ReconciliationStats;
}

interface VisibleToast {
  id: string;
  tone: 'success' | 'warning';
  primary: string;
  secondary: string | null;
}

function statsToToast(stats: ReconciliationStats): VisibleToast | null {
  if (stats.skipped) return null;
  if (stats.attempted === 0 && stats.succeeded === 0 && stats.failed === 0) {
    return null;
  }

  const id = stats.runId;
  if (stats.succeeded > 0) {
    return {
      id,
      tone: 'success',
      primary: `Sincronizadas ${stats.succeeded} ${stats.succeeded === 1 ? 'consulta' : 'consultas'}`,
      secondary:
        stats.failed > 0
          ? `${stats.failed} con error — revisar Settings`
          : null,
    };
  }
  if (stats.failed > 0) {
    return {
      id,
      tone: 'warning',
      primary: `${stats.failed} ${stats.failed === 1 ? 'consulta' : 'consultas'} con error`,
      secondary: 'Revisar Settings',
    };
  }
  return null;
}

export function ReconciliationStatusToast({
  autoDismissMs = 5_000,
  forceStats,
}: ReconciliationStatusToastProps): React.ReactElement | null {
  const [toasts, setToasts] = React.useState<VisibleToast[]>(() => {
    if (forceStats) {
      const t = statsToToast(forceStats);
      return t ? [t] : [];
    }
    return [];
  });

  React.useEffect(() => {
    if (forceStats) return;
    if (typeof window === 'undefined') return;
    const onStats = (evt: Event): void => {
      const detail = (evt as CustomEvent<ReconciliationStats>).detail;
      if (!detail) return;
      const toast = statsToToast(detail);
      if (!toast) return;
      setToasts((prev) => {
        // De-dupe by runId so a stats event dispatched twice doesn't stack.
        if (prev.some((t) => t.id === toast.id)) return prev;
        return [...prev, toast];
      });
    };
    window.addEventListener(RECONCILIATION_STATS_EVENT, onStats as EventListener);
    return () => {
      window.removeEventListener(RECONCILIATION_STATS_EVENT, onStats as EventListener);
    };
  }, [forceStats]);

  // Auto-dismiss: schedule one timer per toast id. Cleaning up on unmount
  // is handled by the effect cleanup; re-running for the same id is
  // de-duped via the `scheduledRef` set.
  const scheduledRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (autoDismissMs <= 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const t of toasts) {
      if (scheduledRef.current.has(t.id)) continue;
      scheduledRef.current.add(t.id);
      const handle = setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, autoDismissMs);
      timers.push(handle);
    }
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [toasts, autoDismissMs]);

  function dismiss(id: string): void {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="reconciliation-status-toast-region"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="reconciliation-status-toast"
          data-tone={t.tone}
          role={t.tone === 'warning' ? 'alert' : undefined}
          className={
            t.tone === 'success'
              ? 'rounded-lg border border-emerald-500 bg-emerald-50 text-emerald-900 px-4 py-3 shadow-md min-w-[18rem] dark:bg-emerald-900 dark:text-emerald-50'
              : 'rounded-lg border border-amber-500 bg-amber-50 text-amber-900 px-4 py-3 shadow-md min-w-[18rem] dark:bg-amber-900 dark:text-amber-50'
          }
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 text-sm">
              <p
                className="font-semibold"
                data-testid="reconciliation-status-toast-primary"
              >
                {t.primary}
              </p>
              {t.secondary && (
                <p
                  className="mt-0.5 opacity-90"
                  data-testid="reconciliation-status-toast-secondary"
                >
                  {t.secondary}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Descartar notificación"
              data-testid="reconciliation-status-toast-dismiss"
              className="shrink-0 rounded px-2 py-1 text-xs hover:bg-black/10 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-current"
            >
              X
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default ReconciliationStatusToast;
