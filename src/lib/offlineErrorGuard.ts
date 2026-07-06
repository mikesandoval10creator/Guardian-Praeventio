// Field-safety PWA: offline is an EXPECTED operating state, not a fault.
//
// A Firestore read (`getDoc`) still in-flight to the server when connectivity
// drops rejects with "Failed to get document because the client is offline"
// (FirebaseError code 'unavailable'). Firestore's persistent cache serves reads
// from cache while offline, but a read that ALREADY committed to the server path
// (uncached doc, first launch) can't fall back mid-flight — it rejects. For a
// fire-and-forget read this becomes an UNHANDLED promise rejection: benign noise
// that would otherwise hit the console and Sentry as if it were a real error.
//
// This guard recognises that one specific benign case and neutralises it. It is
// a safety net for the expected-offline fire-and-forget case only — reads that
// genuinely must react to offline still use their own try/catch.

/**
 * True only for the benign Firestore "read while the client is offline"
 * rejection. Deliberately narrow (matches the SDK's message) so genuine faults
 * — including a real 'unavailable' while ONLINE, which carries a different
 * message — are never suppressed.
 */
export function isBenignOfflineReadRejection(reason: unknown): boolean {
  const message = (reason as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && /client is offline/i.test(message);
}

/**
 * Install a window-level `unhandledrejection` guard that neutralises the benign
 * offline-read rejection: `preventDefault()` stops the browser's unhandled
 * rejection console error, and `stopImmediatePropagation()` prevents any
 * later-registered handler on `window` (e.g. Sentry's global handler) from
 * reporting it — so this MUST be installed BEFORE Sentry init.
 *
 * `onSuppress` is invoked (best-effort, never throws into the handler) so the
 * suppression stays observable at debug level without alarming.
 */
export function installOfflineRejectionGuard(
  onSuppress: (code: string | undefined) => void = () => {},
): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('unhandledrejection', (event) => {
    if (!isBenignOfflineReadRejection(event.reason)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      onSuppress((event.reason as { code?: string } | undefined)?.code);
    } catch {
      /* observability callback must never re-throw into the handler */
    }
  });
}
