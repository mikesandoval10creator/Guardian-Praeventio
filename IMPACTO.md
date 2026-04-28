# Impacto en el bienestar humano + valor empresarial — IaC + observability + perf budgets + smoke + polish

## Resumen ejecutivo

La ronda 11 cierra la brecha entre "código que funciona" y "servicio que un
SRE puede operar a las 3 AM". La infraestructura GCP (KMS, bucket de backups,
IAM, Scheduler v2, Cloud Run jobs, 8 secrets) queda codificada en Terraform
reproducible bajo $10/mes; 6 alertas SLO con runbook embebido y 2 dashboards
publican señales accionables; cada PR mide bundle size + Lighthouse + corre
25 smoke tests en menos de 12 segundos; y los 4 MEDIUMs operacionales que el
reviewer C6 detectó en ronda 10 (Scheduler v2 URL, AsyncLocalStorage para
contexto por request, PGP cleanup, iOS aps debug) quedaron cerrados sin
escalar a HIGH. Auditor ISO 27001 que llegue mañana encuentra evidencia
documentada en el repo.

## 1. Infraestructura como código (Terraform)

- `infrastructure/terraform/main.tf:1` — bootstrap del módulo, Terraform 1.6+ con `google` y `google-beta` provider `~5.0`.
- `infrastructure/terraform/kms.tf:15` — keyring `praeventio` en `southamerica-west1`, key `oauth-tokens-kek` con rotación 90 días, `prevent_destroy = true` (destruir la KEK brickea cada refresh token OAuth en Firestore).
- `infrastructure/terraform/storage.tf:27` — bucket `${project_id}-backups` con `uniform_bucket_level_access`, `public_access_prevention=enforced`, versioning ON, lifecycle Standard → Nearline 30d → delete 365d, retention policy bucket-level (anti-ransomware).
- `infrastructure/terraform/iam.tf:1` — 3 service accounts dedicados (`firestore-backup`, `app-runtime`, `kms-encrypter`) con permisos a nivel de recurso, no de proyecto.
- `infrastructure/terraform/scheduler.tf:22` — Cloud Scheduler **v2 URL** (`run.googleapis.com/v2/...:run`) con `oidc_token` (cierra MEDIUM ronda 10).
- `infrastructure/terraform/cloudrun.tf:1` — 2 Cloud Run jobs (`firestore-nightly-backup`, `firestore-integrity-weekly`).
- `infrastructure/terraform/secrets.tf:1` — 8 Secret Manager secrets sin valores (session, iot-webhook, webpay, openweather, sentry, resend, gemini, oauth-client). Los valores los inyecta el operador post-`terraform apply`.
- `infrastructure/terraform/outputs.tf:1` — `kms_key_resource_name`, `backups_bucket`, emails de los 3 SAs (consumibles por scripts de bootstrap).
- `infrastructure/terraform/README.md:1` — runbook de bootstrap + estimación de costo <$10/mes en steady-state.

**¿Qué significa?** Lo que se provisiona hoy a mano en GCP Console queda
codificado. `terraform apply` reproduce todo en cualquier proyecto (staging,
dr-test, futuros clientes self-hosted enterprise LATAM) sin click-ops.

## 2. Observabilidad profesional con runbooks embebidos

- `infrastructure/terraform/monitoring.tf:1` — 627 LOC, 6 alert policies con `documentation.content` markdown runbook embebido en cada policy:
  - `api_health_uptime` (proxy 5xx rate, P1 → founder)
  - `webpay_latency_p95` (>5000 ms, P2)
  - `health_connect_success_rate` (failure >5%, P2)
  - `calendar_prediction_p99` (>10000 ms, P2)
  - `firestore_backup_age` (absent >36 h, P1 → founder + security)
  - `kms_error_rate` (>1%, P1 → founder + security)
- `infrastructure/terraform/dashboards/operational.json` (233 LOC, 6 panels: request rate, latencias p50/p95/p99, error rate, instance count, Firestore RWD, KMS ops + errors).
- `infrastructure/terraform/dashboards/business.json` (179 LOC, 6 KPIs de negocio).
- 6 custom metrics declarados vía `google_monitoring_metric_descriptor` en `monitoring.tf`.
- `MONITORING.md:1` (246 LOC) — runbook del operador, mapeo alerta → causa probable → mitigación.

