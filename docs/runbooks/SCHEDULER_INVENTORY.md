# Scheduler inventory — Cloud Scheduler jobs

Inventario de todos los jobs cron-style del servidor + su endpoint de
invocación + cadencia recomendada en Cloud Scheduler. Última actualización:
2026-08-18 (Discovery 2026-08-17, ticket 3bfaa66d-73fe-8173-ad1e-c652e00ad3a2).

Todos los endpoints están gated por `verifySchedulerToken` middleware
(header `X-Scheduler-Token` con `SCHEDULER_SHARED_SECRET`).

> **Convención**: los jobs listados como `run-daily-housekeeping` se ejecutan
> **dentro** del cron `daily-housekeeping` (00:00 UTC diario). Algunos de
> ellos tienen cadencia efectiva más alta cuando están separados (ej.
> `runDteIssueQueueDrain` cada 10 min) — esos están listados en su propia
> fila. Los jobs solo-listados-aqui (no tienen cron dedicado) corren
> diariamente a las 00:00 UTC a través del housekeeping consolidado.

## Jobs cada N minutos

| Endpoint | Cadencia | Job | Notas |
|---|---|---|---|
| `POST /api/maintenance/run-lone-worker-escalation` | 5 min | `runLoneWorkerEscalationCron` | Vidas dependen. Escala supervisor → brigade → emergency_services. |
| `POST /api/maintenance/run-man-down-escalation` | 1 min | `runManDownEscalationCron` | Vidas dependen. Cada minuto (no 5) porque el trabajador puede estar inconsciente. Thresholds 60/240/540s. |
| `POST /api/maintenance/run-dte-issue-queue-drain` | 10 min | `runDteIssueQueueDrain` | SII Res. Ex. 80/2014 obliga a entregar boleta dentro de 24h de pago. Daily-housekeeping puede ser muy tarde si hay cola grande. |

## Jobs horarios

| Endpoint | Cadencia | Job |
|---|---|---|
| `POST /api/maintenance/check-overdue` | 1 h | `checkOverdueMaintenance` + `checkExpiredPpe` + `sendSusesoReminders` + `runCalendarPreWarnCron` + `runResilienceHealthAlertCron` |
| `POST /api/maintenance/run-check-expired-brigade-resources` | 1 h | `checkExpiredBrigadeResources` |

## Jobs diarios

| Endpoint | Cadencia | Job |
|---|---|---|
| `POST /api/maintenance/run-daily-housekeeping` | 00:00 UTC | `runExceptionAutoExpire` + `runWorkPermitAutoExpire` + `runLegalCalendarReminders` + `runLegalObligationReconcile` + `runUfRateRefresh` |
| `POST /api/maintenance/run-compliance-snapshot` | 02:30 UTC | `runComplianceSnapshot` |
| `POST /api/jobs/aggregate-ai-feedback` | 02:00 UTC | `aggregateAiFeedback` |
| `POST /api/jobs/run-consistency-audit` | 03:00 UTC | `runConsistencyAudit` |
| `POST /api/maintenance/run-slo-metrics-refresh` | 03:30 UTC | `runSloMetricsRefresh` |
| `POST /api/jobs/daily-climate-risk-scan` | 06:00 UTC | `dailyClimateRiskScan` |

## Jobs semanales

| Endpoint | Cadencia | Job |
|---|---|---|
| `POST /api/maintenance/run-retention-sweep` | Domingo 04:00 UTC | `runRetentionSweep` |
| `POST /api/jobs/weekly-digest` | Lunes 09:00 UTC | `weeklyDigest` |
| `POST /api/admin/firestore-replicate-critical` | Domingo 04:00 UTC | `firestoreCriticalReplicate` |

## Jobs mensuales

| Endpoint | Cadencia | Job |
|---|---|---|
| `POST /api/maintenance/run-b2d-mrr-snapshot` | Día 1 mes 00:30 UTC | `runB2dMrrSnapshot` |
| `POST /api/maintenance/run-contractor-ranking-snapshot` | Día 1 mes 02:00 UTC | `runContractorRankingSnapshot` |

## Jobs one-shot (manuales, NO en scheduler)

