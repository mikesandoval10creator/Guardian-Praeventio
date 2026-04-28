# Production Observability — Operations Runbook

Status: **Round 1 (scaffolding only)** — typed adapter interfaces +
stub implementations + a `noop` adapter that routes through the existing
structured logger. No real Sentry / Cloud Error Reporting / Cloud
Monitoring SDK is installed yet. Round 2 swaps the stubs for real SDKs
without touching call sites.

## 1. Overview

Praeventio Guard's observability stack is a thin **adapter pattern** over
three concerns:

| Concern        | Today                            | Round 2 target              |
| -------------- | -------------------------------- | --------------------------- |
| Structured logs | `src/utils/logger.ts` → Cloud Logging (already wired) | unchanged |
| Error tracking | `noop` adapter → routes to logger | Sentry **or** Cloud Error Reporting |
| Metrics        | `noop` adapter → `logger.debug`  | Cloud Monitoring **or** Prometheus |
| Distributed tracing | not implemented              | OpenTelemetry (deferred — Round 3) |

The adapter pattern mirrors the project's existing precedents:

- `src/services/security/kmsAdapter.ts` — KMS adapter (cloud-kms / in-memory-dev / noop)
- `src/services/sii/siiAdapter.ts`     — SII PSE adapter (openfactura / simpleapi / bsale / libredte / noop)
- `src/services/ai/`                    — Vertex AI adapter

Selection is via env vars; dev/CI defaults to `noop` so missing config
never crashes a boot.

### Files

```
src/services/observability/
  types.ts                          — typed interfaces + ObservabilityNotImplementedError
  errorTrackingAdapter.ts           — re-exports for callers
  sentryAdapter.ts                  — Sentry stub (throws until SDK installed)
  cloudErrorReportingAdapter.ts     — GCP Error Reporting stub
  noopErrorTrackingAdapter.ts       — dev/CI: routes to logger
  metricsAdapter.ts                 — Cloud Monitoring + Prometheus stubs + noop
  index.ts                          — facade: getErrorTracker(), getMetrics()
  observability.test.ts             — TDD coverage of facade + stubs + noop
```

### Environment variables

| Name              | Purpose                                          | Values                                      |
| ----------------- | ------------------------------------------------ | ------------------------------------------- |
| `ERROR_TRACKER`   | Picks the error tracker                          | `sentry`, `cloud-error-reporting`, `noop`   |
| `METRICS_ADAPTER` | Picks the metrics emitter                        | `cloud-monitoring`, `prometheus`, `noop`    |
| `SENTRY_DSN`      | Sentry project DSN (gates `sentryAdapter.isAvailable`) | string                                |
| `GCP_PROJECT_ID`  | Required for `cloud-error-reporting` and `cloud-monitoring` | string                       |
| `PROMETHEUS_ENABLED` | Set to `1` to mark `prometheusAdapter` available | `1` / unset                             |

### Fall-back policy

If a real adapter is selected but `isAvailable === false` (missing DSN /
project ID), `getErrorTracker()` and `getMetrics()` **silently fall back
to `noop`** and emit a `console.warn` (not `logger.warn` — we don't want
to recurse). Rationale: an observability misconfig must NEVER take down
the request path. The noop adapter still routes errors through
`logger.error()`, which lands in Cloud Logging in production — so we
don't actually lose errors, we just lose the dedup/grouping/alerting of a
real tracker.

This is the **opposite** policy from the KMS adapter, which refuses to
silently downgrade. Encryption fall-back is a security bug; observability
fall-back is a reliability win.

## 2. Sentry setup (Round 2)

```bash
npm install @sentry/node @sentry/react
```

Replace the body of `sentryAdapter.ts`:

```ts
import * as Sentry from '@sentry/node';

class SentryAdapter implements ErrorTrackingAdapter {
  init(options) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: options.environment,
      release: options.release,
      tracesSampleRate: options.sampleRate ?? 0.1,
      // Strip known PII keys from event payloads
      beforeSend(event) {
        if (event.request?.headers) delete event.request.headers['authorization'];
        return event;
      },
    });
  }
  captureException(error, ctx) {
    return Sentry.captureException(error, {
      user: ctx?.userId ? { id: ctx.userId } : undefined,
      tags: ctx?.tags,
      extra: ctx?.extra,
    });
  }
  // ... etc.
}
```

Wire-up:

