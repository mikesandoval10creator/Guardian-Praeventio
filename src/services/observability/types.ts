// Praeventio Guard — Observability adapter types.
//
// SCAFFOLDING ONLY — these types describe the shape every error tracker /
// metrics emitter MUST implement. The concrete adapters (Sentry, GCP Error
// Reporting, Cloud Monitoring, Prometheus, noop) live in sibling files.
//
// Mirrors the pattern used by:
//   • src/services/security/kmsAdapter.ts (KMS adapter pattern)
//   • src/services/sii/types.ts          (SII PSE adapter pattern)
//   • src/services/ai/                   (Vertex AI adapter pattern)
//
// Production deploys pick a real adapter via `ERROR_TRACKER` /
// `METRICS_ADAPTER` env vars. Dev/CI default to `noop` which routes
// everything through the existing structured `logger` in src/utils/logger.ts.

/**
 * Context attached to every captured error / message.
 *
 * Keep this surface narrow — anything richer belongs in `extra`. Sentry +
 * GCP Error Reporting both accept structured user/tag/extra triples, so
 * mapping to either SDK is a 1:1 field copy.
 */
export interface ErrorContext {
  /** Auth UID of the affected user, when available. */
  userId?: string;
  /** Tenant / org identifier for multi-tenant contexts. */
  tenantId?: string;
  /** Request endpoint or job name where the error occurred. */
  endpoint?: string;
  /** Git SHA or semver of the running build. Stored as `release` in Sentry. */
  release?: string;
  /** Indexed key/value pairs — Sentry calls these "tags" (cheap to filter on). */
  tags?: Record<string, string>;
  /** Free-form structured payload. Not indexed in Sentry — heavier objects ok. */
  extra?: Record<string, unknown>;
}

/**
 * Sentry-style breadcrumb. Recorded in-memory and flushed alongside the
 * next exception so a captured error has a trail of "what just happened".
 *
 * Categories follow Sentry conventions so a Round-2 swap is field-for-field:
 *   - `navigation` (route changes)
 *   - `http`        (outbound API calls)
 *   - `click`       (UI interactions)
 *   - `log`         (general structured log mirror)
 *   - `auth`        (sign-in / token refresh)
 *   - `db`          (Firestore reads/writes)
 */
export interface Breadcrumb {
  category: string;
  message: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  timestamp: Date;
  data?: Record<string, unknown>;
}

/**
 * Init options passed once at startup. Each adapter validates the bits it
 * needs (e.g. Sentry requires `dsn`, GCP Error Reporting reads
 * `GCP_PROJECT_ID` from env). Unknown fields are ignored so a single
 * options bag works across every adapter.
 */
export interface ErrorTrackingInitOptions {
  /** Sentry DSN, or GCP project credentials reference. */
  dsn?: string;
  environment: 'development' | 'staging' | 'production';
  /** Git SHA / semver — propagated as Sentry release tag. */
  release?: string;
  /** 0.0–1.0; fraction of events to send. Defaults to 1.0 in adapters. */
  sampleRate?: number;
}

/**
 * Stable adapter identifier. Stored in logs / breadcrumbs so a future
 * incident review can tell which adapter emitted what.
 */
export type ErrorTrackingAdapterName = 'sentry' | 'cloud-error-reporting' | 'noop';

/**
 * The error-tracking surface every adapter implements. Calling code only
 * sees this interface — never the concrete SDK — so swapping Sentry for
 * GCP Error Reporting requires zero call-site changes.
 */
export interface ErrorTrackingAdapter {
  readonly name: ErrorTrackingAdapterName;
  /**
   * `true` when the adapter is wired up enough to call. Production code
   * SHOULD `if (!adapter.isAvailable) return;` rather than risk a throw —
   * observability must never crash a healthy request path.
   */
  readonly isAvailable: boolean;

  /** Initialize the underlying SDK. Called once at process boot. */
  init(options: ErrorTrackingInitOptions): void;

  /**
   * Capture an unhandled / handled exception with context.
   * Returns the event ID so callers can echo it in API responses
   * (`{ error: '...', eventId: 'abc123' }`) for support workflows.
   */
  captureException(error: Error, context?: ErrorContext): string;

  /**
   * Capture a non-Error message. Useful for reporting domain-level
   * anomalies that aren't strictly exceptions ("user double-charged",
   * "unknown DTE folio range").
   */
  captureMessage(
    message: string,
    level: 'info' | 'warning' | 'error',
    context?: ErrorContext,
  ): string;

  /** Append a breadcrumb to the in-memory trail. Cheap; fire-and-forget. */
  addBreadcrumb(breadcrumb: Breadcrumb): void;

  /** Bind user identity to subsequent events. Cleared on auth signout. */
  setUserContext(userId: string, additionalProps?: Record<string, unknown>): void;

  /**
   * Flush any pending events. Call before `process.exit` to avoid losing
   * in-flight reports. `timeout` is milliseconds; resolves whether or not
   * the flush actually finished — never reject.
   */
  flush(timeout?: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Stable metrics adapter identifier.
 */
export type MetricsAdapterName = 'cloud-monitoring' | 'prometheus' | 'noop';

/**
 * Minimal counter handle. Mirrors prom-client / OpenTelemetry's
 * `Counter.inc(value?)` so a Round-2 swap is a 1:1 mapping.
 */
export interface CounterHandle {
  inc(value?: number): void;
}

/**
 * Gauge handle (current value, can go up or down).
 */
export interface GaugeHandle {
  set(value: number): void;
  inc(value?: number): void;
  dec?(value?: number): void;
}

/**
 * Histogram handle (latency / size distributions).
 */
export interface HistogramHandle {
  observe(value: number): void;
}

/**
 * Adapter-level metrics interface. Each `counter()` / `gauge()` / `histogram()`
 * call returns a handle scoped to (name, labels) — implementations cache
 * handles internally so repeated calls with the same args are cheap.
 *
 * Label naming follows Prometheus conventions (snake_case, low-cardinality).
 * Avoid putting user IDs in labels — that explodes cardinality.
 */
export interface MetricsAdapter {
  readonly name: MetricsAdapterName;
  readonly isAvailable: boolean;

  counter(name: string, labels?: Record<string, string>): CounterHandle;
  gauge(name: string, labels?: Record<string, string>): GaugeHandle;
  histogram(name: string, labels?: Record<string, string>): HistogramHandle;
}

/**
 * Sentinel returned by stub adapters when callers ask for a feature that
 * requires the real SDK. Callers can `instanceof`-check rather than
 * string-match the message. Mirrors `SiiNotImplementedError` and
 * `WebpayNotImplementedError`.
 */
export class ObservabilityNotImplementedError extends Error {
  readonly adapter: string;
  readonly install: string;
  constructor(adapter: string, install: string) {
    super(
      `${adapter} adapter not implemented yet. Run \`${install}\` and follow ` +
        'OBSERVABILITY.md to wire the real SDK.',
    );
    this.name = 'ObservabilityNotImplementedError';
    this.adapter = adapter;
    this.install = install;
  }
}
