/**
 * Analytics adapter (ninth wave, Bucket D).
 *
 * Vendor-neutral product-analytics surface. Implements the design from
 * the eighth wave's `docs/tracking/TRACKING_PLAN.md`:
 *
 *   - `track(name, props)` fans out to every configured sink with
 *     auto-filled common props (TRACKING_PLAN §4.8).
 *   - PII guard drops events whose top-level props include any of the
 *     forbidden keys (TRACKING_PLAN §4.4 — but we DROP rather than
 *     redact: the spec is "PII never enters analytics", not "redact and
 *     ship").
 *   - Opt-out short-circuit on `localStorage.analytics_opt_out === '1'`
 *     (TRACKING_PLAN §8.2).
 *   - Offline support via `AnalyticsQueue`. When `navigator.onLine`
 *     reports false at fire time the event is queued; on `flush()` (the
 *     app shell wires this to the `online` event) the queue drains
 *     through every sink in arrival order.
 *
 * Backend selection is intentionally deferred (TRACKING_PLAN §9). The
 * adapter accepts an array of sinks via DI — flipping from the default
 * `[consoleSink, sentryBreadcrumbSink]` to `[postHogSink]` is a 1-line
 * change.
 *
 * No new env vars at runtime besides `VITE_ANALYTICS_SALT` (optional).
 *
 * The adapter NEVER throws to its caller. Worst case: a failure is
 * captured as a Sentry breadcrumb and `track()` resolves anyway.
 */

import type { AnalyticsQueue } from './queue';
import type {
  CommonProperties,
  Event,
  EventInputProps,
  EventName,
  EventPropertiesMap,
  Sink,
} from './types';

/**
 * Forbidden top-level prop names. Presence of ANY of these in the input
 * props causes the event to be dropped before it reaches the sinks. The
 * spec (TRACKING_PLAN §4.4) is explicit: PII should never enter the
 * analytics payload — redaction-after-the-fact is too easy to get wrong.
 *
 * `lat` / `lng` are listed because emergency events use `commune_code`
 * for geo bucketing (§4.5); a stray `lat` would be a regression.
 */
const PII_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'email',
  'phone',
  'rut',
  'name',
  'address',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'uid',
  'patient_uid',
  'worker_uid',
  'professional_uid',
  'purpose',
  'resource_ids',
  'record_ids',
  'specialty',
  'diagnosis',
  'medications',
]);

/**
 * Plan-level event_version. Bumped per row in the catalog; the adapter
 * stamps every event with the same value until codegen takes over
 * (TRACKING_PLAN §11.6). All 5 wave-9 events carry version 1.0.0 in the
 * catalog.
 */
const EVENT_VERSION = '1.0.0';

/**
 * Resolve common props from environment + browser. Pure-ish helper so
 * tests can stub Math.random for sample_rate, etc.
 *
 * Reads `app_mode` from `localStorage.gp_app_mode` rather than calling
 * the React `useAppMode()` hook because this module runs in services /
 * non-React code. The hook itself persists to that key (see
 * `useAppMode.ts`), so the value is guaranteed fresh as of the last
 * mode switch.
 */
function defaultGetCommonProps(): CommonProperties {
  const env = readImportMetaEnv();
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isMobile = typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 768px)').matches;
  // Keep Capacitor detection cheap — the runtime check `window.Capacitor` is what `@capacitor/core` itself uses internally.
  const cap = (typeof window !== 'undefined' && (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor)
    || undefined;
  let device_class: CommonProperties['device_class'] = isMobile ? 'web-mobile' : 'web-desktop';
  if (cap?.getPlatform) {
    const platform = cap.getPlatform();
    if (platform === 'android') device_class = 'capacitor-android';
    else if (platform === 'ios') device_class = 'capacitor-ios';
  }
  if (!isMobile && /iPad|Tablet/i.test(userAgent)) {
    device_class = 'web-tablet';
  }

  let app_mode: CommonProperties['app_mode'] = 'normal-light';
  try {
    const stored = typeof localStorage !== 'undefined' && localStorage.getItem('gp_app_mode');
    if (stored === 'normal-light' || stored === 'normal-dark' || stored === 'driving' || stored === 'emergency') {
      app_mode = stored;
    }
  } catch {
    /* localStorage may be blocked; fall back to default */
  }

  return {
    event_version: EVENT_VERSION,
    app_version: env.VITE_APP_VERSION || 'dev',
    app_env: (env.VITE_APP_ENV as CommonProperties['app_env']) || 'dev',
    app_mode,
    locale: typeof navigator !== 'undefined' ? navigator.language : 'es-CL',
    device_class,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    timestamp_iso: new Date().toISOString(),
    sample_rate: 1,
  };
}

/**
 * Read Vite's `import.meta.env` defensively. In test/node the global is
 * absent; we return an empty object so the `||` fallbacks above kick in.
 *
 * The cast through `unknown` is required because `import.meta` is an
 * ECMAScript-spec feature whose TS shape varies per bundler; we trust
 * the runtime to either return our Vite-injected vars or `undefined`.
 */
