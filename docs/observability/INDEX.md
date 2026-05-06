# Observability — INDEX

> **Owner**: Daho Sandoval (CEO/CTO) — `dahosandoval@gmail.com`
> **Última revisión**: 2026-05-04 (Sprint 20, 10ª ola, Bucket B)
> **Próxima revisión**: trimestral

Punto de entrada para todo lo que ops necesita para monitorear Praeventio
Guard. Si una tarea no está cubierta por los archivos abajo, este índice
está desactualizado — abrir issue.

---

## 1. Alertas (qué dispara)

- [`SENTRY_ALERTS.md`](./SENTRY_ALERTS.md) — spec narrativo de las 14 reglas (4 P0, 5 P1, 3 P2, 2 P3). Source of truth.
- [`sentry-alerts.yaml`](./sentry-alerts.yaml) — mirror máquina-legible (schemaVersion 1). Cardinality y `id` calzan 1:1 con el doc.

## 2. Dashboards (qué se ve)

- [`SENTRY_DASHBOARDS.md`](./SENTRY_DASHBOARDS.md) — spec narrativo de los 3 dashboards (Overview, SLM Health, Business Critical), 16 widgets totales.
- [`dashboard-praeventio-overview.json`](./dashboard-praeventio-overview.json) — esqueleto JSON del dashboard Overview (placeholder editable; el shape exacto del import API de Sentry puede cambiar).

## 3. Runbooks (qué hacer cuando algo dispara)

- [`../runbooks/INCIDENT_RESPONSE.md`](../runbooks/INCIDENT_RESPONSE.md) — runbook maestro: SLAs por severidad (P0–P3), war room template, 5 categorías de incidente. Las alertas P0/P1 paginan vía los canales documentados aquí.
- [`../runbooks/DR_RUNBOOK.md`](../runbooks/DR_RUNBOOK.md) — disaster recovery: outages regionales, corruption, KMS compromise, full GCP project failure. RTO/RPO por colección.
- [`../runbooks/KMS_ROTATION.md`](../runbooks/KMS_ROTATION.md) — rotación de keys de KMS (procedural + emergency). Driver de la alerta `P0-kms-error`.
- [`../runbooks/CLOUD_BUILD_RUNBOOK.md`](../runbooks/CLOUD_BUILD_RUNBOOK.md) — pipelines CI/CD; relevant cuando un deploy rompe el pipeline de telemetría a Sentry.

## 4. Threat model (por qué algunas alertas existen)

- [`../security/THREAT_MODEL.md`](../security/THREAT_MODEL.md) — modelo de amenazas STRIDE.
- [`../security/STRIDE_findings.md`](../security/STRIDE_findings.md) — findings y mitigaciones. Drivers directos:
  - **TM-T03** → alerta `P0-slm-hmac-mismatch` + `P1-slm-unsigned-legacy` + widget W2.1/W2.2 del dashboard SLM Health.
  - **TM-I03** → alerta `P2-pii-redaction-spike` + widget W2.6 del dashboard SLM Health.
  - **TM-I02** → driver del `redactPii` en `src/lib/sentry.ts:16-83` que filtra GPS/PII antes del transport.
- [`../security/incident-response.md`](../security/incident-response.md) — procedimiento detallado de incidentes de seguridad (subordinado a `INCIDENT_RESPONSE.md` §5.1).
- [`../security/severity-rubric.md`](../security/severity-rubric.md) — severidad para reportes externos.

## 5. Source files (where the signals come from)

> Lista de archivos donde cada alerta/widget tiene su origen. Cualquier cambio
> aquí debe propagarse a `SENTRY_ALERTS.md §3` y `SENTRY_DASHBOARDS.md §2-§4`.

- `src/lib/sentry.ts` — Sentry browser init + PII redaction (`redactPii`) + `captureEmergencyError` con tag `domain:safety_critical`.
- `src/services/observability/sentryInstrumentation.ts` — `withSentryScope` + `withSentryScopeSync` con tag `module=gemini|webpay|prediction|zettelkasten`.
- `src/services/slm/reconciliation.ts` — `slm.queue.hmac_mismatch` (warning) y `slm.queue.unsigned_legacy` (info).
- `src/services/slm/hmac.ts` — `slm.queue.hmac_verify_error` (warning).
- `src/services/observability/piiRedactor.ts` — driver del `pii.redaction` breadcrumb en `geminiBackend.ts:34-39`.
- `src/services/billing/webpayAdapter.ts` — `WebpayAdapterError` + `withSentryScope('webpay', …)`.
- `src/services/geminiBackend.ts` — `withSentryScope('gemini', …)` + `pii.redaction` breadcrumb.
- `src/services/predictionBackend.ts` — `withSentryScope('prediction', …)`.
- `src/services/zettelkasten/persistence/writeNode.ts` — `withSentryScope('zettelkasten', …)`.
- `src/services/analytics/{sinks,queue,adapter}.ts` — breadcrumbs `analytics`, `analytics.queue`, `analytics.adapter`.
- `src/server/routes/organic.ts` — breadcrumb `organic.process`.
- `src/components/shared/ErrorBoundary.tsx` — driver de `captureEmergencyError`.
- `src/contexts/EmergencyContext.tsx` — `captureEmergencyError({ trigger, projectId })`.

