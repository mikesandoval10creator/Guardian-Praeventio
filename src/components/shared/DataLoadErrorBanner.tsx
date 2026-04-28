import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Inline error banner for collection/subscription read failures.
 *
 * Round 14 Task 5: surfaces the `error` field from `useFirestoreCollection`
 * /  `useRiskEngine` / `useProject` so a Firestore permission-denied or
 * dropped-connection failure no longer silently leaves the page on its
 * skeleton/empty state. Spanish-CL copy ("Reintentá en unos segundos.")
 * matches the country pack established in Round 9.
 *
 * Visual treatment mirrors `SyncConflictBanner` (amber palette, dense
 * 10px font, AlertTriangle leading icon) so multi-banner stacks read
 * consistently. Rendered inline (not fixed/sticky) — callers place it
 * above the list/grid the user was trying to load. The component
 * self-hides when `error` is `null`, so callers can mount it
 * unconditionally without an outer ternary.
 *
 * The Reintentar/refresh affordance is intentionally a hint
 * (`window.location.reload`) rather than a re-subscribe call: the
 * underlying onSnapshot subscriptions auto-recover on transient network
 * blips, and the banner exists for the cases where they don't (rules
 * regression, expired token). A full reload guarantees we reset every
 * provider to a clean slate.
 */
export interface DataLoadErrorBannerProps {
  error: Error | null;
  /**
   * Optional override for the diagnostic label rendered after the headline
   * (e.g. "trabajadores", "auditorías"). Falls back to a generic copy when
   * omitted so the banner reads sensibly on any page.
   */
  resourceLabel?: string;
  /**
   * Test hook + caller-overridable retry handler. Defaults to a hard
   * `window.location.reload()` because all current call sites consume
   * Firestore subscriptions that re-establish themselves on remount.
   */
  onRetry?: () => void;
  /** Optional ARIA / e2e selector. */
  'data-testid'?: string;
}

export function DataLoadErrorBanner({
  error,
  resourceLabel,
  onRetry,
  ...rest
}: DataLoadErrorBannerProps) {
  if (!error) return null;

  const handleRetry =
    onRetry ??
    (() => {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    });

  const headline = resourceLabel
    ? `No pudimos cargar ${resourceLabel}.`
    : 'No pudimos cargar los datos.';

  return (
    <div
      role="alert"
      data-testid={rest['data-testid'] ?? 'data-load-error-banner'}
      className="flex items-center gap-3 px-4 py-3 mb-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] sm:text-[11px] font-bold leading-snug">
          <span className="font-black">{headline}</span>{' '}
          <span className="opacity-80">Reintentá en unos segundos.</span>
        </p>
      </div>
      <button
        type="button"
        onClick={handleRetry}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-amber-500/20 hover:bg-amber-500/30 rounded-xl transition-colors"
      >
        <RefreshCw className="w-3 h-3" />
        Reintentar
      </button>
    </div>
  );
}
