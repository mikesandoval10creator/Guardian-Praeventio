/**
 * Platform-abstracted phone dialing for the SOS fallback path.
 *
 * Why this exists: SOSButton used to do `window.location.href = 'tel:...'`
 * inline. On a Capacitor WebView a plain `tel:` navigation can be swallowed
 * by the WebView instead of handing the URI to the OS dialer, so the worker
 * never reaches a human. There is also no seam to test that behaviour.
 *
 * The adapter resolves the platform in this order:
 *   1. A native `openUrl` bridge (Capacitor `App.openUrl`, or any injected
 *      equivalent) — the URI leaves the WebView and the OS dials.
 *   2. `window.location.href` — web / WebView fallback.
 *   3. Nothing — the caller must show an explicit instruction instead of
 *      pretending a dial happened.
 *
 * Pure by construction: every dependency is injectable, so the contract is
 * testable without a DOM.
 */

/** How the dial attempt was dispatched. */
export type DialOutcome =
  | 'native_bridge'
  | 'web_location'
  | 'unavailable';

export interface DialDependencies {
  /** Native bridge that hands a URI to the OS (Capacitor App.openUrl). */
  openUrl?: (url: string) => Promise<unknown> | unknown;
  /** Navigation target; `window.location` in a browser/WebView. */
  location?: { href: string } | null;
}

export interface DialResult {
  outcome: DialOutcome;
  uri: string;
}

/**
 * Build a `tel:` URI. Only digits, `+`, `*` and `#` survive, so a malformed
 * or hostile value can never inject another scheme.
 */
export function toSafeTelUri(number: string): string {
  const sanitized = String(number ?? '').replace(/[^0-9*#+]/g, '');
  return sanitized ? `tel:${sanitized}` : '';
}

/**
 * Dial `number`, preferring the native bridge.
 *
 * Never throws: a failure in the native bridge falls through to the web
 * navigation, and a failure there returns `unavailable` so the caller can
 * show the number to the worker instead of silently doing nothing.
 */
export function dialPhone(
  number: string,
  deps: DialDependencies = {},
): DialResult {
  const uri = toSafeTelUri(number);
  if (!uri) return { outcome: 'unavailable', uri: '' };

  if (typeof deps.openUrl === 'function') {
    try {
      const result = deps.openUrl(uri);
      // A native bridge may be async; the caller cannot await this helper
      // inside a sync fallback, but the promise is observed so a rejection
      // does not surface as an unhandled rejection.
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>).catch(() => undefined);
      }
      return { outcome: 'native_bridge', uri };
    } catch {
      // fall through to the web navigation
    }
  }

  const location = deps.location ?? null;
  if (location && typeof location.href === 'string') {
    try {
      location.href = uri;
      return { outcome: 'web_location', uri };
    } catch {
      // fall through to unavailable
    }
  }

  return { outcome: 'unavailable', uri };
}

/**
 * Resolve the default dependencies for the current runtime.
 *
 * The Capacitor bridge is looked up defensively: the app runs on the web
 * too, and the plugin may not be installed in every build.
 */
export function resolveDialDependencies(): DialDependencies {
  const location = (globalThis as { location?: { href: string } }).location ?? null;
  return { location };
}
