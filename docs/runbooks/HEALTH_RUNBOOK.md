# Health Endpoints + Tracing Runbook

Sprint 22 Bucket AA. Operational reference for `/api/health`,
`/api/health/deep`, request-id correlation, and OpenTelemetry traces.

## Endpoint matrix

| Endpoint | Auth | Use case | Side effects | Latency budget |
| --- | --- | --- | --- | --- |
| `GET /api/health` | none | Liveness probe (Cloud Run, Marketplace) | Single Firestore `listCollections()` admin op | < 200 ms |
| `GET /api/health/deep` | none | Ops dashboard / incident triage | Hits Firestore, KMS, Gemini list-models, Resend `/domains`, Open-Meteo, optional photogrammetry worker | < 2 s per check, all in parallel |

Status codes:

- `200 OK` — every required check returned `ok=true`.
- `503 Service Unavailable` — at least one required check failed (`ok=false`). Optional checks marked `skipped: true` are treated as healthy for the global verdict.

The deep endpoint is **not** a Cloud Run liveness probe. Liveness probes
must stay on `/api/health` to avoid cascading external API failures into
restart loops.

## When to use which

- Cloud Run / load balancer health probe → `/api/health`.
- StatusPage / Pingdom synthetic check → `/api/health/deep`.
- Incident triage when symptoms are "AI requests failing" or "emails not
  sending" → `curl /api/health/deep | jq` to isolate the dependency.
- Pre-deploy smoke test → both, but only block the rollout on
  `/api/health`. Treat `/api/health/deep` failures as alerts, not gates.

## Probe behavior

Every probe runs through `withTimeout(probe, 2000)`. A probe that hangs
returns `{ ok: false, error: "timeout_2000ms" }` and does NOT block the
other checks (concurrent execution via `Promise.allSettled`).

Optional probes that are unconfigured in the current environment (e.g.
`PHOTOGRAMMETRY_WORKER_URL` unset in dev) return `{ ok: true, skipped: true, latencyMs: <ms> }`.

Sample healthy response:

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2026-05-04T12:34:56.000Z",
  "checks": {
    "firestore":      { "ok": true,  "latencyMs": 41 },
    "kms":            { "ok": true,  "latencyMs": 88 },
    "gemini":         { "ok": true,  "latencyMs": 312 },
    "resend":         { "ok": true,  "latencyMs": 145 },
    "openMeteo":      { "ok": true,  "latencyMs": 220 },
    "photogrammetry": { "ok": true,  "skipped": true, "latencyMs": 0 }
  }
}
```

Sample degraded response:

```json
{
  "status": "degraded",
  "checks": {
    "firestore": { "ok": true,  "latencyMs": 41 },
    "kms":       { "ok": true,  "latencyMs": 90 },
    "gemini":    { "ok": false, "error": "timeout_2000ms", "latencyMs": 2003 },
    "resend":    { "ok": true,  "latencyMs": 110 },
    "openMeteo": { "ok": true,  "latencyMs": 187 },
    "photogrammetry": { "ok": true, "skipped": true, "latencyMs": 0 }
  }
}
```

## Per-probe failure interpretation

| Probe | `error` shape | Likely cause | First action |
| --- | --- | --- | --- |
| `firestore` | `timeout_2000ms` / `PERMISSION_DENIED` | IAM revocation, regional outage | Cloud Run service account, Firestore region status |
| `kms` | `kms_adapter_unavailable` / KMS error | `KMS_KEY_RESOURCE_NAME` unset, key disabled | Check KMS console; see `KMS_ROTATION.md` |
| `gemini` | `gemini_status_4xx` / `5xx` | API key revoked, quota exhausted, model deprecated | Check `geminiCircuit` + per-tenant quota dashboards |
| `resend` | `resend_unauthorized` / `5xx` | API key rotated without redeploy | Refresh `RESEND_API_KEY` via Secret Manager |
| `openMeteo` | `open_meteo_status_*` | Upstream outage (rare; provider is reliable) | Wait + retry; environment context degrades silently in app code |
| `photogrammetry` | `photogrammetry_status_*` / `timeout_2000ms` | Worker fleet down or env URL stale | Check Cloud Run `photogrammetry-worker` revision logs |

## Request ID correlation

Every inbound request to the API is tagged with `X-Request-ID`. Behavior:

- Client may supply one in the request header. Format
  `^[A-Za-z0-9_\-:.]{1,128}$`. If missing or malformed, the server
  generates a fresh `crypto.randomUUID()`.
- The server echoes the id back in the response `X-Request-ID` header.
- Inside the handler chain, every `logger.*` call emits a `request_id`
  field automatically. No need to thread it through helper functions —
  it propagates via `AsyncLocalStorage`.
- When OpenTelemetry is wired with an exporter, the active `trace_id` is
  also auto-attached to log lines as `trace_id`.

Investigation flow when a customer reports an incident:

1. Ask the customer for the `X-Request-ID` value from their browser
   devtools or the support form.
2. In Cloud Logging:

   ```
   jsonPayload.request_id = "<id>"
   ```

3. The matching `trace_id` (when present) lets you jump straight to the
   trace in Cloud Trace / Jaeger.

## OpenTelemetry tracing

`src/services/observability/tracing.ts` exposes:

- `initTracing(serviceName)` — boot-time hook, called from `server.ts`.
  No-op when the OTel SDK packages aren't installed AND
  `OTEL_EXPORTER_OTLP_ENDPOINT` is unset; in that case logs include the
  span name + duration as a fallback so the pattern is still in code.
- `tracedAsync(spanName, attributes, fn)` — wrap an async business call.
  Attributes show up on the span; failures are recorded with
  `SpanStatusCode.ERROR + recordException` and re-thrown so caller
  control flow is unchanged.
- `getActiveTraceId()` — read the current trace id (used by the
  request-id middleware).

Currently wrapped call sites:

- `/api/ask-guardian` → `ask-guardian.generateContent`
- `/api/gemini` → `gemini.dispatch`
- `/api/zettelkasten/nodes` → `zettelkasten.nodes.write`
- `/api/emergency/sos` → `emergency.sos.fanout`
- `/api/billing/checkout` → `billing.checkout.webpay` / `billing.checkout.stripe`

### Enabling real export

```bash
# Cloud Trace (via OTel collector sidecar)
export OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4318/v1/traces"
export OTEL_TRACES_EXPORTER="otlp"

# OR local Jaeger for dev
docker run -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318/v1/traces"
```

Then install the SDK packages:

```bash
npm install \
  @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

`initTracing` will auto-detect the SDK on next boot and switch from
api-only mode to real OTLP export.

### Searching a trace

Cloud Trace UI: filter by `service.name = praeventio-guard` and either
`request_id` (custom attribute) or the user's reported X-Request-ID.

Jaeger UI: same — service `praeventio-guard`, then filter spans by tag
`request_id=<id>`.

## Smoke test recipe

```bash
# Liveness — must always 200
curl -s -o /dev/null -w "%{http_code}\n" https://app.praeventio.cl/api/health

# Deep — full dependency fan-out
curl -s https://app.praeventio.cl/api/health/deep | jq

# Round-trip a custom X-Request-ID
curl -s -H 'X-Request-ID: rt-2026-05-04-001' https://app.praeventio.cl/api/health -i | grep -i x-request-id
```
