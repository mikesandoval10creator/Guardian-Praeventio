# Scheduler inventory — endpoints, cadencias y provisioning versionado

Inventario de endpoints cron-style del servidor, cadencias documentadas y
provisioning versionado localizado. Última actualización: 2026-11-12
(revisión parcial de rutas, cadencias y zonas horarias desde el código; sin
lectura de GCP).

El contrato previsto usa `verifySchedulerToken` (header `X-Scheduler-Token`
con `SCHEDULER_SHARED_SECRET`). La verificación exhaustiva por endpoint y el
estado live de GCP siguen bajo el ticket P1 de reconciliación operativa; este
archivo no demuestra que un job exista, esté habilitado ni haya ejecutado.

> **Convención**: la fila `run-daily-housekeeping` enumera las funciones que
> el endpoint invoca en `maintenance.ts` y se programa diariamente a las
> 00:00 `America/Santiago` en el workflow. Los jobs con ruta y cadencia propia
> aparecen aparte; una cadencia documentada no demuestra provisioning. Las
> discrepancias pendientes se señalan en «Gaps de wiring/provisioning».

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
| `POST /api/admin/replicate-critical` | Cada hora, minuto 30 | `replicateCriticalData` |

## Jobs diarios

| Endpoint | Cadencia | Job |
|---|---|---|
| `POST /api/maintenance/run-daily-housekeeping` | 00:00 America/Santiago | `runExceptionAutoExpire` + `runWorkPermitAutoExpire` + `runLegalCalendarReminders` + `runLegalObligationReconcile` + `runUfRateRefresh` |
| `POST /api/maintenance/run-compliance-snapshot` | 02:30 America/Santiago | `runComplianceSnapshot` |
| `POST /api/maintenance/run-slo-metrics-refresh` | 03:30 America/Santiago | `runSloMetricsRefresh` |
| `POST /api/admin/jobs/climate-scan` | 05:00 America/Santiago | `dailyClimateRiskScan` |

## Jobs semanales

| Endpoint | Cadencia | Job |
|---|---|---|
| `POST /api/maintenance/run-retention-sweep` | Domingo 04:00 (cadencia histórica; zona/provisioning por validar) | `runRetentionSweep` (archive-only, ADR-0024) |
| `POST /api/admin/jobs/weekly-digest` | Lunes 09:00 America/Santiago | `weeklyDigest` |
| `POST /api/admin/jobs/aggregate-ai-feedback` | Lunes 08:00 America/Santiago | `aggregateAiFeedback` |

## Jobs mensuales

| Endpoint | Cadencia | Job |
|---|---|---|
| `POST /api/maintenance/run-b2d-mrr-snapshot` | Día 1, 00:30 America/Santiago (`30 0 1 * *`) | `runB2dMrrSnapshot` |
| `POST /api/maintenance/run-contractor-ranking-snapshot` | Día 1, 02:00 (cadencia histórica; zona/provisioning por validar) | `runContractorRankingSnapshot` |

> **Reconciliación 2026-11-12:** el helper `ensure_job` en
> `.github/workflows/deploy.yml` aplica `--time-zone=America/Santiago`; el job
> climático define esa zona explícitamente. Así se interpretan las horas locales
> de housekeeping, compliance, SLO, digest, RLHF, replicación y B2D. El workflow
> todavía conserva comentarios/descripciones que dicen UTC para algunos jobs;
> la bandera `--time-zone` es la configuración versionada efectiva. El validador
> estático comprueba nombre, cron y endpoint, pero no timezone. El comentario y la
> descripción de `daily-housekeeping` en `deploy.yml` dicen que corre 9 jobs,
> incluidos DTE y brigada; el handler `maintenance.ts:1143-1449` ejecuta cinco:
> excepciones, permisos, conciliación legal, recordatorios y UF. DTE y brigada tienen
> endpoints separados en este inventario; esa discrepancia sigue en el ticket P1.
>
> No se encontró provisioning de `runContractorRankingSnapshot` ni
> `runRetentionSweep` en `.github/workflows` o `infrastructure/terraform`; sus
> cadencias son objetivos históricos, no schedules confirmados. No hubo
> read-back de GCP.

## Gaps de wiring/provisioning (reconciliados 2026-11-12)

- `runConsistencyAuditCron` existe en `src/server/jobs/runConsistencyAudit.ts`,
  pero no existe la ruta cron `POST /api/jobs/run-consistency-audit` en el
  router ni caller del job. La fila anterior se retiró; no programar hasta que
  exista un endpoint y el contrato se valide.
- `runRetentionSweep` (`maintenance.ts:602`) y
  `runContractorRankingSnapshot` (`maintenance.ts:1474`) sí tienen rutas, pero
  no se encontró provisioning correspondiente en `.github/workflows` ni en
  `infrastructure/terraform`. Sus cadencias siguen siendo objetivos del runbook,
  no schedules confirmados.
- Estado de los recursos externos sin verificar: no hubo read-back de GCP. El
  ticket P1 de reconciliación operativa permanece `In-progress`.

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
- `DTE_AUTO_ISSUE` — el drain queda fail-closed cuando no es `true`; al
  habilitarlo, revisar `skippedLeased`, `reclaimedFromStale`, `legacyStuck`
  y `completionLost` en la respuesta/log del maintenance job.

Para una operación normal, `dte_issue_claims/{idempotencyKey}` debe contener
solo leases activos durante la emisión. Un `legacyStuck` o un
`completionLost` requiere revisar el invoice y el PSE antes de intervenir;
no se debe forzar una segunda emisión sin confirmar la deduplicación de Bsale.

## Reconciliación

Para verificar que todos los jobs estén montados:

```bash
gcloud scheduler jobs list --location=southamerica-west1 --format="table(name,schedule,httpTarget.uri)"
```

**Conteo del snapshot 2026-08-18** (16 filas de aquella versión. La reconciliación
posterior retiró una ruta inexistente; no es el conteo actual ni un read-back de GCP):

| Categoría | Cantidad |
|---|---|
| Cada N minutos (life-safety + DTE) | 3 |
| Horarios | 2 |
| Diarios (incluye housekeeping combinado) | 6 |
| Semanales | 3 |
| Mensuales | 2 |
| **Total** | **16** |

## Historial de cambios documentales (2026-08-18; no confirma estado live de GCP)

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
- `runContractorRankingSnapshot` recibió una cadencia mensual objetivo en este
  runbook (Día 1, 02:00 UTC). La revisión 2026-11-12 no encontró su provisioning
  en `deploy.yml` ni Terraform; no tratarlo como cron confirmado.
- `runRetentionSweep` recibió una cadencia semanal objetivo (Domingo 04:00 UTC),
  en modo archive-only conforme al ADR-0024; la revisión 2026-11-12 no encontró
  provisioning en `deploy.yml` ni Terraform.
- `expiryFindings` se reclasifica como helper interno (no expone endpoint).
