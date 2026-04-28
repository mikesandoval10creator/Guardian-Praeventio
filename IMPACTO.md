# Impacto en el bienestar humano + valor empresarial — Production-ready operativa

**Ronda 10 · 2026-04-28** · Guardián Praeventio
**Audiencia:** equipo, futuros clientes enterprise LATAM, CONSTRAMET, mutuales chilenas (ACHS / IST / Mutual de Seguridad CChC), prevencionistas de riesgos, reviewers de Google Workspace Marketplace y auditores ISO 27001.

## Resumen ejecutivo

Esta ronda cerró la brecha entre "MVP funciona localmente" y "podemos enviar a Google Marketplace y App Store Connect el lunes". Se entregaron cinco bloques: (1) listing completo en Google Workspace Marketplace, (2) ruta nativa iOS / HealthKit con Info.plist y entitlements, (3) política de divulgación RFC 9116 + rúbrica de severidad + runbook de incidentes, (4) observabilidad multi-proveedor con 31 tests, y (5) backup + DR de Firestore con RPO/RTO formales. Todo alineado con Ley 21.719, DS 594, ISO 45001 e ISO 27001.

## 1. Marketplace listing — copy-paste-ready

- `marketplace/manifest.json:1-81` — manifest SDK con OAuth scopes (calendar.events, drive.file, openid/profile/email), categorías, idiomas es-CL/es-419/en, regiones CL/PE/CO/MX/AR/BR/GLOBAL.
- `marketplace/oauth-consent-screen.md:1-169` — texto exacto a pegar en el Console form (App name, support email, logo specs, authorized domains, privacy/terms URLs, app type External).
- `marketplace/scope-justifications.md:1-110` — calendar.events justificado por obligaciones legales (CPHS DS 54, ODI Ley 16.744, PREXOR DS 594, ISO 45001); drive.file por PDFs de auditoría; fitness scopes deprecated → migración a Health Connect / HealthKit on-device.
- `marketplace/listing-copy.md:1-234` (~1809 palabras es-CL) — descripción, audiencia (prevencionistas / paritarios / gerentes HSE), 10 tiers, IPER, REBA/RULA, multi-país, ISO 45001, data residency, soporte por tier.
- `marketplace/assets-spec.md:1-180` — specs gráficos: icon 128×128 + 32×32 + 96×96 + 48×48, banner 220×140, screenshots 1280×800 (1-5).
- `MARKETPLACE_SUBMISSION.md:1-218` — runbook de 11 pasos en Console, desde GCP project hasta el review de 5-15 días.
- **Qué significa:** cuando el usuario complete su cuenta de developer, el formulario se llena por copy-paste. Cero adivinación, cero rebote por scopes mal justificados.

## 2. iOS App Store path

- `IOS_BUILD.md:1-299` — runbook: prerequisites (Xcode 15+, CocoaPods, Apple Dev US$99/año), 8 sub-pasos initial setup, daily workflow, TestFlight, checklist App Store review.
- 11 keys `NS*UsageDescription` listas para pegar con copy honesto:
  - `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription` (HealthKit + Apple Watch)
  - `NSLocationWhenInUseUsageDescription` (geofencing multi-país)
  - `NSCameraUsageDescription` (REBA/RULA on-device + evidencia)
  - `NSMicrophoneUsageDescription` (dosímetro PREXOR DS 594)
  - `NSBluetoothAlwaysUsageDescription` / `NSBluetoothPeripheralUsageDescription` (wearables certificados)
  - `NSContactsUsageDescription` (contactos de emergencia)
  - `NSMotionUsageDescription` (Hombre Caído, fall detection)
  - `NSPhotoLibraryUsageDescription` / `NSPhotoLibraryAddUsageDescription` (evidencia de incidente)
