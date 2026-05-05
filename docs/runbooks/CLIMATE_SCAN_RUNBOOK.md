# Climate Risk Daily Scan — Runbook

Sprint 25 Bucket TT.

## What it does

Every day at 05:00 Santiago (08:00 UTC) the cron hits
`POST /api/admin/jobs/climate-scan` and runs `runDailyClimateRiskScan`,
which:

1. Lists all `projects` documents with `status == 'active'` and
   `outdoor == true` across all tenants (Firestore collectionGroup query).
2. For each project, fetches a 3-day forecast via the existing
   `environmentBackend.getForecast(days, geo)` wrapper (OpenWeather; falls
   back to the Santiago default coords if the project has no `geo` field).
3. Calls the pure `buildClimateRiskNodes(forecasts, [project])` from
   `services/zettelkasten/climateRiskCoupling.ts` to produce the per-day
   `ClimateRiskAssessment`s plus Bernoulli-driven Venturi / Windload
   warnings (NCh 432).
4. Persists each assessment to `zettelkasten_nodes` with a SHA-256
   idempotency key (so re-runs the same day collapse to the same docs).
5. For nodes whose severity is `>= medium`, multicasts an FCM notification
   to the project's `supervisorUids`.
6. Appends an `audit_logs` row with the action `climate.daily_scan.completed`.

The orchestrator is dependency-injected (`src/server/jobs/dailyClimateRiskScan.ts`)
and unit-tested in `dailyClimateRiskScan.test.ts` — the only non-pure
side at runtime is the four DI seams (`listActiveProjects`,
`fetchForecast`, `persistNodes`, `sendFcmMulticast`, `audit`), which the
admin endpoint wires to firebase-admin / `getForecast`.

## One-time Cloud Scheduler setup

```bash
PROJECT_ID="guardian-praeventio"   # adjust if needed
SERVICE_URL="https://guardian-praeventio-XXXXX.run.app"

# 1. Create the service account that Cloud Scheduler will impersonate.
gcloud iam service-accounts create climate-scan-sa \
  --display-name="Climate scan invoker" \
  --project="$PROJECT_ID"

# 2. Grant it run.invoker on the Cloud Run service.
gcloud run services add-iam-policy-binding guardian-praeventio \
  --member="serviceAccount:climate-scan-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=southamerica-west1 \
  --project="$PROJECT_ID"

# 3. Create the Cloud Scheduler job — daily at 05:00 Santiago.
gcloud scheduler jobs create http climate-daily-scan \
  --schedule="0 8 * * *" \
  --uri="$SERVICE_URL/api/admin/jobs/climate-scan" \
  --http-method=POST \
  --oidc-service-account-email="climate-scan-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --time-zone="America/Santiago" \
  --location="southamerica-west1" \
  --project="$PROJECT_ID"
```

The endpoint is gated by `verifyAuth` + `assertAdminCaller`, so the
service account also needs to map to a Firebase Auth user with `role`
custom-claim in `ADMIN_ROLES`. This is identical to the gating used by
`POST /api/admin/jobs/weekly-digest`; reuse the same admin SA token
flow.

## Manual trigger (incident replay)

```bash
ID_TOKEN=$(gcloud auth print-identity-token)
curl -X POST \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  "$SERVICE_URL/api/admin/jobs/climate-scan"
```

Response shape:

```json
{
  "ok": true,
  "result": {
    "startedAt": 1746345600000,
    "completedAt": 1746345603000,
    "projectsScanned": 137,
    "forecastsFetched": 411,
    "nodesGenerated": 248,
    "nodesPersisted": 248,
    "notificationsSent": 89,
    "notificationsFailed": 2,
    "errors": []
  }
}
```

## Monitoring

- **Audit log query** (Firestore console / BigQuery export):

  ```
  collection: audit_logs
  where: action == "climate.daily_scan.completed"
  order by ts desc, limit 30
  ```

  The `details` field carries `projectsScanned`, `nodesGenerated`,
  `notificationsSent`, `notificationsFailed`, `durationMs`, `errorCount`.

- **Sentry alert thresholds**:
  - `errorCount > 0` for two consecutive runs ⇒ P2 alert.
  - `notificationsFailed / (notificationsSent + notificationsFailed) > 0.5`
    ⇒ P1 alert (FCM token sweep needed).
  - `durationMs > 120_000` ⇒ P3 (job is taking longer than expected;
    scale Cloud Run or shrink the project window).

- **Idempotency check**: a re-run of the same day MUST keep
  `nodesPersisted` stable in Firestore (writes target the same SHA-256
  doc IDs via `nodeIdFor`). If the doc count keeps growing day over day
  for a single project, investigate `nodeIdFor` determinism.

## Costs

For a 250-project tenant universe:

- OpenWeather free tier: 250 projects × 1 forecast/day = 250 calls/day,
  well under the 1k/day quota. No marginal cost.
- Firestore writes: 250 projects × ~3 nodes/day ≈ 750 writes/day.
  At $0.18/100k that is < $0.01/day.
- FCM multicast: free.
- Cloud Scheduler: $0.10/job/month.

Total: **≈ $0.50/day** including infra overhead.

## Rollback

The endpoint is idempotent, so disabling the cron is safe:

```bash
gcloud scheduler jobs pause climate-daily-scan \
  --location=southamerica-west1
```

To resume: `gcloud scheduler jobs resume climate-daily-scan ...`.

## Related modules

- Orchestrator: `src/server/jobs/dailyClimateRiskScan.ts`
- Tests: `src/server/jobs/dailyClimateRiskScan.test.ts`
- Pure rules: `src/services/zettelkasten/climateRiskCoupling.ts`
- Forecast wrapper: `src/services/environmentBackend.ts` (`getForecast`)
- ZK persistence: `src/services/zettelkasten/persistence/writeNode.ts`
- Admin endpoint: `src/server/routes/admin.ts` → `/jobs/climate-scan`
