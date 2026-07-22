/**
 * Node-only analytics adapter for server-side wire-points (admin
 * routes, audit log middleware, scheduled jobs). Mirrors the public
 * `analytics.track(name, props)` shape from `adapter.ts` but uses
 * Node primitives only — no IndexedDB, no localStorage, no
 * navigator.
 *
 * Why a separate file rather than runtime-detection inside `adapter.ts`:
 *   - The browser singleton imports `idb` (IndexedDB wrapper) at module
 *     load. Pulling that into the Node bundle would balloon the server
 *     surface for zero benefit. A separate file keeps the import graph
 *     clean: server code imports from this file, browser code from
 *     `./adapter.ts` (or the `analytics` singleton in `./index.ts`).
 *   - `defaultGetCommonProps` in `adapter.ts` reads `localStorage`,
 *     `navigator`, `window.matchMedia`. Defensive `typeof` guards exist
 *     but the resulting common-prop block is meaningless on the server
 *     (e.g. always reports `web-desktop`). Owning a server version
 *     means we can stamp the right defaults.
 *
 * Sinks default to: stdoutJsonSink (writes one JSON-line per event
 * to stderr) + sentryBreadcrumbSink (already cross-runtime via
 * @sentry/core).
 *
 * Queue defaults to: in-memory bounded ring buffer (max 1000
 * entries; drop oldest with Sentry warn). NOT persistent — server
 * restarts lose pending events. Acceptable trade-off because the
 * server-side path is intended for low-volume admin events; a
 * Firestore-backed queue can be added later if volume increases.
 *
 * Opt-out: server-side uses `ANALYTICS_OPT_OUT=1` env var (the browser
 * `localStorage.analytics_opt_out` key has no server analog). Default
 * is opt-IN to match browser behaviour where the user must explicitly
 * opt out.
 *
 * The adapter NEVER throws to its caller. Worst case: a failure is
 * captured as a Sentry breadcrumb and `track()` resolves anyway.
 */

import { randomId } from '../../utils/randomId';
import type {
  CommonProperties,
  Event,
  EventInputProps,
  EventName,
  EventPropertiesMap,
  Sink,
} from './types';

// ---------------------------------------------------------------------------
// PII guard — same forbidden top-level keys as the browser adapter.
// Kept in sync intentionally; if the browser list grows, mirror it here.
// ---------------------------------------------------------------------------

/** Forbidden top-level prop names. Mirrors `adapter.ts` PII_FORBIDDEN_KEYS. */
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

/** Plan-level event_version. Bumped per row in the catalog. */
const EVENT_VERSION = '1.0.0';

/** Upper bound on in-memory rows. Drop-oldest on overflow. */
const QUEUE_MAX_ENTRIES = 1000;

// ---------------------------------------------------------------------------
// Common props — Node defaults.
// ---------------------------------------------------------------------------

/**
 * Resolve common props on the server side. Reads NODE_ENV + APP_VERSION
 * env vars; everything else is a sensible server default. The shape
 * matches `CommonProperties` exactly so downstream sinks see identical
 * payloads regardless of runtime.
 */
function defaultGetServerCommonProps(): CommonProperties {
  const nodeEnv = process.env.NODE_ENV;
  let app_env: CommonProperties['app_env'] = 'dev';
  if (nodeEnv === 'production') app_env = 'production';
  else if (nodeEnv === 'staging') app_env = 'staging';

  return {
    event_version: EVENT_VERSION,
    app_version: process.env.APP_VERSION || process.env.VITE_APP_VERSION || 'dev',
    app_env,
    // The server isn't in any UI mode — pick the canonical default so
    // dashboards can still bucket if they group by mode.
    app_mode: 'normal-light',
    locale: 'es-CL',
    // Server is always "web-desktop" for analytics-bucketing purposes.
    // We don't introduce a new device_class enum value to avoid
    // CommonProperties drift.
    device_class: 'web-desktop',
    online: true,
    timestamp_iso: new Date().toISOString(),
    sample_rate: 1,
  };
}

// ---------------------------------------------------------------------------
// stdout JSON sink — writes one JSON line per event to process.stderr.
// stderr (NOT stdout) so log shippers can parse without conflicting with
// any stdout-based app output.
// ---------------------------------------------------------------------------

