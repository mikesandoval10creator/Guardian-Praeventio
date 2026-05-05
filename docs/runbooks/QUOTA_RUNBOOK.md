# QUOTA_RUNBOOK — Gemini Per-Tenant Quotas + Circuit Breaker

Sprint 22 prod hardening (Bucket X). This runbook covers the per-tenant
Gemini quota tracker (`src/services/observability/quotaTracker.ts`),
the upstream circuit breaker
(`src/server/middleware/geminiCircuit.ts`), and the admin endpoints
that surface them to ops.

Sister runbooks:
- `INCIDENT_RESPONSE.md` — escalation paths.
- `PERFORMANCE.md` — broader latency/error SLOs.
- `DR_RUNBOOK.md` — Firestore disaster recovery (audit_logs survives
  via `firestoreCriticalReplicate.ts`; quota_usage does NOT — it is
  intentionally treated as ephemeral; rebuild on next request).

---

## 1. Tier limits

Internal Gemini-spend tiers (distinct from the B2D API SKUs in
`aiTier.ts`; the latter are mapped onto these quota tiers via
`normalizeTier`):

| Tier    | Requests/day | Cost ceiling (USD/day) | Notes                            |
| ------- | ------------ | ---------------------- | -------------------------------- |
| bronze  | 100          | 5                      | Default for new / unmapped tiers |
| silver  | 500          | 25                     | B2D `*-base` tiers map here      |
| gold    | 2000         | 100                    | B2D `*-pro` tiers map here       |
| diamond | unlimited    | unlimited              | Soft alert at 500 USD/day        |

Whichever ceiling (requests OR cost) is hit first triggers
`checkQuotaLimit({ allowed: false })` and the dispatcher returns HTTP
429 with reason `requests_exceeded` or `cost_exceeded`.

Diamond does not enforce a hard ceiling. A `[quota.diamond_alert]`
warn log fires once cost crosses 500 USD on a single UTC day —
forward the log to PagerDuty via the Cloud Logging sink configured
in `INCIDENT_RESPONSE.md §4.2`.

---

## 2. Monitoring usage

### 2.1 Live usage for one tenant

```bash
# Operator dashboard / curl
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://praeventio.app/api/admin/quotas?tenantId=$TENANT&date=$(date -u +%F)"
```

Returns `{ ok, usage: { tenantId, date, geminiTokens, geminiRequests, geminiCostUsd } }`.

### 2.2 Top spenders today

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://praeventio.app/api/admin/quotas/global?limit=20"
```

### 2.3 Direct Firestore query (gcloud)

Quota docs live at `quota_usage/{tenantId}__{YYYY-MM-DD}`.

```bash
gcloud firestore documents list \
  --collection-path=quota_usage \
  --filter="date = '$(date -u +%F)'" \
  --project=praeventio-prod
```

Or via the Firestore console:
`https://console.firebase.google.com/project/praeventio-prod/firestore/data/quota_usage`

### 2.4 Circuit breaker state

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://praeventio.app/api/admin/circuit-state"
```

The breaker is in-process. With Cloud Run min-instances=1 and
max-instances=4 (current prod config), call this endpoint up to 4
times to sample every replica. A future Bucket may move state to
Redis; until then, Cloud Monitoring's `gemini_circuit_open_total`
counter is the cross-replica source of truth.

---

## 3. Manually bumping a tenant to a higher tier (temporary)

Two paths:

### 3.1 Tier override (canonical)

Update the tenant's Firebase custom claim `tier` to `gold` or
`diamond`. The next ID-token refresh picks it up automatically;
force-refresh via `admin/revoke-access` if the change must take
effect inside the current 1-hour token window.

```bash
# Replace 'silver' with the desired tier.
node scripts/set-tier.cjs --uid=$TENANT --tier=gold --reason="ticket-1234"
```

### 3.2 Emergency reset (if tenant is throttled mid-incident)

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"tenantId\":\"$TENANT\",\"date\":\"$(date -u +%F)\"}" \
  "https://praeventio.app/api/admin/quotas/reset"
```