1. **Express (server.ts)**: `Sentry.Handlers.errorHandler()` registered as
   the LAST middleware (after all routes), so unhandled errors land in
   Sentry before the generic 500 handler.
2. **React (src/main.tsx)**: Wrap `<App />` in `<Sentry.ErrorBoundary>`.
3. **Source maps**: Upload via `@sentry/cli` in the build step so the
   stack traces match the original TypeScript.
4. **Release tagging**: pass the git SHA via `release` so
   regressions show up as "first seen in release X".
5. **Environment**: `development` for local, `staging` for the staging
   Cloud Run revision, `production` for the prod revision. Sentry's
   project filters key off this.

DSN provisioning:

- Create a Sentry org + project (Node + React) at https://sentry.io.
- Copy the DSN from project settings.
- Set `SENTRY_DSN` and `ERROR_TRACKER=sentry` in the Cloud Run env vars.

## 3. Cloud Error Reporting setup (Round 2 alternative)

GCP-native alternative to Sentry. No external vendor — useful for
single-cloud deploys, free tier, integrates with Cloud Monitoring alerts.

```bash
npm install @google-cloud/error-reporting
```

Replace the body of `cloudErrorReportingAdapter.ts`:

```ts
import { ErrorReporting } from '@google-cloud/error-reporting';

class CloudErrorReportingAdapter implements ErrorTrackingAdapter {
  private errors: ErrorReporting | null = null;
  init(options) {
    this.errors = new ErrorReporting({
      projectId: process.env.GCP_PROJECT_ID,
      reportMode: options.environment === 'production' ? 'production' : 'always',
      serviceContext: { service: 'praeventio-guard', version: options.release },
    });
  }
  captureException(error, ctx) {
    this.errors!.report(error, undefined, ctx?.extra ?? {});
    return `gcp-${Date.now()}`;
  }
}
```

IAM:

```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CLOUDRUN_SA" \
  --role="roles/errorreporting.writer"
```

Set `GCP_PROJECT_ID` (already set for Firestore / KMS) and
`ERROR_TRACKER=cloud-error-reporting` in Cloud Run env.

Trade-off vs Sentry: Cloud Error Reporting groups by stack trace
fingerprint, but its UI is less rich (no breadcrumbs, no release
comparison view, no PagerDuty native integration). For Praeventio's scale
the free tier is more than enough; pick this if you want one-vendor
simplicity. Pick Sentry if you want richer debugging UX and React
component-stack capture.

## 4. Cloud Monitoring metrics (Round 2)

```bash
npm install @google-cloud/monitoring
```

### Custom metric types

Define in `metricsAdapter.ts:CloudMonitoringAdapter`:

| Metric                                | Type      | Labels                              | What it measures                             |
| ------------------------------------- | --------- | ----------------------------------- | -------------------------------------------- |
| `custom.googleapis.com/api/requests`        | counter   | `route`, `method`, `status_class`   | HTTP request count                           |
| `custom.googleapis.com/api/latency_ms`      | histogram | `route`, `method`                   | HTTP latency distribution                    |
| `custom.googleapis.com/health_connect/sync` | counter   | `provider`, `outcome`               | Health Connect / HealthKit sync attempts     |
| `custom.googleapis.com/calendar/predict`    | histogram | —                                   | Calendar prediction inference latency        |
| `custom.googleapis.com/sii/emit`            | counter   | `pse`, `outcome`                    | DTE emission attempts per PSE                |
| `custom.googleapis.com/webpay/return`       | histogram | `outcome`                           | Webpay return endpoint latency               |
| `custom.googleapis.com/billing/signups`     | counter   | `tier`                              | Sign-ups per day per tier (business KPI)     |

### SLOs

| SLO                                              | Target            | Notes                                           |
| ------------------------------------------------ | ----------------- | ----------------------------------------------- |
| `/api/health` 2xx rate                           | ≥ 99.9% (28d)     | Liveness; if this dips, Cloud Run is restarting |
| Webpay return endpoint p95 latency               | < 5 s             | User-facing checkout completion                 |
| Health Connect adapter success rate              | ≥ 95%             | Success = sync returned at least one data point |
| Calendar predictions p99 latency                 | < 10 s            | Allows for cold-start; user is waiting          |
| SII emission success rate (excl. user errors)    | ≥ 98%             | After Round 2 PSE wiring                        |

## 5. Alerting

Tied to metrics and SLOs above. Cloud Monitoring alert policies are the
primary path; PagerDuty integration is optional.