- `consolidateZettelkasten` — migración manual del ZK con `mode: 'commit'`.
  Requiere backup snapshot previo. Ver `docs/runbooks/ZK_CONSOLIDATION_RUNBOOK.md`
  (pendiente crear post-Bloque L4).
- `expiryFindings` — helper interno invocado desde
  `checkExpiredBrigadeResources` y `checkExpiredPpe`. No expone endpoint HTTP
  propio (es la materialización de findings tras la detección de expiry).

## Cloud Scheduler provisioning

Cuando provisiones cada job en Cloud Scheduler (vía GCP Console o gcloud):

```bash
gcloud scheduler jobs create http <job-name> \
  --location=southamerica-west1 \
  --schedule="<crontab>" \
  --uri="https://<your-cloud-run-url>/api/<endpoint>" \
  --http-method=POST \
  --headers="X-Scheduler-Token=$SCHEDULER_SHARED_SECRET" \
  --attempt-deadline=300s \
  --time-zone="America/Santiago"
```

Para el lone-worker-escalation (5 min):

```bash
gcloud scheduler jobs create http lone-worker-escalation \
  --location=southamerica-west1 \
  --schedule="*/5 * * * *" \
  --uri="https://praeventio-app-xxx.run.app/api/maintenance/run-lone-worker-escalation" \
  --http-method=POST \
  --headers="X-Scheduler-Token=$SCHEDULER_SHARED_SECRET" \
  --attempt-deadline=300s \
  --time-zone="UTC"
```

**Convención 2026-08-18**: el deploy.yml del repo (`.github/workflows/deploy.yml`)
provisiona los crons automáticamente. NO crear crons manualmente fuera del
deploy.yml — el próximo deploy los borrará. Si necesitás un cron nuevo,
agregá su `ensure_job` en el step correspondiente del deploy.yml.

## Variables de entorno requeridas

- `SCHEDULER_SHARED_SECRET` — secret HMAC (mínimo 32 chars). Setear en
  Secret Manager + leer desde el deploy.yml.
- `GCP_PROJECT_ID` — proyecto donde corre Cloud Scheduler.
- `SENTRY_API_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT_ID` — requeridos por
  `runSloMetricsRefresh` (honest-gate: si no están, el job hace fail-soft
  y `slo_metrics/{sloId}/daily` queda sin actualizar).

## Reconciliación

Para verificar que todos los jobs estén montados:

```bash
gcloud scheduler jobs list --location=southamerica-west1 --format="table(name,schedule,httpTarget.uri)"
```

**Conteo esperado tras el cambio 2026-08-18** (16 crons en Scheduler):

| Categoría | Cantidad |
|---|---|
| Cada N minutos (life-safety + DTE) | 3 |
| Horarios | 2 |
| Diarios (incluye housekeeping combinado) | 6 |
| Semanales | 3 |
| Mensuales | 2 |
| **Total** | **16** |

## Cambios en este sprint (2026-08-18, ticket 3bfaa66d-...)

- **Wire URGENTE**: 10 jobs que existían como código y endpoint pero no
  estaban reflejados en este inventario. Auditoría manual con bash
  (`ls src/server/jobs/*.ts` cruzado con `rg -l <nombre> deploy.yml`)
  confirmó que **5 corren vía housekeeping diario** (`runLegalObligationReconcile`,
  `runUfRateRefresh`, `runLegalCalendarReminders` ya estaba listado,
  `runExceptionAutoExpire` + `runWorkPermitAutoExpire` ya estaban),
  **1 ya tiene cron dedicado** (`runManDownEscalationCron` como
  `man-down-escalation` desde OLA 1), y **4 ganan crons dedicados** en
  este PR: `runDteIssueQueueDrain` (10 min por SII 24h), `checkExpiredBrigadeResources`
  (1h por vida-safety indirecto), `runComplianceSnapshot` (diario 02:30),
  `runSloMetricsRefresh` (diario 03:30).
- `runContractorRankingSnapshot` se mueve a crontab dedicado mensual
  (Día 1 mes 02:00 UTC) en vez de vivir dentro del housekeeping diario
  (donde igual se invoca una vez pero el crontab dedicado documenta la
  cadencia real).
- `runRetentionSweep` se mueve a crontab dedicado semanal (Domingo 04:00 UTC).
- `expiryFindings` se reclasifica como helper interno (no expone endpoint).