## 6. External systems (referidos en las alertas)

Definidos en `memory/reference_external_systems.md`:

- **Sentry** — organización `praeventio`. DSN configurado vía `VITE_SENTRY_DSN` (`src/lib/sentry.ts:3`).
- **Email primario**: `dahosandoval@gmail.com` (configurado como `ownerEmail` default en `sentry-alerts.yaml`).
- **Slack `#praeventio-ops`** — pendiente de crear cuando exista workspace.
- **PagerDuty** — pendiente de contratar (ETA Sprint 22).
- **Telegram bot personal** — fallback de notificación P0/P1 mientras no existe Slack.

## 7. Maintenance plan

| Cadencia | Acción |
|---|---|
| **Trimestral** | Review de alertas (`SENTRY_ALERTS.md` §6) y dashboards (`SENTRY_DASHBOARDS.md` §6). Eliminar low-signal, ajustar thresholds. |
| **Post-incident** | Si una alerta no disparó cuando debía, agregar nueva regla. Si disparó tarde, bajar threshold. Documentar en post-mortem (`INCIDENT_RESPONSE.md` §4.3). |
| **Por ola de Sprint** | Cuando se añaden nuevos signals al código, este docs/observability se actualiza en la **misma** ola, no después. |

## 7.b Cron jobs & scheduling mechanism

Sprint 35 cerró audit P1 §1.3 (cron jobs duplicados en réplicas Cloud
Run). Tabla canónica de qué corre dónde:

| Job | Frecuencia | Mecanismo | RTO si falla |
|---|---|---|---|
| `envPolling` (`updateGlobalEnvironmentalContext`) | 10 min | In-process `setInterval` + Firestore lease (`distributedLease.ts`, TTL 9 min) | 10 min — siguiente tick re-intenta. |
| `projectHealthCheck` (`setupHealthCheckInterval`) | 6 h | In-process `setInterval` + Firestore lease (TTL 5h30m) | 6 h — siguiente tick re-intenta. |
| `check-overdue` (maintenance + PPE + SUSESO + calendar pre-warn) | ~1 h | Cloud Scheduler → `POST /api/maintenance/check-overdue` | 1 h. Idempotente. |
| `aggregate-ai-feedback` (RLHF rollup) | Semanal `0 3 * * 0 UTC` | Cloud Scheduler → `POST /api/admin/jobs/aggregate-ai-feedback` | 1 semana. Idempotente sobre la misma `week`. |

**Lease semantics**: doc en `system/leases/jobs/{jobName}` con
`{ ownerInstance, leaseId, expiresAt, version, acquiredAt }`. Acquire
es transaccional — si N réplicas hacen `setInterval` simultáneamente,
solo 1 escribe el doc; las otras observan el doc fresco y skip el tick.
Ver `src/services/scheduler/distributedLease.ts` + tests.

**Cloud Scheduler endpoints** están todos gateados por
`verifySchedulerToken` (`SCHEDULER_SHARED_SECRET`, constant-time
compare). Failure mode si el secret no está en env: 503 fail-closed.

## 8. Convenciones

- **IDs de alerta**: `<Severidad>-<dominio>-<descripcion-corta>` (e.g. `P0-slm-hmac-mismatch`).
- **IDs de widget**: `W<dashboard-nro>.<widget-nro>` (e.g. `W2.1` = dashboard 2 SLM Health, widget 1).
- **Severidad**: P0–P3 alineada con `INCIDENT_RESPONSE.md` §1. NUNCA agregar un nivel intermedio sin actualizar también el runbook.
- **Cross-link policy**: cada doc en este directorio cross-linkea a runbooks + threat model. La observability es más útil cuando conecta los signals a los procedimientos de respuesta.