### Example alert policies

1. **`/api/health` error rate**: trigger if `api/requests{status_class="5xx"}`
   rate > 1% over 5 min for 10 consecutive min. Severity: P1.
2. **Webpay latency**: trigger if `webpay/return` p95 > 7 s for 15 min.
   Severity: P2 (revenue path, but recoverable).
3. **Health Connect failure**: trigger if `health_connect/sync{outcome="failure"}`
   rate > 10% over 1 h. Severity: P3 (data loss risk; user-perceptible only on next sync).
4. **SII emission backlog**: trigger if `sii/emit{outcome="failure"}`
   counter increases by > 5 in 10 min. Severity: P1 (regulatory).
5. **Sentry quota**: trigger if monthly event count > 90% of quota.
   Severity: P3 (noisy errors masking real ones).

Notification channels:

- P1 → PagerDuty + Slack #incidents
- P2 → Slack #engineering
- P3 → email digest

## 6. Dashboards

Two dashboards, mirrored to Cloud Monitoring and Grafana (whichever the
team prefers):

### "Operational" dashboard

Panels:
- Request rate per route (top 10)
- Error rate per route
- Latency p50 / p95 / p99 per route
- Cloud Run revision health (instance count, CPU, memory)
- Firestore read/write QPS
- KMS encrypt/decrypt QPS

### "Business" dashboard

Panels:
- Sign-ups per day, broken down by tier
- Active orgs (DAU / MAU)
- Webpay-completed transactions per day
- DTE emissions per day per PSE
- Health Connect device count by platform (iOS / Android)
- Subscription churn (cancellations - upgrades)

## 7. Disaster recovery for observability

Observability has its own failure modes. Paths to handle:

| Scenario                              | Behaviour                                          | Recovery action                                    |
| ------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| Sentry down                           | `captureException` may throw or hang               | Sentry SDK has a built-in 5s timeout + drop. Errors continue to land in `logger.error` → Cloud Logging. |
| Cloud Logging down                    | `process.stdout.write` still works                 | Cloud Run captures stdout regardless; logs land once Cloud Logging recovers. |
| Cloud Monitoring down                 | Counter / gauge / histogram calls drop on the floor | No app impact; metrics are best-effort. |
| `ERROR_TRACKER=sentry` but no DSN     | Fall back to noop, `console.warn` at startup       | Fix env var; restart. |
| `flush()` called on shutdown but timeout exceeded | resolves anyway (never rejects)        | A few in-flight events lost; acceptable. |

### Observability of the observability layer

- Cloud Logging captures every `logger.warn` / `logger.error`,
  including the fall-back warnings emitted by `getErrorTracker()` /
  `getMetrics()`. Search `[observability]` to find them.
- Sentry health: dashboard tile at https://sentry.io/settings/<org>/quotas/
  showing event count per day. Alerts at 80% of quota.

## Round 2 follow-ups

- [ ] **Sentry SDK install + wiring** — replace `sentryAdapter` stub.
  - [ ] React `Sentry.ErrorBoundary` around root.
  - [ ] Express `Sentry.Handlers.errorHandler()` in server.ts.
  - [ ] Source map upload in build step (`@sentry/cli`).
- [ ] **Cloud Error Reporting** — alternative path; install
  `@google-cloud/error-reporting`, grant IAM, replace stub.
- [ ] **Cloud Monitoring** — install `@google-cloud/monitoring`, define
  custom metric types, replace `cloudMonitoringAdapter` stub. Wire
  middleware to emit `api/requests` + `api/latency_ms` per request.
- [ ] **Prometheus alternative** — install `prom-client`, expose
  `/metrics` endpoint behind `PROMETHEUS_ENABLED=1` flag.
- [ ] **OpenTelemetry distributed tracing** — deferred to Round 3.
  Requires real OTel investment; current adapter pattern doesn't model
  spans yet.
- [ ] **Replace direct `console.log` / `console.error` with logger** —
  audit older code paths in `server.ts` and `src/services/*` for
  unstructured logging.
- [ ] **PII scrubbing** — `beforeSend` hook in Sentry init must strip
  `authorization`, `cookie`, `set-cookie` headers and any field matching
  the SII RUT pattern.
- [ ] **Alert policies as code** — codify the alert policies in §5 as
  Terraform / `gcloud alpha monitoring policies` definitions so they're
  reproducible across staging / prod.
