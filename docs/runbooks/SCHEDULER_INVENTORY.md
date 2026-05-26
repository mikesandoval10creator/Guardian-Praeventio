# Scheduler inventory — Cloud Scheduler jobs

Inventario de todos los jobs cron-style del servidor + su endpoint de
invocación + cadencia recomendada en Cloud Scheduler. Última actualización:
2026-05-26 (plan v2 Bloque F6).

Todos los endpoints están gated por `verifySchedulerToken` middleware
(header `X-Scheduler-Token` con `SCHEDULER_SHARED_SECRET`).

## Jobs cada N minutos

| Endpoint | Cadencia | Job | Notas |
|---|---|---|---|
| `POST /api/maintenance/run-lone-worker-escalation` | 5 min | `runLoneWorkerEscalationCron` | Vidas dependen. Escala supervisor → brigade → emergency_services. |

## Jobs horarios

| Endpoint | Cadencia | Job |
|---|---|---|
| `POST /api/maintenance/check-overdue` | 1 h | `checkOverdueMaintenance` + `checkExpiredPpe` + `sendSusesoReminders` + `runCalendarPreWarnCron` + `runResilienceHealthAlertCron` |

## Jobs diarios

| Endpoint | Cadencia | Job |
|---|---|---|
| `POST /api/maintenance/run-daily-housekeeping` | 00:00 UTC | `runExceptionAutoExpire` + `runWorkPermitAutoExpire` + `runLegalCalendarReminders` |
| `POST /api/jobs/aggregate-ai-feedback` | 02:00 UTC | `aggregateAiFeedback` |
| `POST /api/jobs/daily-climate-risk-scan` | 06:00 UTC | `dailyClimateRiskScan` |
| `POST /api/jobs/run-consistency-audit` | 03:00 UTC | `runConsistencyAudit` |

## Jobs semanales

| Endpoint | Cadencia | Job |
|---|---|---|
| `POST /api/jobs/weekly-digest` | Lunes 09:00 UTC | `weeklyDigest` |
| `POST /api/admin/firestore-replicate-critical` | Domingo 04:00 UTC | `firestoreCriticalReplicate` |

## Jobs mensuales

| Endpoint | Cadencia | Job |
|---|---|---|
| `POST /api/maintenance/run-b2d-mrr-snapshot` | Día 1 mes 00:30 UTC | `runB2dMrrSnapshot` |

## Jobs one-shot (manuales, NO en scheduler)

- `consolidateZettelkasten` — migración manual del ZK con `mode: 'commit'`.
  Requiere backup snapshot previo. Ver `docs/runbooks/ZK_CONSOLIDATION_RUNBOOK.md`
  (pendiente crear post-Bloque L4).

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

## Variables de entorno requeridas

- `SCHEDULER_SHARED_SECRET` — secret HMAC (mínimo 32 chars). Setear en
  Secret Manager + leer desde el deploy.yml.
- `GCP_PROJECT_ID` — proyecto donde corre Cloud Scheduler.

## Reconciliación

Para verificar que todos los jobs estén montados:

```bash
gcloud scheduler jobs list --location=southamerica-west1 --format="table(name,schedule,httpTarget.uri)"
```

El conteo esperado de jobs es **10** (1 cada-5-min + 1 horario + 1 diario
combinado + 3 diarios individuales + 1 semanal digest + 1 semanal Firestore
replicate + 1 mensual + 1 reservado para sweeps futuros).

## Cambios en este sprint (2026-05-26, plan v2)

- **Wire URGENTE:** `runLoneWorkerEscalationCron` montado en
  `/api/maintenance/run-lone-worker-escalation`. Vidas dependen — antes el
  job nunca se invocaba.
- **Wire daily:** `runExceptionAutoExpire`, `runWorkPermitAutoExpire`,
  `runLegalCalendarReminders` montados en `/api/maintenance/run-daily-housekeeping`.
  Antes los motores puros derivaban estado pero los docs nunca se materializaban.