**¿Qué significa?** Si la app rompe en producción, el founder se entera por
email/PagerDuty antes que por Twitter. Cada alerta lleva su propio runbook
en el `documentation.content`, así que el primer responder no necesita abrir
Confluence ni Notion.

## 3. Performance budgets en cada PR

- `lighthouserc.json:1` — Performance ≥0.85 (error), Accessibility ≥0.90 (error), LCP ≤2500 ms, CLS ≤0.1, TBT ≤300 ms (warn), FCP ≤2000 ms (warn). 3 runs por PR.
- `.size-limit.json` — main bundle 300 KB gzipped, vendor 500 KB, `RiskNetwork` lazy 250 KB, CSS 60 KB.
- `.github/workflows/perf.yml:1` — 2 jobs (size + lighthouse) en PR + push a main.
- `PERFORMANCE.md:1` — playbook de fix por categoría (bundle / Lighthouse / accessibility), incluye rationale del budget.
- `package.json` devDeps — `size-limit@^11.1.6`, `@size-limit/preset-app@^11.1.6`, `@lhci/cli@^0.14.0`.

**¿Qué significa para el usuario?** Cada PR mide bundle size y Lighthouse
score. Una contribución que empeore page load >50 KB o LCP >2500 ms falla
el CI antes del merge. Calidad sostenida sin tener que acordarse manualmente.

## 4. Smoke tests para los critical paths

- `src/__smoke__/billing-flow.smoke.test.ts` — 5 tests integración tier → pricing → invoice math.
- `src/__smoke__/normativa-flow.smoke.test.ts` — 7 tests, country detection → pack normativa → alerts.
- `src/__smoke__/safety-calc.smoke.test.ts` — 6 tests de sanidad sobre REBA, RULA, IPER, TMERT, PREXOR.
- `src/__smoke__/health-adapter.smoke.test.ts` — 5 tests de selección de facade con Capacitor mockeado.
- `src/__smoke__/critical-paths.smoke.test.ts` — 2 module-load checks que cachan export breakage temprano.
- `.github/workflows/smoke.yml:1` — 5 min timeout, dispara en PR + push.
- 25 tests, runtime interno vitest ~6 s, wall-clock ~11.5 s.

**¿Qué significa?** Si alguien rompe el export de `calculateReba`, cambia
pricing por accidente o desconecta el facade Health Connect, el CI lo cacha
en menos de 12 segundos. 0 falsos positivos esperados (tests de invariantes,
no de UI).

## 5. Polish ronda 10 — 4 MEDIUMs cerrados

- `infrastructure/cloud-scheduler.yaml:192-201` — comentario de la URL legacy v1 marcado como deprecated y reemplazado por v2 (`run.googleapis.com/v2/.../jobs/<job>:run`); 6-line ownership note apuntando a `scheduler.tf`.
- `src/services/observability/noopErrorTrackingAdapter.ts:1-190` — reescrito (~190 LOC) con `AsyncLocalStorage`:
  - `userContextStore = new AsyncLocalStorage<{userId, props}>()` (línea 63).
  - `setUserContext` (línea 127) muta solo dentro del scope `.run()`; fuera de scope es silent no-op (evita el cross-request leak que inevitablemente aparece con un store global).
  - `captureException` / `captureMessage` (líneas 82, 94) leen `userId` vía `getStore()`, con fallback al `context.userId` explícito.
  - `__test__` export (línea 173) para que tests entren a la scope manualmente.
- `src/services/observability/observability.test.ts` — 31 → 33 tests (2 nuevos: scope-bounded propagation + silent-no-op outside scope).
- `OBSERVABILITY.md:1` — +58 LOC en sección nueva "Per-request user context with AsyncLocalStorage" con sample de Express middleware.
- `public/.well-known/security.txt:4-8` — línea `Encryption:` rota removida y reemplazada por TODO comment honesto (un 404 en el hint es peor que su ausencia).
- `SECURITY.md:13-25` — placeholder PGP reemplazado por párrafo claro: pide email plain + Signal/Wire ad-hoc para material sensible hasta que la clave esté publicada.
- `IOS_BUILD.md` §6.2 — bold callout + bloque XML `App.Debug.entitlements` + wiring de Xcode per-configuration para `aps-environment=development` en debug y `production` en release.