function readImportMetaEnv(): Record<string, string | undefined> {
  try {
    const meta = (import.meta as unknown as { env?: Record<string, string | undefined> });
    return meta.env ?? {};
  } catch {
    return {};
  }
}

/**
 * sha256 hex digest of `firebaseUid + salt` via Web Crypto. Salt comes
 * from `VITE_ANALYTICS_SALT` and falls back to a stable string so dev
 * builds don't crash when the env var is absent. Production deploys
 * MUST override the salt — document this in the deploy checklist.
 */
export async function userIdHash(uid: string): Promise<string> {
  const env = readImportMetaEnv();
  const salt = env.VITE_ANALYTICS_SALT || 'praeventio-default';
  const data = new TextEncoder().encode(uid + salt);
  // Web Crypto is present in browsers + Node >=20. We don't fall back
  // to a userland sha256 — the cost would dwarf the analytics layer.
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) {
    throw new Error('analytics.userIdHash: Web Crypto SubtleCrypto unavailable');
  }
  const buf = await subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/**
 * DI surface for the constructor. Tests pass mock implementations; prod
 * uses the singleton built in `index.ts`.
 */
export interface AnalyticsAdapterOptions {
  sinks: Sink[];
  queue: AnalyticsQueue;
  isOptedOut?: () => boolean;
  getCommonProps?: () => CommonProperties;
}

/**
 * Default opt-out check. `localStorage` may be absent (SSR) or blocked
 * (third-party-cookies-style restrictions); we treat that as not opted
 * out so the user opt-in flow remains the only switch.
 */
function defaultIsOptedOut(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('analytics_opt_out') === '1';
  } catch {
    return false;
  }
}

async function warnSentry(message: string, data?: Record<string, unknown>): Promise<void> {
  try {
    const Sentry = await import('@sentry/core');
    Sentry.addBreadcrumb({
      category: 'analytics.adapter',
      message,
      level: 'warning',
      data,
    });
  } catch {
    /* swallow */
  }
}

export class AnalyticsAdapter {
  private readonly sinks: Sink[];
  private readonly queue: AnalyticsQueue;
  private readonly isOptedOut: () => boolean;
  private readonly getCommonProps: () => CommonProperties;

  constructor(options: AnalyticsAdapterOptions) {
    this.sinks = options.sinks;
    this.queue = options.queue;
    this.isOptedOut = options.isOptedOut ?? defaultIsOptedOut;
    this.getCommonProps = options.getCommonProps ?? defaultGetCommonProps;
  }

  /**
   * Emit one event.
   *
   * Steps in order:
   *   1. Opt-out check â†’ resolve.
   *   2. PII guard on input props â†’ drop + warn â†’ resolve.
   *   3. Merge with common props â†’ typed `Event<N>`.
   *   4. If offline â†’ enqueue â†’ resolve.
   *   5. Else â†’ fan out to every sink (errors swallowed per sink).
   *
   * Never throws to the caller.
   */
  async track<N extends EventName>(name: N, props: EventInputProps<N>): Promise<void> {
    try {
      if (this.isOptedOut()) return;
      if (this.containsForbiddenPii(props)) {
        await warnSentry('analytics.track: PII guard dropped event', {
          name,
          forbiddenKeys: this.findForbiddenKeys(props),
        });
        return;
      }
      const common = this.getCommonProps();
      const event: Event<N> = {
        name,
        properties: {
          ...common,
          ...(props as object),
        } as EventPropertiesMap[N],
      };

      if (!common.online) {
        try {
          await this.queue.enqueue(event as Event<EventName>);
        } catch (err) {
          await warnSentry('analytics.track: queue.enqueue failed', {
            name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      await this.fanOut(event as Event<EventName>);
    } catch (err) {
      // Defensive — anything that escaped the inner try/catch lands here.
      await warnSentry('analytics.track: unexpected adapter error', {
        name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Drain the offline queue through every sink. Called by app-shell
   * code on the `online` event. Idempotent: calls with an empty queue
   * resolve cheaply.
   */
  async flush(): Promise<void> {
    try {
      const pending = await this.queue.listPending();
      if (pending.length === 0) return;
      const replayedIds: string[] = [];
      for (const row of pending) {
        await this.fanOut(row.event);
        replayedIds.push(row.id);
      }
      await this.queue.clear(replayedIds);
      await Promise.all(this.sinks.map((s) => s.flush().catch(() => undefined)));
    } catch (err) {
      await warnSentry('analytics.flush: drain failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Send to every sink. Faults from any one sink are caught and
   * reported but never block the others — analytics is fan-out, not
   * fan-in.
   */
  private async fanOut(event: Event<EventName>): Promise<void> {
    await Promise.all(
      this.sinks.map(async (sink) => {
        try {
          await sink.track(event);
        } catch (err) {
          await warnSentry('analytics.sink.track threw', {
            sink: sink.name,
            event: event.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  private containsForbiddenPii(props: object): boolean {
    return this.findForbiddenKeys(props).length > 0;
  }

  private findForbiddenKeys(props: object): string[] {
    return Object.keys(props).filter((k) => PII_FORBIDDEN_KEYS.has(k));
  }
}