/**
 * Append-only JSON-line sink. One line per event:
 *   `{"ts":"2026-05-04T13:42:11.512Z","name":"auth.role.granted","props":{...}}`
 *
 * The operator's log shipper (Stackdriver / Datadog / similar) picks
 * these up. Cardinality stays bounded because event names come from a
 * closed string-literal union and props are catalog-shaped.
 */
export const stdoutJsonSink: Sink = {
  name: 'stdout-json',
  async track(event: Event<EventName>): Promise<void> {
    try {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        name: event.name,
        props: event.properties,
      });
      // stderr — see comment above.
      process.stderr.write(`${line}\n`);
    } catch {
      /* never let logging faults propagate */
    }
  },
  async flush(): Promise<void> {
    /* stderr writes are line-buffered; nothing to flush here. */
  },
};

// ---------------------------------------------------------------------------
// Sentry breadcrumb sink — server analog. Uses lazy `@sentry/core` import
// so the analytics module stays test-friendly under Vitest's node runner.
// ---------------------------------------------------------------------------

async function safeAddBreadcrumb(
  message: string,
  data: Record<string, unknown>,
  category = 'analytics',
  level: 'info' | 'warning' = 'info',
): Promise<void> {
  try {
    const Sentry = await import('@sentry/core');
    Sentry.addBreadcrumb({ category, message, level, data });
  } catch {
    /* SDK absent or init not yet called — ignore */
  }
}

/**
 * Sentry breadcrumb sink (server). Cross-runtime by virtue of
 * `@sentry/core`. Cardinality stays bounded because event names are a
 * closed string-literal union (see `types.ts:EventName`).
 */
export const serverSentryBreadcrumbSink: Sink = {
  name: 'sentry-breadcrumb',
  async track(event: Event<EventName>): Promise<void> {
    await safeAddBreadcrumb(
      event.name,
      event.properties as unknown as Record<string, unknown>,
    );
  },
  async flush(): Promise<void> {
    /* breadcrumbs flush with the next captureException — no-op here */
  },
};

// ---------------------------------------------------------------------------
// In-memory bounded queue. Map preserves insertion order; we evict the
// first key on overflow.
// ---------------------------------------------------------------------------

export interface QueuedAnalyticsEventInMemory {
  id: string;
  event: Event<EventName>;
  createdAt: number;
}

/** Server-side queue contract — same shape the browser adapter expects. */
export interface ServerAnalyticsQueue {
  enqueue(event: Event<EventName>): Promise<string>;
  listPending(): Promise<QueuedAnalyticsEventInMemory[]>;
  clear(ids: readonly string[]): Promise<number>;
  /** Current depth — debugging surface. */
  size(): number;
}

function newId(): string {
  // crypto.randomUUID is in Node >=14.17 / >=15.6 (we run >=20).
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `aq_${Date.now().toString(36)}_${randomId()}`;
}

/**
 * Construct a fresh in-memory queue. Tests instantiate their own to
 * avoid cross-test bleed; the default singleton uses one shared
 * instance for the lifetime of the process.
 */
