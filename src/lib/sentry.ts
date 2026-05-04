import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

// Module-level guard so a hot-reloaded `initSentry()` doesn't double-register
// the SDK (each `Sentry.init` re-attaches integrations and global handlers).
let initialised = false;

/**
 * Strip likely-PII fields from a Sentry event before transport.
 *
 * Per the Sigma bucket's PII-safe defaults: keep only `event.user.id` for
 * correlation, redact session/auth headers, and scrub GPS-shaped data from
 * breadcrumbs (Chilean Ley 19.628 protects geolocation as personal data).
 */
export function redactPii<T extends Record<string, unknown>>(event: T): T {
  // event.user.email / username / ip — only `id` should remain so we can
  // correlate sessions in Sentry without storing identity.
  const user = (event as { user?: Record<string, unknown> }).user;
  if (user) {
    delete user.email;
    delete user.username;
    delete user.ip_address;
  }

  // Some SDK versions also stash user info under `event.contexts.user`.
  const contexts = (event as { contexts?: Record<string, unknown> }).contexts;
  if (contexts && typeof contexts === 'object') {
    const ctxUser = (contexts as { user?: Record<string, unknown> }).user;
    if (ctxUser && typeof ctxUser === 'object') {
      delete (ctxUser as Record<string, unknown>).email;
      delete (ctxUser as Record<string, unknown>).username;
      delete (ctxUser as Record<string, unknown>).ip_address;
    }
  }

  // Headers can include `Cookie`, `Authorization`, and proxy auth tokens —
  // redact rather than delete so a Sentry issue still shows that the field
  // *existed* (helps debugging without exposing the secret).
  const request = (event as { request?: Record<string, unknown> }).request;
  if (request && typeof request === 'object') {
    const headers = (request as { headers?: Record<string, unknown> }).headers;
    if (headers && typeof headers === 'object') {
      const h = headers as Record<string, unknown>;
      // Header keys are case-insensitive in HTTP; normalise both shapes.
      for (const key of Object.keys(h)) {
        const lower = key.toLowerCase();
        if (lower === 'cookie' || lower === 'set-cookie' || lower === 'authorization' || lower === 'proxy-authorization') {
          h[key] = '[redacted]';
        }
      }
    }
    // Some SDK versions surface cookies as a top-level `request.cookies` map.
    if ('cookies' in (request as Record<string, unknown>)) {
      (request as Record<string, unknown>).cookies = '[redacted]';
    }
  }

  // Strip GPS-shaped data from breadcrumbs.
  const crumbs = (event as { breadcrumbs?: unknown }).breadcrumbs;
  if (Array.isArray(crumbs)) {
    (event as { breadcrumbs?: unknown }).breadcrumbs = crumbs.map((b: unknown) => {
      if (b && typeof b === 'object' && 'data' in b) {
        const data = (b as { data?: Record<string, unknown> }).data;
        if (data && ('lat' in data || 'lng' in data || 'latitude' in data || 'longitude' in data)) {
          return {
            ...b,
            data: {
              ...data,
              lat: '[scrubbed]',
              lng: '[scrubbed]',
              latitude: '[scrubbed]',
              longitude: '[scrubbed]',
            },
          };
        }
      }
      return b;
    });
  }

  return event;
}

/**
 * Initialise `@sentry/react` exactly once per process. No-op when no DSN
 * is configured (local dev, CI without secrets) so a missing env var never
 * crashes startup. Idempotent — safe to call from `main.tsx` and from tests
 * via the exported guard reset (see `__resetForTests`).
 */
export function initSentry(): void {
  if (initialised) return; // idempotent — guarded against double-init
  if (!dsn) return; // no-op in local dev without DSN

  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_APP_ENV as string | undefined) ?? import.meta.env.MODE,
    release: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev',

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Replay can leak workflow context to support engineers — mask
        // text and block media so a captured replay only shows shapes.
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.05, // 5% of normal sessions
    replaysOnErrorSampleRate: 1.0, // 100% of error sessions

    beforeSend(event) {
      // Sentry's `ErrorEvent` is a structural superset of plain object —
      // `redactPii` works on the field shapes (user, request.headers, etc.)
      // not the SDK's nominal type. Double-cast through `unknown` is the
      // sanctioned TS pattern for crossing into a structurally-typed helper.
      return redactPii(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
  });

  initialised = true;
}

/** Call in safety-critical catch blocks to guarantee the error is captured. */
export function captureEmergencyError(error: unknown, context: Record<string, string>) {
  Sentry.withScope(scope => {
    scope.setTag('domain', 'safety_critical');
    Object.entries(context).forEach(([k, v]) => scope.setTag(k, v));
    Sentry.captureException(error);
  });
}

/**
 * Test-only escape hatch: reset the module-level init guard so each test
 * can verify `Sentry.init` was called (or not) under controlled env vars.
 * NOT exported through any production entrypoint — vitest imports the
 * module directly and reaches in via this named export.
 */
export function __resetForTests(): void {
  initialised = false;
}
