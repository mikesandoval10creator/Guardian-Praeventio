/**
 * Analytics sinks (ninth wave, Bucket D).
 *
 * Three implementations of the `Sink` interface declared in `types.ts`:
 *
 *   1. `noopSink`            — discards every event. Default in tests
 *      and CI to avoid noise. Also the safe fallback when there is no
 *      backend yet (TRACKING_PLAN §9 — backend choice deferred).
 *   2. `consoleSink`         — `console.info('[analytics]', event)`.
 *      Used in dev so engineers see the events as they fire without
 *      booting Sentry.
 *   3. `sentryBreadcrumbSink` — pushes each event as a Sentry breadcrumb
 *      under `category='analytics'`. This is the prod default until a
 *      real product-analytics backend is wired (PostHog is the
 *      recommendation per TRACKING_PLAN §9). Sentry already redacts via
 *      `redactPii` (sixth wave) so the existing PII filter applies on
 *      top of the adapter's PII guard.
 *
 * Sinks NEVER throw — analytics observability must not break user flow.
 * Faults are caught and reported to Sentry as breadcrumbs (best effort).
 */

import type { Event, EventName, Sink } from './types';

/**
 * No-op sink. Used when no real backend is configured (the CI/test
 * default) and as a unit-testable null object.
 */
export const noopSink: Sink = {
  name: 'noop',
  async track(_event: Event<EventName>): Promise<void> {
    /* discard */
  },
  async flush(): Promise<void> {
    /* nothing to flush */
  },
};

/**
 * Dev/console sink. `console.info` rather than `logger` because the
 * project's `logger` may itself be wired through observability — we want
 * to keep analytics output orthogonal to the error stream.
 */
export const consoleSink: Sink = {
  name: 'console',
  async track(event: Event<EventName>): Promise<void> {
    try {
      // eslint-disable-next-line no-console
      console.info('[analytics]', event.name, event.properties);
    } catch {
      /* never let logging faults propagate */
    }
  },
  async flush(): Promise<void> {
    /* console writes are synchronous; nothing buffered */
  },
};

/**
 * Lazy import for `@sentry/core` so this module stays test-friendly
 * (Vitest under node may not have Sentry initialised). We import on
 * every call but the module loader caches it after first hit, so the
 * cost is one resolution per process.
 */
async function safeAddBreadcrumb(
  message: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const Sentry = await import('@sentry/core');
    Sentry.addBreadcrumb({
      category: 'analytics',
      message,
      level: 'info',
      data,
    });
  } catch {
    /* SDK absent or init not yet called — ignore */
  }
}

/**
 * Production sink (until a real backend is picked). Emits one Sentry
 * breadcrumb per event. Cardinality stays bounded because event names
 * are a closed string-literal union (see `types.ts:EventName`).
 */
export const sentryBreadcrumbSink: Sink = {
  name: 'sentry-breadcrumb',
  async track(event: Event<EventName>): Promise<void> {
    await safeAddBreadcrumb(event.name, event.properties as unknown as Record<string, unknown>);
  },
  async flush(): Promise<void> {
    /* breadcrumbs flush with the next captureException — no-op here */
  },
};