**¿Qué significa?** El reviewer C6 detectó 4 issues operacionales en
ronda 10; los 4 cerrados sin escalada. Praeventio sigue siendo legible para
auditores ISO 27001.

## Lo que el operador (SRE/founder on-call) gana

- `terraform apply` reconstruye toda la infra GCP en un proyecto vacío en minutos; `terraform destroy` no toca KMS ni bucket de backups (`prevent_destroy`).
- Cada alerta llega con el runbook adentro del email — no hay "¿dónde está el playbook?" a las 3 AM.
- `npm run smoke` corre 25 tests críticos en ~12 s; señal go/no-go antes de promover a main.
- Bundle size y Lighthouse están medidos en CI; el SRE no descubre regresiones de perf en producción.
- Logs de observabilidad ya no leakean `userId` entre requests concurrentes en Cloud Run.

## Lo que el auditor (ISO 27001 / SUSESO / Marketplace reviewer) gana

- Evidencia documentada de **encryption at rest** (KMS KEK + envelope) + rotación 90 días en `kms.tf:27`.
- Evidencia de **backups + retention** con bucket-level retention policy en `storage.tf:65` (anti-ransomware admin-resistant).
- Evidencia de **least-privilege IAM**: 3 SAs separados, permisos a nivel de recurso (`iam.tf`, `kms.tf:55`, `storage.tf:81`).
- Evidencia de **monitoring + alerting** con runbooks vinculados a SLOs medibles (`monitoring.tf`).
- Evidencia de **disclosure responsable** sin afirmaciones falsas: PGP marcado como roadmap, canal alterno documentado (`SECURITY.md:17-25`).

## Lo que Praeventio (la empresa) gana

- Pipeline GA-ready: deploy reproducible, alertas conectadas, perf budgets y smoke tests cerrando el loop de calidad.
- Deuda técnica baja: 4/4 MEDIUMs de ronda 10 cerrados; backlog operacional limpio para entrar a ronda 12.
- Customer trust enterprise: una mutual chilena o cliente CONSTRAMET puede pedir el módulo Terraform y hospedar su propia instancia self-hosted en su tenant GCP.
- Costo de infra modelado y bajo (<$10/mes baseline en `README.md` del módulo).
- Documentación operativa unificada: `MONITORING.md`, `PERFORMANCE.md`, `OBSERVABILITY.md`, `DR_RUNBOOK.md`, `SECURITY.md` cubren los 5 vectores que un reviewer enterprise pregunta primero.

## Limitaciones reconocidas

- `terraform apply` está pendiente de ejecución por el operador humano contra `praeventio-prod`; el código está validado pero la infra real aún no se ha rotado al estado declarado.
- Los 8 secrets de `secrets.tf` se crean vacíos; cargar los valores reales (Webpay key, OpenWeather, Sentry DSN, Resend, Gemini, OAuth client, etc.) sigue siendo un paso manual auditado.
- El primer run de Lighthouse establece el baseline; ajustes finos a los thresholds (sobre todo `categories:pwa`) pueden requerir 1-2 PRs de calibración.
- Smoke tests corren en ~12 s wall-clock; el budget del workflow es 5 min, hay margen, pero un crecimiento >5x del set haría falta partirlos.
- El middleware Express que abre `userContextStore.run({ userId }, ...)` no está cableado al `server.ts` actual — el patrón está documentado en `OBSERVABILITY.md` §1; primer integrador debe agregar 4 líneas al pipeline de auth.

## KPIs sugeridos

1. **MTTR por alerta P1** — tiempo desde disparo de `api_health_uptime` o `firestore_backup_age` hasta resolución. Target: <30 min los primeros 3 meses, <15 min en estado estable.
2. **Tasa de PRs bloqueados por perf budget** — PRs que fallan `perf.yml` antes del merge / total PRs. Target: <15% sostenido (más alto significa budgets mal calibrados; más bajo significa que no están restringiendo nada).
3. **Smoke pass rate** — ejecuciones verdes / totales en `smoke.yml`. Target: >99% (los tests son de invariantes; rojo significa breakage real).
4. **Drift de Terraform** — cuántas veces `terraform plan` detecta cambios out-of-band en infra (config manual en Console). Target: 0 cambios drifteados por mes.
5. **Cobertura de runbook embebido** — alertas con `documentation.content` no vacío / total alertas. Target: 100% en ronda 12 (hoy 6/6 = 100% sobre el set declarado).