Audit-logged at `audit_logs/{auto}` with `action: quota_reset`.
**Document the business reason in the support ticket** — the audit
row captures who/when only.

---

## 4. Investigating an abuse pattern

Symptoms: a tenant burning through quota faster than expected, or a
tenant tripping the circuit breaker repeatedly.

### 4.1 Confirm the spike

```bash
# Pull the last 7 days of daily usage for the tenant.
for d in $(seq 0 6); do
  date_str=$(date -u -d "$d days ago" +%F)
  curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
    "https://praeventio.app/api/admin/quotas?tenantId=$TENANT&date=$date_str"
done
```

A 5–10× jump versus baseline is the classic runaway-loop signature.

### 4.2 Identify the calling code

In Cloud Logging, filter:

```text
resource.type="cloud_run_revision"
labels."tenant_id"="<TENANT>"
jsonPayload.action=~"^(analyze|generate|forecast).*"
timestamp >= "<SPIKE_START>"
```

The action label exposes which `/api/gemini` RPC fired most. Common
culprits:
- `analyzeFastCheck` in a tight retry loop (older client cached an
  expired auth token).
- `processDocumentToNodes` triggered by a misconfigured background
  trigger (every Firestore doc-write fans out to Gemini).

### 4.3 Mitigations

1. **Trip the breaker manually** by directly editing the in-memory
   state via a debug endpoint (NOT exposed in prod — restart the
   instance with `gcloud run services update praeventio-api
   --update-env-vars=DRAIN_AT=$(date +%s)` to spawn fresh replicas
   if state is stuck).
2. **Drop tenant tier to bronze** so the request ceiling kicks in
   harder.
3. **Block at the WAF** if the abuse comes from a single IP.

---

## 5. Alerting setup (Cloud Monitoring)

Required alerts (configure once in `terraform/monitoring/quota.tf`,
not yet committed — track in Bucket Z):

| Alert                               | Condition                                                    | Severity | Channel        |
| ----------------------------------- | ------------------------------------------------------------ | -------- | -------------- |
| Quota gate triggered                | `log_count("[quota.diamond_alert]") > 0` over 1h             | P3       | #ops Slack     |
| Circuit open                        | `metric.gemini_circuit_state == "open"` for > 5min           | P2       | PagerDuty ops  |
| Bronze tenant blocked > 10×/hour    | `count("quota_exceeded") group_by tenantId > 10`             | P3       | #ops Slack     |
| Daily Gemini spend > 1500 USD total | `sum(geminiCostUsd) over today > 1500`                       | P1       | PagerDuty CTO  |

Until those Terraform alerts ship, the Sentry adapter
(`sentryInstrumentation.ts`) emits a breadcrumb for every
`quota_exceeded` and `gemini_circuit_open` 5xx — set up a Sentry
issue alert as the interim coverage layer.

---

## 6. Resetting state during a failed deploy

If a bad deploy poisons the breaker (false-positive failures), the
fastest reset is a Cloud Run revision rollback — the breaker is
in-memory and dies with the replica. No persistent reset needed.

If quota_usage docs are corrupt (rare; the transactional path makes
this very hard), wipe the day:

```bash
# Firestore CLI — delete every doc with today's date suffix.
gcloud firestore documents delete \
  $(gcloud firestore documents list \
      --collection-path=quota_usage \
      --filter="date = '$(date -u +%F)'" \
      --format='value(name)') \
  --project=praeventio-prod --yes
```

This loses one day of accounting. Diamond tenants are unaffected;
others get a fresh ceiling for the rest of the day.

---

## 7. References

- Source: `src/services/observability/quotaTracker.ts`
- Source: `src/server/middleware/geminiCircuit.ts`
- Wiring: `src/server/routes/gemini.ts`
- Admin endpoints: `src/server/routes/admin.ts`
- Tier mapping: `src/services/pricing/aiTier.ts`
- Tests: `quotaTracker.test.ts`, `geminiCircuit.test.ts`
