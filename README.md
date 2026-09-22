<div align="center">
<img width="1200" height="475" alt="Guardian Praeventio" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Guardian Praeventio

> Plataforma de prevención de riesgos laborales con IA para industrias críticas en Latinoamérica (minería, construcción, faenas remotas).

[![Stack](https://img.shields.io/badge/stack-React%2019%20%7C%20Vite%208%20%7C%20Firebase%20Admin%2014%20%7C%20Capacitor%208-blue?style=flat-square)](./ARCHITECTURE.md)
[![Typecheck](https://img.shields.io/badge/typecheck-clean-4db6ac?style=flat-square)](package.json)
[![Tests](https://img.shields.io/badge/tests-Vitest%204.x-4db6ac?style=flat-square)](src/__tests__/)
[![Mutation](https://img.shields.io/badge/mutation%20score-67.32%25%20(R18)-6c5b7b?style=flat-square)](./STRYKER_BASELINE.md)
[![Graphify](https://img.shields.io/badge/graphify-32.687%20nodos%20%7C%201.554%20comunidades-blueviolet?style=flat-square)](./graphify-out/GRAPH_REPORT.md)
[![Cumplimiento](https://img.shields.io/badge/cumplimiento-DS%2044%2F2024%20%7C%20Ley%2016.744-critical?style=flat-square)](#cumplimiento-normativo)
[![Estado](https://img.shields.io/badge/estado-pre%20producci%C3%B3n-yellow?style=flat-square)](#estado-del-proyecto)

> "El riesgo se neutraliza en el diseño, no en la reacción." — El Guardián

---

## ¿Qué es Guardian Praeventio?

**Plataforma integral de prevención de riesgos laborales** para industrias críticas en Latinoamérica (minería, construcción, faenas remotas). Construida como PWA + app nativa Android (Capacitor), combina:

- **IA aplicada de 5 niveles** — Gemini → Vertex AI → SLM local → Zettelkasten RAG → reglas, con resiliencia explícita ("la IA NUNCA falla": 5-tier fallback + Resilience Health Monitor)
- **Visión on-device** — MediaPipe + Gemini para detección de EPP, postura y fatiga (el video nunca sale del teléfono)
- **Tiempo real en terreno** — Modo Crisis, SOS outbox (con idempotencia UUID + dead-letter), detección Hombre Caído (FGS/WorkManager), rutas de evacuación dinámicas (A*/Dijkstra), check-ins geolocalizados
- **Análisis predictivo** — REBA/RULA ergonómicos, IPER/PREXOR/TMERT/PLANESI, fatiga por video, climate-risk coupling, pre-shift scoring
- **Knowledge Graph Zettelkasten** — materializer que conecta riesgos, normativas y controles; navegable en 2D/3D
- **Mesh BLE offline** — comunicación peer-to-peer entre dispositivos en faena sin señal (capacitor-mesh plugin nativo Android/iOS)
- **Offline-first** — IndexedDB/SQLite local + outbox cifrado (AES-256-GCM con HMAC) + sync por drain al reconectar
- **Multi-tenant con RBAC** — Firebase Auth + custom claims verificados en cada request (`verifyAuth` + `assertProjectMember` + `callerTenantOr403`)
- **23 verticales vida-safety documentadas** (Vida-01 a Vida-23) + vertical SOS
- **Multi-jurisdiccional** — Chile (DS 44/2024, Ley 16.744, DS 594, SUSESO, DS 67/76, Ley Karin), más extensible a UK/CA/AU/JP/KR/IN/US/EU/MX/BR/CN/TW/RU vía adaptadores de compliance

La **misión** es proteger la vida del trabajador, sin restricción, free para siempre. El sistema **nunca bloquea al trabajador; solo lo cuida.**

---

## Cumplimiento normativo

**Chile** (base canónica):
- **DS 44/2024** (vigente desde 01-02-2025; reemplaza los derogados DS 40 y DS 54 de 1969) — Reglamento sobre prevención de riesgos en el trabajo
- **Ley 16.744** — Accidentes del trabajo y enfermedades profesionales
- **DS 594** — Condiciones sanitarias y ambientales básicas en lugares de trabajo
- **DS 67/76** — Elementos de protección personal (EPP)
- **Ley Karin** — Prevención del acoso laboral y sexual
- **Ley 19.628** — Protección de datos personales

**LATAM / global**: 13 países adaptables vía adaptadores `compliance/adapters/` (UK, CA, AU, JP, KR, IN, US, EU, CL, MX, BR, CN, TW, RU). Regímenes adicionales: GDPR, LGPD, HIPAA.

Las invariantes viven en [`firestore.rules`](./firestore.rules) — 2 504 líneas, **default-deny**, RBAC por roles, validación de schemas, audit_logs inmutables. Catálogo completo de invariantes: [`security_spec.md`](./security_spec.md) ("Dirty Dozen" de payloads esperados a ser rechazados).

---

## Estado del proyecto

> **Bloqueado para release Android 1.0** según la [auditoría pre-producción 2026-08-30](#referencias-de-auditor%C3%ADa-y-vault). La regla de Daniel es: *"listo para producción es con todas las tareas de Notion resueltas; no vuelvo a sacar un producto a medias"* (2026-08-03). La fila Spec'd de Notion sigue abierta. El trabajo continúa; los gates existen para algo.

**Lo que el repo es hoy** (verificable contra archivos físicos, no claims):

| Métrica | Valor | Fuente verificada |
|---|---:|---|
| Archivos de código productivos | 2 104 | [`Ledger-Cobertura-Codigo-Guardian`](./docs/audits/) del vault Obsidian |
| Total código (TS/TSX) | 3 943 | ledger |
| Routers backend | 217 en `src/server/routes/` | auditoría pre-producción 2026-08-30 |
| Services | 229 | auditoría pre-producción 2026-08-30 |
| Component folders | 199 | auditoría pre-producción 2026-08-30 |
| Hooks | 226 | auditoría pre-producción 2026-08-30 |
| Pages | 310 | auditoría pre-producción 2026-08-30 |
| Suites de test (`server/`) | 273 archivos | `src/__tests__/server/*.test.ts` |
| `server.ts` | 1 748 LOC | `wc -l server.ts` |
| `gemini.ts` | 1 083 LOC | auditoría 2026-08-30 |
| `geminiBackend.ts` | 753 LOC | auditoría 2026-08-30 |
| `firestore.rules` | 2 504 LOC | auditoría 2026-08-30 |
| Mutation testing (R18, 2026-04-28) | 67.32% global (1 230 mutantes) | [`STRYKER_BASELINE.md`](./STRYKER_BASELINE.md) |
| Graphify (2026-09-11) | 32 687 nodos · 67 439 edges · 1 554 comunidades | [`GRAPH_REPORT.md`](./graphify-out/GRAPH_REPORT.md) |

**Gates de release pendientes** (auditoría pre-producción 2026-08-30 + nocturna 2026-08-31):
- TLS cert-pinning: placeholders `PIN_SHA256_LEAF_REPLACE_AT_PROD_DEPLOY` y `PIN_SHA256_BACKUP_REPLACE_AT_PROD_DEPLOY` aún presentes en `android/app/src/main/res/xml/network_security_config.xml:62-64` — AAB no es shippable hasta que se reemplacen con SPKI real de `app.praeventio.net` (ver `docs/mobile-signing-runbook.md §4`)
- `setFullScreenIntent` no implementado en `fcmAdapter.ts` pese al comentario en `AndroidManifest.xml:147` — los push críticos NO pueden despertar la pantalla bloqueada en Android 14+ (P0-VIDA)
- `callerTenantOr403` solo presente en 4 archivos de rutas (`ds67ds76.ts`, `suseso.ts`, `eppFlow.ts`, `ergonomics.ts`); 195/231 rutas de producción usan `projectId` — riesgo sistémico de cross-tenant access pendiente de auditoría handler-by-handler (P0-PRIVACIDAD)
- `branch protection`: 0 reviews obligatorias, `enforce_admins=false`, Actions sin SHA pinning — debe endurecerse antes de confiar en flujo de tags
- `mobile-release.yml`: 0 repository secrets cargados visiblemente; el preflight salta Android/iOS cuando faltan credenciales — sin evidencia de subida real a Play Console
- Últimos 10 runs de `deploy.yml` en `main` terminaron en failure (problema actual: `HEALTH_PROFESSIONAL_LOOKUP_KEYS` ausente o malformado)

**Regla #1 (Daniel)**: nada se marca ✅ sin file:line. Fuente única de verdad para el estado vivo: [`TODO.md`](./TODO.md). Las auditorías viven en [`docs/audits/`](./docs/audits/) y en el [vault Obsidian](#referencias-de-auditor%C3%ADa-y-vault).

---

## Verticales de producto (lo que el código realmente hace)

Más allá de las etiquetas de marketing, esto es el mapa de comunidades que Graphify ([`GRAPH_REPORT.md`](./graphify-out/GRAPH_REPORT.md)) confirma que existen en el código y que están activas. Cada vertical tiene su(s) módulo(s) principal(es):

| Vertical | Qué hace | Archivos / hubs principales |
|---|---|---|
| **AI / RAG / Gemini** | Asistente "El Guardián" + análisis REBA/RULA + acciones Gemini con whitelist `ALLOWED_GEMINI_ACTIONS` | `services/gemini/`, `services/geminiBackend.ts`, `geminiService.ts`, `gemini.ts` (router 1 083 LOC), `aiToggle`, `aiQuality` |
| **CRQ / Ergonomía / Protocolos** | Cálculos determinísticos (REBA, RULA, IPER, PREXOR, TMERT, PLANESI, CEAL-SM) — son los motores bajo Stryker mutation | `services/ergonomics/`, `services/protocols/`, `services/safety/` |
| **Emergencia / SOS / ManDown** | SOS con outbox UUID + dead-letter; Hombre Caído con FGS/WorkManager nativo Android | `routes/emergency.ts`, `src/components/emergency/SOSButton.tsx`, `sosOutboxClient`, `packages/capacitor-mesh/`, `MeshPlugin.kt`, `MeshPlugin.swift` |
| **Mesh / offline / outbox** | Comunicación peer-to-peer entre dispositivos en faena (capacitor-mesh plugin nativo Android/iOS); outbox cifrado AES-256-GCM + HMAC con drain al reconectar | `mqttTelemetryBridge`, `meshPacket`, `encryptedOfflineQueue`, `encryptedKvStore`, `syncStateMachine`, `incidentOutbox`, `incidentFlow` |
| **Compliance / Privacy** | 9 adaptadores LATAM (cl/ca/au/in/jp/kr/uk + `jurisdictionErrors`), ARCO, DS67/76, ley19628, KMS signer (`complianceKmsSigning`, `complianceSignature`, `compliance/registry`, `compliance/ley19628.ts`) | `complianceSignature`, `complianceKmsSigning`, `compliance/registry.ts`, `privacy/registry.ts` |
| **WebAuthn / KMS / Crypto** | AES-256-GCM, WebAuthn, KEK rotation, KMS 90-day, PGP para `pgp-key.asc` con `security.txt Encryption: active` | `totpEnrollment`, `webpayAdapter`, `sitebookSign`, `bsaleAdapter` |
| **Billing / Commerce / IAP** | Transbank Webpay, MercadoPago (IPN con HMAC + canonical-JSON + JWS), Khipu, Google Play RTDN, Apple JWS, IAP Apple/Google, UF pricing | `routes/billing/`, `routes/dte/sii/`, `webpayAdapter`, `dteIssueQueueStore`, `bsaleAdapter`, `tiers.ts` |
| **DTE / SII / Facturación** | Factura electrónica, billing queue, retry transitorio MercadoPago, claim/lease/salesId | `routes/dte/`, `compliance/dte*`, `dteIssueQueueStore` |
| **Knowledge Graph Zettelkasten** | Red neuronal de riesgos, normativas, controles; navegable 2D/3D, offline sync, health, jobs, MCP | `zettelkastenMaterializer`, `safeNormativeQuery`, `normativeRag`, `Zettelkasten.tsx`, `knowledgeBase`, `universalKnowledge` |
| **Digital Twin / AR / Photogrammetry** | Gaussian splat, photogrammetry, AR, on-device ML reconstruction | `DigitalTwinFaena.tsx`, `gaussianSplatRegistry`, `photogrammetry/types`, `onDeviceReconstruction/`, `envisionBuilder`, `signageValidator` |
| **Pre-shift risk / Scoring** | Score pre-turno: clima, fatiga, permisos, tareas, equipos, incidentes | `preShiftRiskComposer`, `climateRiskCoupling`, `predictiveGuard`, `criticalRouteScoring`, `driverScoring` |
| **Work permits / LOTO** | Permisos de trabajo, bloqueo/etiquetado, validadores críticos, weather/gas gates, auto-expire | `workPermits`, `loto`, `WeatherGate` |
| **Telemetry / IoT / Sensores** | MQTT real + BLE + sensores; ingest vía `IOT_WEBHOOK_SECRET` | `mqttTelemetryBridge`, `slmAcquisitionService`, `slmRuntime`, `slmRuntimeWorkerCore` |
| **Curriculum / Training / Capsulas** | Catálogo, scoring, player, persistencia, microtraining, IncidentFlow, cápsulas diarias (SafetyCapsules, geocápsulas, Gemini) | `curriculum`, `Training.tsx`, `Apprenticeship.tsx`, `wisdomCapsules` |
| **Driver safety / Commute** | Driving, SafeDriving, commute, GPS, scoring, rutas, reportes | `DriverScoringTabs.tsx`, `safeDriving`, `routes/driving*` |
| **Maintenance / Horómetro** | Maintenance con horómetro, WebAuthn step-up | `maintenance`, `horometro`, `routes/maintenance*` |
| **Equipment / EPP** | Equipment, QR, pre-use, PhotoEvidence, EPP detection, EPP flow | `Equipment`, `equipmentFirestoreAdapter`, `EPP.tsx`, `photoEvidenceEngine`, `eppFlow`, `eppInventoryPurchaseFlow` |
| **Observability / Sentry** | PiiRedactor + sentryAdapter + cloud-error-reporting + prometheus | `sentryAdapter`, `prometheus`, `piiRedactor`, `safetyMetrics` |
| **Scheduler / Jobs / Backup** | verifySchedulerToken (2 modos) + distributedLease; 13 endpoints scheduler-protected, 8 jobs críticos; backup/restore (módulo formal ausente hoy) | `verifySchedulerToken`, `distributedLease`, `routes/maintenance*`, `routes/jobs*` |

**23 verticales vida-safety** (`01-Guardian/09-VIDA-SAFETY/Vida-01` … `Vida-23`) cubren cada uno de los riesgos pragmáticos detectados en operaciones. La vertical SOS vive aparte por su criticidad.

---

## Stack

| Capa | Tecnologías |
|---|---|
| **Frontend** | React 19.3, Vite 8.3, TypeScript 5.8, Tailwind 4.1, Framer Motion, react-router 7 |
| **Backend** | Node.js 20+, Express 4.21, Firebase Admin SDK 14.4 (modular API, post-migración #1744) |
| **Base de datos** | Firestore (cloud) + IndexedDB / SQLite (offline) |
| **IA** | `@google/genai` 2.23 (Gemini), MediaPipe Vision (edge on-device), embeddings vectoriales |
| **Mobile** | Capacitor 8.5.1 (Android, iOS) — `android/` con 4 108 archivos |
| **Maps / Geo** | React Google Maps, Turf, Leaflet, A*/Dijkstra |
| **PDF** | `pdfkit` (server) + `jspdf` (cliente) |
| **Auth** | Firebase Auth + custom claims (RBAC) |
| **Notificaciones** | Firebase Cloud Messaging (FCM) |
| **Billing** | Transbank SDK (Webpay), MercadoPago, Khipu, Google Play RTDN, Apple JWS, IAP Apple/Google |
| **Testing** | Vitest 4.1.11, Stryker (mutation), 9 ratchets en CI |
| **Observabilidad** | Sentry + cloud-error-reporting + Prometheus + PiiRedactor |
| **Seguridad** | AES-256-GCM, WebAuthn, KEK rotation, KMS 90-day, TLS cert-pinning (gating con ratchet) |

---

## Setup local

### Requisitos

- Node.js 20+
- Una cuenta de Firebase con Firestore habilitado
- API key de Gemini (Google AI Studio) — `GEMINI_API_KEY`

### Instalación

```bash
git clone https://github.com/mikesandoval10creator/Guardian-Praeventio.git
cd Guardian-Praeventio
npm install

cp .env.example .env.local
$EDITOR .env.local   # ver docs/runbooks/SECRETS_RUNBOOK.md para cada variable

npm run validate:env   # verifica shape del .env antes de bootear
npm run typecheck      # tsc --noEmit (0 errores = invariante)
npm run test           # vitest run (~10 min, suite completa)
npm run dev            # http://localhost:3000
```

> El repo incluye `.npmrc` con `legacy-peer-deps=true` para tolerar peer-ranges desactualizados de algunas dependencias upstream.

### Variables de entorno mínimas

| Variable | Requerida | Para qué |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Asistente IA "El Guardián" + acciones Gemini |
| `SESSION_SECRET` | ✅ | Firma de sesiones (generar con `openssl rand -hex 32`) |
| `VITE_GOOGLE_MAPS_API_KEY` | opcional | Mapas |
| `VITE_OPENWEATHER_API_KEY` | opcional | Alertas climáticas |
| `IOT_WEBHOOK_SECRET` | opcional | Ingesta telemetría IoT |
| `RESEND_API_KEY` | opcional | Emails transaccionales |

Para Firebase Admin local: descargar `firebase-applet-config.json` desde la consola y dejarlo en la raíz (gitignoreado).

Cualquier variable que aparezca como `<...>`, `YOUR_*`, o `MY_*` causará que `npm run validate:env` falle e indique exactamente qué falta.

### Comandos principales

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor Express + Vite con HMR en `http://localhost:3000` |
| `npm run build` | Build de producción del frontend |
| `npm run preview` | Servir el build localmente para verificar |
| `npm run start` | Servidor en modo producción |
| `npm run typecheck` | Verificación de tipos TypeScript (0 errores = invariante) |
| `npm run lint` | ESLint sobre `src/**/*.{ts,tsx}` + `server.ts` + `firestore.rules` |
| `npm run lint:fix` | Igual que `lint` con `--fix` |
| `npm run test` | Suite Vitest completa (~10 min) |
| `npm run validate:env` | Verifica shape del `.env.local` antes de bootear |
| `npm run mutation` | Stryker sobre motores de cálculo de seguridad |
| `npm run cap:android` | Sincronizar y abrir Android Studio |
| `npm run cap:ios` | Sincronizar y abrir Xcode |
| `npm run graphify:update` | Regenerar `graphify-out/` (0 API cost) |

### Ratchets de CI (gates de release)

Estos scripts son **gates duros** para subir a producción. Cada uno mantiene un baseline numérico que solo puede crecer hacia arriba (no se pueden introducir regresiones):

| Ratchet | Verifica |
|---|---|
| `check-connectivity-ratchet.cjs` | Features huérfanos vs baseline |
| `check-render-ratchet.cjs` | Phantom components vs baseline |
| `check-router-test-ratchet.cjs` | Cada router backend tiene test companion |
| `check-open-reads-ratchet.cjs` | Colecciones con lectura abierta |
| `check-any-ratchet.cjs` | `as any` vs baseline |
| `check-user-facing-errors.cjs` | Errores crudos que ven usuarios |
| `check-pgp-disclosure-ratchet.cjs` | PGP real + `security.txt Encryption: active` |
| `check-convention-guard.cjs` | Regla #3 (default-deny) |
| `check-cert-pinning-ratchet.cjs` | PINs SHA-256 reales (sin placeholders) |

---

## Mutation testing

`npm run mutation` corre [Stryker](https://stryker-mutator.io/) sobre los motores de cálculo de seguridad — donde una regresión silenciosa puede traducirse en mal cálculo de riesgo y daño físico al trabajador. Es por eso que estos módulos exigen una cobertura mutacional alta, no sólo line/branch.

- **Ejecución local:** ~5 min en hardware moderno; hasta 15-30 min en hardware más lento; aún no agregado a CI.
- **Targets** (`stryker.config.json`): `services/ergonomics/{reba,rula}.ts`, `services/protocols/{iper,prexor,tmert}.ts`, `services/safety/{ergonomicAssessments,iperAssessments}.ts`
- **Umbrales:** `high: 80%`, `low: 60%`, `break: 50%` (R18 baseline)
- **Reporte HTML:** `reports/mutation/mutation.html` tras la corrida

**Línea base R18 (2026-04-28)**: score global **67.32%** (828 killed, 356 survived, 46 no-coverage, 0 errors, 0 timeouts sobre 1 230 mutantes). Detalle por archivo y plan de mejora R19: [`STRYKER_BASELINE.md`](./STRYKER_BASELINE.md).

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  Cliente (PWA + Capacitor Android)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ React 19 SPA │  │  IndexedDB   │  │  MediaPipe   │        │
│  │ Vite + Tail  │  │ (offline KV) │  │  edge CV     │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
└─────────┼─────────────────┼─────────────────┼────────────────┘
          │ HTTPS+token     │ outbox cifrado   │ on-device
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend (Express + tsx, server.ts — 1 748 LOC god-file)     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐              │
│  │ verifyAuth │  │ Gemini RAG │  │ FCM push   │              │
│  │ + claims   │  │ /ask-guard │  │ + triggers │              │
│  │ + WebAuthn │  │ + SLM      │  │ + Geofence │              │
│  └────────────┘  └────────────┘  └────────────┘              │
│  eventLog.ts = single write path (emit→Zod→Append→Bus→Audit) │
└─────────────────────────────────────────────────────────────┘
          │                 │              │
          ▼                 ▼              ▼
┌──────────────────┐  ┌──────────────────────────┐
│ Firestore        │  │ Google Cloud (Vertex AI, │
│ + reglas RBAC    │  │ Pub/Sub, Play Billing,   │
│ 2 504 líneas     │  │ Cloud Run, KMS, Sentry)  │
└──────────────────┘  └──────────────────────────┘
```

- **`server.ts`** — punto de entrada del backend; orquesta autenticación, endpoints API, OAuth con Google Workspace/Calendar/Fit, billing webhook, RAG y triggers en background. God-file en split pendiente (ver `ARCHITECTURE.md` para estrategia).
- **`src/routes/`** — frontend SPA con `lazy()` para code-splitting.
- **`src/server/routes/`** — 217 archivos de handlers HTTP agrupados por dominio.
- **`firestore.rules`** — default-deny, RBAC por roles, validación de schemas, audit_logs inmutables. **2 504 líneas**.
- **`android/`** — proyecto Capacitor nativo con build multi-stage; 4 108 archivos.
- **`packages/capacitor-mesh/`** — plugin nativo BLE mesh (Kotlin + Swift).
- **`tasks/`** — planes de implementación (EPP vision, PTS grounding) y lessons learned.
- **`graphify-out/`** — topología semántica viva del código: 32 687 nodos, 67 439 edges, 1 554 comunidades. Actualizado en cada `npm run graphify:update` (0 API cost).

### Patrones arquitectónicos identificados

- **`eventLog.emit()` = single write path** → Zod validate → Append → Bus → Audit
- **Pure/Server-Only split** — funciones puras vs Node-only (`analytics/serverAdapter`)
- **"La IA NUNCA falla"** — 5-tier fallback + Resilience Health Monitor
- **Persistence schema** — `tenants/{tid}/projects/{pid}/{collection}/{id}`
- **GDPR-first privacy by design** — audit log obligatorio para mutaciones
- **Build provenance** — SHA-256 + WebAuthn signature + atomic folio + jsPDF

---

## Seguridad y privacidad

- 🔒 `GEMINI_API_KEY` y demás secretos viven solo en el backend; nunca llegan al cliente.
- 🔒 Reglas Firestore con **default-deny** y validación estricta de schemas (`check-open-reads-ratchet.cjs` gate).
- 🔒 Procesamiento biométrico (fatiga, postura, EPP) **100% on-device** vía MediaPipe — el video nunca sale del teléfono.
- 🔒 Audit logs inmutables (sin update/delete) — [`security_spec.md`](./security_spec.md).
- 🔒 Rate limiting per-user para llamadas a IA (30/15min) en `gemini.ts`.
- 🔒 Helmet + CSP en producción.
- 🔒 RLS multi-tenant con `verifyAuth` + custom claims verificados en cada request.
- 🔒 TLS cert-pinning con ratchet duro — AAB no se firma si hay placeholders.
- 🔒 Cifrado outbox: AES-256-GCM + HMAC con `IOT_WEBHOOK_SECRET` y KEK rotation 90-day.
- 🔒 WebAuthn step-up con counter validation y RP/origin pinning.
- 🔒 PGP real publicado en `pgp-key.asc` con `security.txt Encryption: active`.

---

## Despliegue

### Cloud Run (recomendado)

El [`Dockerfile`](./Dockerfile) hace build multi-stage (frontend + servidor) y expone el puerto 3000 con healthcheck en `/api/health`.

Configurar en Cloud Run:
- Secretos como variables de entorno (Secret Manager)
- `firebase-applet-config.json` montado como secreto
- Service account con permisos de Firestore Admin y Vertex AI

Más detalle: [`RUNBOOK.md`](./RUNBOOK.md) + [`DR_RUNBOOK.md`](./DR_RUNBOOK.md). Secretos: [`docs/runbooks/SECRETS_RUNBOOK.md`](./docs/runbooks/SECRETS_RUNBOOK.md). Rotación KMS 90-day: [`KMS_ROTATION.md`](./KMS_ROTATION.md). Pipeline Cloud Build: [`docs/runbooks/CLOUD_BUILD_RUNBOOK.md`](./docs/runbooks/CLOUD_BUILD_RUNBOOK.md).

> **Estado actual del deploy**: los últimos 10 runs de `deploy.yml` en `main` terminaron en failure. Verificar la causa actual en la pestaña Actions antes de tocar el pipeline.

### AI Studio

Este proyecto también puede correrse desde Google AI Studio: <https://ai.studio/apps/d2437df8-893e-424f-a15b-f6c3b5f170dc>.

### Android (Capacitor)

```bash
npm run cap:android   # sync + abre Android Studio
```

El proyecto Android vive en [`android/`](./android/) (4 108 archivos, build nativo completo). Más detalle: [`MARKETPLACE_SUBMISSION.md`](./MARKETPLACE_SUBMISSION.md) + [`IOS_BUILD.md`](./IOS_BUILD.md).

---

## Características principales

- **El Guardián** — asistente IA con RAG sobre la base normativa chilena (BCN, ISO).
- **Vision Analyzer** — detección de EPP y riesgos por computer vision (Gemini + MediaPipe edge on-device).
- **Knowledge Graph (Zettelkasten)** — red neuronal de riesgos, normativas y controles, navegable en 2D y 3D.
- **Modo Crisis** — chat de emergencia, check-in, detección de "Hombre Caído", rutas de evacuación dinámicas (A*/Dijkstra).
- **Análisis predictivo** — REBA/RULA ergonómicos, fatiga por video, cruces clima-tarea, pre-shift scoring.
- **PWA + Capacitor** — funciona offline en faena, sincroniza al recuperar conexión, deployable a Android (iOS pendiente de port Capacitor).
- **i18n** — soporte multi-idioma (es-CL por defecto).
- **Multi-tenant con RBAC** — admin, supervisor, prevencionista, operario, gerente. Custom claims en Firebase Auth.
- **Audit_logs inmutables** — todo cambio de estado auditable, sin update/delete en las reglas.
- **Mesh BLE offline** — comunicación peer-to-peer entre dispositivos en faena sin señal.
- **B2D (Business-to-Developer)** — ver [`API_B2D_SPEC.md`](./API_B2D_SPEC.md).
- **DTE / SII** — integración con Servicio de Impuestos Internos para facturación electrónica.

Ver [`ROADMAP.md`](./ROADMAP.md) para el detalle de funciones implementadas y planificadas, y [`PRICING.md`](./PRICING.md) para la estrategia de monetización.

---

## Para nuevos contribuidores

Lee estos documentos antes de tocar nada:

1. **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** — flujo TDD (RED → GREEN → REFACTOR), convenciones, cómo agregar rutas / acciones Gemini / motores de cálculo, checklist de PR.
2. **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — mapa de módulos, data flows críticos (Webpay, REBA, curriculum claims), estrategia de split de `server.ts` y `geminiBackend.ts`, inventario de colecciones Firestore, modelo de tier-gating.
3. **[`RUNBOOK.md`](./RUNBOOK.md)** — procedimientos operacionales: emulador Firestore, deploy a Cloud Run, restore de backup, rotación KMS, FCM de prueba, triage Sentry.
4. **[`docs/api-routes.md`](./docs/api-routes.md)** — catálogo de endpoints HTTP.
5. **[`graphify-out/GRAPH_REPORT.md`](./graphify-out/GRAPH_REPORT.md)** — topología semántica viva del código (32 687 nodos, 1 554 comunidades, hubs por dominio). Vale la pena abrirla antes de refactorizar.

Para emergencias de producción: [`DR_RUNBOOK.md`](./DR_RUNBOOK.md). Para reportes de seguridad: [`SECURITY.md`](./SECURITY.md). Para planes de implementación: [`tasks/`](./tasks/).

---

## Referencias de auditoría y vault

La fuente única de verdad para el estado vivo del proyecto es:
- [`TODO.md`](./TODO.md) — nada se marca ✅ sin file:line
- [`graphify-out/GRAPH_REPORT.md`](./graphify-out/GRAPH_REPORT.md) — topología viva del código
- [`docs/audits/`](./docs/audits/) — auditorías técnicas archivadas

Y en el **vault Obsidian de Daniel** (no es parte del repo, es su Segundo Cerebro personal en `C:/Users/Usuario/Obsidian/Segundo-Cerebro/`):
- **MOC Maestro**: `01-Guardian/01-MOC-INDEX/00-MOC-Guardian-Maestro.md` — entrada a las **351 notas** del vault sobre Guardian
- **Ledger de cobertura**: `01-Guardian/01-MOC-INDEX/Ledger-Cobertura-Codigo-Guardian.md` — única fuente autoritativa sobre qué porcentaje del código está leído con SHA-256 (ledger hash-backed). Las afirmaciones antiguas tipo "770/770 servicios", "75%", "32.8%" son **incompatibles entre sí** según el ledger y no se pueden reproducir.
- **Auditoría pre-producción**: `01-Guardian/02-RECONOCIMIENTO-INICIAL/Auditoria-PreProduccion-Guardian-2026-08-30.md` — veredicto BLOCKED para Play Store; gates arriba
- **Auditoría nocturna**: `01-Guardian/Auditoria-Nocturna-Guardian-2026-08-31.md` — 3 P0 nuevos (TLS pinning, setFullScreenIntent, callerTenantOr403 sub-uso)
- **Vida-Safety**: `01-Guardian/09-VIDA-SAFETY/` — 23 notas de riesgos pragmáticos (Vida-01 a Vida-23) + vertical SOS

---

## Soporte

- General: contacto@praeventio.net
- Privacidad: contacto@praeventio.net
- Comercial / Enterprise: contacto@praeventio.net
- Bugs: <https://github.com/mikesandoval10creator/Guardian-Praeventio/issues>

---

## Licencia y filosofía

Praeventio Guard se rige por una filosofía de **democratización del conocimiento preventivo**:

- 🟢 **Gratis para siempre**: funciones de salvaguarda de vida (Monitor Sísmico, SOS, Hazmat GRE, Hombre Caído, base normativa).
- 🔵 **PYME**: gestión documental, multi-proyecto, modelos IA premium.
- 🟣 **Enterprise**: bio-análisis CV, IoT industrial, ERP/HRM, dashboards predictivos.

Ver [`PRICING.md`](./PRICING.md) para el detalle.

> *"El riesgo se neutraliza en el diseño, no en la reacción."*