export function createInMemoryAnalyticsQueue(
  max: number = QUEUE_MAX_ENTRIES,
): ServerAnalyticsQueue {
  // Map keeps insertion order so "drop oldest" is the first key.
  const rows = new Map<string, QueuedAnalyticsEventInMemory>();

  return {
    async enqueue(event: Event<EventName>): Promise<string> {
      if (rows.size >= max) {
        const firstKey = rows.keys().next().value as string | undefined;
        if (firstKey) {
          const dropped = rows.get(firstKey);
          rows.delete(firstKey);
          await safeAddBreadcrumb(
            'analytics queue overflow — oldest entry evicted',
            {
              droppedId: firstKey,
              droppedName: dropped?.event.name,
              queueDepth: rows.size + 1,
              max,
            },
            'analytics.queue.overflow',
            'warning',
          );
        }
      }
      const id = newId();
      rows.set(id, { id, event, createdAt: Date.now() });
      return id;
    },
    async listPending(): Promise<QueuedAnalyticsEventInMemory[]> {
      // Map iteration is insertion-order, which is also chronological.
      return Array.from(rows.values());
    },
    async clear(ids: readonly string[]): Promise<number> {
      if (ids.length === 0) return 0;
      let removed = 0;
      for (const id of ids) {
        if (rows.delete(id)) removed += 1;
      }
      return removed;
    },
    size(): number {
      return rows.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Server adapter factory + singleton.
// ---------------------------------------------------------------------------

/** Opt-out check — env-var driven. */
function defaultIsServerOptedOut(): boolean {
  return process.env.ANALYTICS_OPT_OUT === '1';
}

async function warnSentryAdapter(
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await safeAddBreadcrumb(message, data ?? {}, 'analytics.adapter', 'warning');
}

export interface ServerAnalyticsOptions {
  sinks?: Sink[];
  queue?: ServerAnalyticsQueue;
  isOptedOut?: () => boolean;
  getCommonProps?: () => CommonProperties;
}

export interface ServerAnalytics {
  track<N extends EventName>(name: N, props: EventInputProps<N>): Promise<void>;
  flush(): Promise<void>;
  /** Test-only handle — exposes the underlying queue size. */
  readonly queueSize: () => number;
}

/**
 * Build a server analytics instance. Same surface as the browser
 * singleton's `analytics.track` / `analytics.flush`.
 *
 * Default sinks: stdoutJsonSink + serverSentryBreadcrumbSink.
 * Default queue: in-memory bounded ring buffer (max 1000).
 * Default opt-out: `ANALYTICS_OPT_OUT=1` env var.
 */
export function createServerAnalytics(
  opts: ServerAnalyticsOptions = {},
): ServerAnalytics {
  const sinks = opts.sinks ?? [stdoutJsonSink, serverSentryBreadcrumbSink];
  const queue = opts.queue ?? createInMemoryAnalyticsQueue();
  const isOptedOut = opts.isOptedOut ?? defaultIsServerOptedOut;
  const getCommonProps = opts.getCommonProps ?? defaultGetServerCommonProps;

  function findForbiddenKeys(props: object): string[] {
    return Object.keys(props).filter((k) => PII_FORBIDDEN_KEYS.has(k));
  }

  async function fanOut(event: Event<EventName>): Promise<void> {
    await Promise.all(
      sinks.map(async (sink) => {
        try {
          await sink.track(event);
        } catch (err) {
          await warnSentryAdapter('analytics.sink.track threw', {
            sink: sink.name,
            event: event.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  return {
    async track<N extends EventName>(
      name: N,
      props: EventInputProps<N>,
    ): Promise<void> {
      try {
        if (isOptedOut()) return;

        const forbidden = findForbiddenKeys(props as object);
        if (forbidden.length > 0) {
          await warnSentryAdapter('analytics.track: PII guard dropped event', {
            name,
            forbiddenKeys: forbidden,
          });
          return;
        }

        const common = getCommonProps();
        const event: Event<N> = {
          name,
          properties: {
            ...common,
            ...(props as object),
          } as EventPropertiesMap[N],
        };

        if (!common.online) {
          try {
            await queue.enqueue(event as Event<EventName>);
          } catch (err) {
            await warnSentryAdapter('analytics.track: queue.enqueue failed', {
              name,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          return;
        }

        await fanOut(event as Event<EventName>);
      } catch (err) {
        // Defensive — anything that escaped lands here.
        await warnSentryAdapter('analytics.track: unexpected adapter error', {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async flush(): Promise<void> {
      try {
        const pending = await queue.listPending();
        if (pending.length === 0) return;
        const replayedIds: string[] = [];
        for (const row of pending) {
          await fanOut(row.event);
          replayedIds.push(row.id);
        }
        await queue.clear(replayedIds);
        await Promise.all(sinks.map((s) => s.flush().catch(() => undefined)));
      } catch (err) {
        await warnSentryAdapter('analytics.flush: drain failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    queueSize: () => queue.size(),
  };
}

/**
 * Default server singleton. Server code MUST import this rather than
 * the browser `analytics` from `./index.ts` to avoid pulling
 * IndexedDB/localStorage code into the Node runtime.
 */
export const serverAnalytics = createServerAnalytics();