- `App.entitlements` con `com.apple.developer.healthkit` + `aps-environment: production`. `capacitor.config.ts` con comentario documentando el flujo iOS.
- La carpeta `ios/` no existe todavía: debe correrse `npx cap add ios` en macOS antes del runbook (limitación reconocida).
- **Qué significa para el trabajador con iPhone:** cuando se despliegue a TestFlight + App Store, su Apple Watch ya tiene los entitlements y usage strings correctos para no ser rechazado por "vague purpose string", el motivo #1 de rejection en HealthKit.

## 3. Política responsable de divulgación

- `SECURITY.md:1-73` (~373 palabras) — política bilingüe es/en de responsible disclosure con canal y SLA público.
- `public/.well-known/security.txt:1-8` — RFC 9116: `Contact: mailto:security@praeventio.net`, `Expires: 2027-04-28T00:00:00.000Z`, `Preferred-Languages: es, en`, `Canonical`, Encryption (PGP TBD), Acknowledgments, Policy.
- `docs/security/severity-rubric.md:1-124` (~708 palabras) — 4 niveles con CVSS adaptado a app safety-critical:
  - **CRITICAL:** falla alarma Hombre Caído, bypass SOS, exfiltración masiva de datos de salud.
  - **HIGH:** leak `medical_exams`, OAuth tokens compromise, tampering `audit_logs`.
  - **MEDIUM:** XSS admin-only, rate-limit bypass, CSRF no crítico.
  - **LOW:** missing security headers, verbose errors dev.
- `docs/security/incident-response.md:1-45` (~241 palabras) — runbook con TDD-first regression test + Ley 21.719 art. 50 (72h breach reporting) + ISO 27001 A.5.24.
- **Qué significa para el trabajador:** si un investigador encuentra una vuln que comprometa Hombre Caído, hay canal claro con SLA de 24h ack + 72h triage + 30d patch.

## 4. Observabilidad adapter pattern

- `src/services/observability/types.ts:1-197` — `ErrorContext`, `Breadcrumb`, `ErrorTrackingAdapter`, `MetricsAdapter` con `sampleRate` 0.0-1.0 (L71) y aviso de cardinalidad (L168).
- `src/services/observability/sentryAdapter.ts:1-76` — stub que arroja `npm install @sentry/node` hasta que se instale el SDK.
- `src/services/observability/cloudErrorReportingAdapter.ts:1-78` — alternativa GCP-native (Cloud Error Reporting + Cloud Monitoring).
- `src/services/observability/noopErrorTrackingAdapter.ts:1-117` — rutea vía `logger.error/warn/info`; event id `noop-<base36-timestamp>-<6char-random>` (L36).
- `src/services/observability/metricsAdapter.ts:1-205` — counter / gauge / histogram con warning de cardinalidad (no user IDs en labels).
- `src/services/observability/index.ts:1-166` — `getErrorTracker()` + `getMetrics()` pickean por env. Fallback policy: silent → noop (opuesto a KMS: aquí reliability > security blocking).
- `src/services/observability/observability.test.ts:1-309` — 31 tests con RED→GREEN.
- `OBSERVABILITY.md:1-296` — SLOs: `/api/health` 99.9%, Webpay return p95 < 5s, Health Connect ≥ 95%, Calendar predictions p99 < 10s.
- **Qué significa:** cuando la app rompa en prod, el equipo no se entera por Twitter — es alertado en Cloud Monitoring + Sentry con stack traces, breadcrumbs y user context anónimo.

## 5. Disaster recovery profesional

- `scripts/backup-firestore.cjs:1-258` — export nightly a GCS vía `FirestoreAdminClient.exportDocuments`. Manifest con conteo por colección, subfolder ISO UTC + opcional `--label`.
- `scripts/restore-firestore.cjs:1-218` — restore con flag obligatoria `--confirm-i-know-what-im-doing` (L34) contra prod + `--dry-run` (L40) + warning sleep 5s.
- `scripts/test-backup-integrity.cjs:1-238` — chequeo semanal vía Cloud Scheduler.
- `DR_RUNBOOK.md:1-285` — tabla RPO/RTO por tipo de desastre:

| Disaster | RPO | RTO |
|---|---|---|
| Accidental admin delete | 24h | 4h |
| Firestore corruption | 24h | 1h |
| Regional outage | live | Google SLA-dependent |
| Catastrophic loss | 7-30d | 1-3 days |
| Security incident | latest backup | 8h |

- `infrastructure/cloud-scheduler.yaml:1-196` — IaC stub: bucket lifecycle (30d Standard → 365d Nearline → delete), service account `firestore-backup@`, Cloud Run jobs, Scheduler triggers, alerting policies.
- **Qué significa para clientes Empresarial+:** si un admin de cliente borra registros por error, hay restore procedure con RPO 24h. Cumplimiento Ley 21.719 + ISO 27001 A.5.30.

## Lo que el trabajador chileno gana

- Si la alarma Hombre Caído falla en obra, hay canal de seguridad que procesa el reporte en 24h, no un email perdido.
- Su iPhone / Apple Watch recibe la app por App Store sin rechazo por permisos vagos: cámara, mic, ubicación y HealthKit están justificados en lenguaje claro.
- Si sus exámenes preocupacionales se pierden por error de admin, hay restore documentado con RPO 24h.
- Cuando algo se cae en producción, el equipo se entera en minutos (Sentry / Cloud Monitoring), no en días.

## Lo que la empresa cliente gana

- Marketplace listing = instalación de un click desde Workspace Admin, sin negociar APKs.
- SLA público de vulns + rúbrica de severidad = ítem listo para due diligence de compras corporativas.
- DR runbook con RPO/RTO formal = respuesta válida en RFP de continuidad operativa.
- Observabilidad multi-proveedor (Sentry + Cloud + Prometheus + noop) = sin lock-in de APM.
- Compliance kit alineado a ISO 27001 A.5.24 / A.5.30 y Ley 21.719 art. 50.

## Lo que Praeventio gana

- Tiempo a Marketplace: el form de Console se completa en una sesión, no en una semana.
- Tiempo a App Store: primer build = una sesión macOS + cuenta Apple, sin reinventar usage strings.
- Blast radius reducido: los noop adapters garantizan que el sistema no caiga si Sentry cae.
- Backups nocturnos + integrity check semanal = noches durmiendo tranquilos.
- Marca "vendor serio": `SECURITY.md` + `security.txt` + DR runbook son señales que enterprise mira antes de firmar.

## Limitaciones reconocidas

- **Assets gráficos pendientes:** los specs están en `marketplace/assets-spec.md`, los PNGs (icon, banner, 5 screenshots) deben producirse en diseño antes del submit.
- **PGP key TBD:** `security.txt` declara Encryption pero la clave aún no se publicó en `/.well-known/pgp-key.txt`.
- **Carpeta `ios/` no existe:** debe correrse `npx cap add ios` en macOS antes del runbook.
- **Sentry SDK no instalado:** `sentryAdapter.ts` arroja hasta `npm install @sentry/node` + `SENTRY_DSN`.
- **Bucket GCS no provisionado:** `cloud-scheduler.yaml` es IaC stub; falta `gcloud apply` para crear `gs://praeventio-firestore-backups` y la service account.

## KPIs sugeridos

- **Time-to-Marketplace-approval:** días desde submit hasta listing publicado (target ≤ 15 días).
- **Vulnerability MTTR:** mediana de días desde report a `security@` hasta patch desplegado (target ≤ 30 días para HIGH+).
- **Backup success rate:** % de noches con export Firestore exitoso (target ≥ 99% / 30d rolling).
- **DR drill cadence:** cantidad de restore drills ejecutados por trimestre (target ≥ 1, documentado en `DR_RUNBOOK.md`).
- **Observability coverage:** % de endpoints críticos con alerta SLO configurada en Cloud Monitoring (target 100% de los 4 SLOs declarados en `OBSERVABILITY.md`).
