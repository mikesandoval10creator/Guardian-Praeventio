# Current implementation — how telemetry is wired

Snapshot date: 2026-05-04
Branch: `dev/sprint-20-seventh-wave-multi-agent-2026-05-04`

This file describes how telemetry is currently wired in `guardian-praeventio`. It is a factual companion to `.telemetry/current-state.yaml` — it documents the plumbing, not the events. Today the codebase has no product analytics pipeline; it has only an error-tracking pipeline (Sentry). The architecture below is what a future product-analytics adapter would slot alongside.

## SDK and version

| Package | Version | Where |
|---|---|---|
| `@sentry/node` | ^10.51.0 | server runtime |
| `@sentry/react` | ^10.51.0 | browser bundle |

No analytics SDK is installed.

## Initialization

### Browser (`src/lib/sentry.ts`)

- Exports `initSentry()` and `redactPii<T>(event)`.
- Idempotent via a module-level `initialised` flag.
- No-op when `import.meta.env.VITE_SENTRY_DSN` is absent (local dev / CI without secrets).
- Configured with `browserTracingIntegration()` and `replayIntegration({ maskAllText: true, blockAllMedia: true })`.
- Sample rates: `tracesSampleRate: 0.1`, `replaysSessionSampleRate: 0.05`, `replaysOnErrorSampleRate: 1.0`.
- `beforeSend` runs `redactPii` to strip `user.email`/`username`/`ip_address`, redact `cookie`/`authorization` headers, and scrub `lat`/`lng`/`latitude`/`longitude` keys from breadcrumb data.
- Test-only export `__resetForTests()` for vitest.

### Server (`src/services/observability/sentryAdapter.ts`)

- Class `SentryAdapter` implements `ErrorTrackingAdapter` from `./types`.
- `init(options)` no-ops when DSN is absent (logs `console.warn`, never throws).
- Wraps every SDK call in `try { ... } catch` so a Sentry fault cannot break the request path; failures land in `console.warn` (not `logger`, to avoid recursing through observability).
- `tracesSampleRate` defaults to 0.1 when `options.sampleRate` is omitted.
- `beforeSend` strips `authorization` / `cookie` / `set-cookie` headers and runs `scrubUrl` / `scrubQueryString` over `event.request.url` and `event.request.query_string` to redact `token_ws`, `code`, `token`, `session`, `state` (case-insensitive on key name; values become `[REDACTED]`). The hook itself is wrapped in try/catch so a malformed URL never drops the original event.
- Singleton export: `sentryAdapter`.

## Client vs server

Tracking is wired on both sides:

- Browser — `src/lib/sentry.ts` is loaded from the SPA entry. Captures errors, traces, and replays from the React app.
- Server — `src/services/observability/sentryAdapter.ts` is selected by `getErrorTracker()` in `src/services/observability/index.ts` based on `ERROR_TRACKER` env var.

There is no analytics layer on either side.

## Call routing

### Error tracking facade

`src/services/observability/index.ts` exports:

- `getErrorTracker(): ErrorTrackingAdapter` — env-based adapter selection (`ERROR_TRACKER=sentry|noop|cloud`) with silent fall-back to `noop` when the requested adapter is unavailable.
- `getMetrics()` — sister facade for metrics counters.

Adapters implementing `ErrorTrackingAdapter`:

- `sentryAdapter` (real Sentry SDK)
- `noopErrorTrackingAdapter` (in-process AsyncLocalStorage-scoped user context, no transport)
- `cloudErrorReportingAdapter` (stub; `setUserContext` is a no-op)

Per-service helper: `src/services/observability/sentryInstrumentation.ts` exposes a wrapper that calls `Sentry.captureException(err, { level: 'error' })` directly for hot paths that need to bypass the adapter facade (rationale documented in the file header).

### Product analytics

No facade exists. There are no analytics call sites to route.

## Identity management

| Layer | Behavior |
|---|---|
| Auth provider | Firebase Auth (`getAuth(app)` + `GoogleAuthProvider` + `signInWithPopup`). |
| Auth state subscribers | `src/contexts/FirebaseContext.tsx` (`onAuthStateChanged` → React context), `src/hooks/useSessionExpiry.ts` (session-expiry watchdog). |
| Sentry user bridge | `ErrorTrackingAdapter.setUserContext(userId, additionalProps)` on every adapter. The real `sentryAdapter` calls `Sentry.setUser({ id: userId, ...additionalProps })`. |
| Production call sites for `setUserContext` | 0 in `src/**/*.{ts,tsx}` outside `*.test.ts`. The bridge is defined and tested; it is not invoked from auth or middleware code today. |
| Per-event userId | `captureException` and `captureMessage` accept `context.userId` and forward as `user.id` to Sentry on a per-call basis. |
| Logout reset | Not present. `signOut` does not clear Sentry user context. |

## Environment variables

| Var | Read by | Purpose |
|---|---|---|
| `VITE_SENTRY_DSN` | `src/lib/sentry.ts` | browser Sentry DSN |
| `VITE_APP_ENV` | `src/lib/sentry.ts` | browser environment label (falls back to `import.meta.env.MODE`) |
| `VITE_APP_VERSION` | `src/lib/sentry.ts` | browser release label (falls back to `'dev'`) |
| `SENTRY_DSN` | `src/services/observability/sentryAdapter.ts` | server Sentry DSN (also `options.dsn`) |
| `ERROR_TRACKER` | `src/services/observability/index.ts` | adapter selection (`sentry` / `noop` / `cloud`) |

## Error handling

Both Sentry init paths and every adapter method are wrapped in try/catch with `console.warn` fallback. Sentry SDK faults cannot crash the host process or the request path. The browser path is non-blocking by default (Sentry SDK is async).

## Shutdown / flush

- Server adapter exposes `flush(timeout?)` which calls `Sentry.flush(timeout)` inside try/catch (rejection swallowed; in-flight events may drop on the floor rather than block shutdown).
- No call site in `src/**` invokes `flush()` from a process-shutdown hook today.
- Browser side has no explicit flush; relies on Sentry SDK's own beforeunload behaviour.

## What works and is worth preserving

- The `ErrorTrackingAdapter` interface + `getErrorTracker()` facade pattern is clean: env-based selection, silent degradation, swap-in test doubles. A product-analytics layer can copy this shape (e.g., `AnalyticsAdapter` interface, `getAnalytics()` facade, real adapter for the chosen SDK plus a noop adapter for tests/dev without keys).
- PII redaction lives in `beforeSend` so it cannot be skipped by individual call sites.
- Idempotent init guard prevents double-registration on hot reload.
- Try/catch wrapping makes every observability call hot-path safe.

## Open observations

- `setUserContext` is wired through the adapter but no runtime code calls it. Connecting it to the Firebase `onAuthStateChanged` subscriber would attach `user.id` to every captured event automatically, instead of relying on individual call sites passing `context.userId`.
- No logout handler clears Sentry user context after `signOut`.
- No tenant/group context (project, cuadrilla) is attached to Sentry events.
