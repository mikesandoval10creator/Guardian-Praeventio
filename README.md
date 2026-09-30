<div align="center">
<img width="1200" height="475" alt="Guardian Praeventio" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Guardian Praeventio

> Plataforma de prevención de riesgos laborales con IA para industrias críticas en Latinoamérica (minería, construcción, faenas remotas).

[![Stack](https://img.shields.io/badge/stack-React%2019%20%7C%20Vite%208%20%7C%20Firebase%20Admin%2014%20%7C%20Capacitor%208-blue?style=flat-square)](./ARCHITECTURE.md)
[![Quality](https://img.shields.io/badge/calidad-evidencia%20por%20recorrido-yellow?style=flat-square)](#estado-del-proyecto)
[![Tests](https://img.shields.io/badge/tests-Vitest%204.x-4db6ac?style=flat-square)](src/__tests__/)
[![Mutation](https://img.shields.io/badge/mutation-Stryker-6c5b7b?style=flat-square)](./stryker.config.json)
[![Arquitectura](https://img.shields.io/badge/mapa-arquitectura-blueviolet?style=flat-square)](./ARCHITECTURE.md)
[![Normativa](https://img.shields.io/badge/marco-DS%2044%2F2024%20%7C%20Ley%2016.744-blue?style=flat-square)](#cumplimiento-normativo)
[![Estado](https://img.shields.io/badge/estado-pre%20producci%C3%B3n-yellow?style=flat-square)](#estado-del-proyecto)

> "El riesgo se neutraliza en el diseño, no en la reacción." — El Guardián

---

## ¿Qué es Guardian Praeventio?

**Plataforma integral de prevención de riesgos laborales** para industrias críticas en Latinoamérica (minería, construcción, faenas remotas). Construida como PWA + app nativa Android (Capacitor), combina:

- **IA aplicada de 5 niveles** — Gemini → Vertex AI → SLM local → Zettelkasten RAG → reglas, con fallbacks y Resilience Health Monitor; requiere comprobar degradación segura cuando no hay respuesta
- **Visión on-device** — MediaPipe + Gemini para detección de EPP, postura y fatiga (la salida de datos de cada flujo debe verificarse; no inferir privacidad de la presencia de MediaPipe)
- **Tiempo real en terreno** — Modo Crisis, SOS outbox (con idempotencia UUID + dead-letter), detección Hombre Caído (FGS/WorkManager), rutas de evacuación dinámicas (A*/Dijkstra), check-ins geolocalizados
- **Análisis predictivo** — REBA/RULA ergonómicos, IPER/PREXOR/TMERT/PLANESI, fatiga por video, climate-risk coupling, pre-shift scoring
- **Knowledge Graph Zettelkasten** — materializer que conecta riesgos, normativas y controles; navegable en 2D/3D
- **Mesh BLE offline** — comunicación peer-to-peer entre dispositivos en faena sin señal (capacitor-mesh plugin nativo Android/iOS)
- **Offline-first** — IndexedDB/SQLite local + outbox cifrado (AES-256-GCM con HMAC) + sync por drain al reconectar
- **Multi-tenant con RBAC** — Firebase Auth + custom claims verificados en cada request (`verifyAuth` + `assertProjectMember` + `callerTenantOr403`)
- **23 verticales vida-safety documentadas** (Vida-01 a Vida-23) + vertical SOS
- **Multi-jurisdiccional** — Chile (DS 44/2024, Ley 16.744, DS 594, SUSESO, DS 67/76, Ley Karin), más extensible a UK/CA/AU/JP/KR/IN/US/EU/MX/BR/CN/TW/RU vía adaptadores de compliance

**Alcance de esta lista:** describe capacidades y módulos del proyecto, no certifica todos sus recorridos ni integraciones externas.

La **misión** es proteger la vida del trabajador, sin restricción, free para siempre. El sistema **nunca bloquea al trabajador; solo lo cuida.**

---

## Cumplimiento normativo

**Chile** (base canónica):
- **DS 44/2024** (vigente desde 01-02-2025; reemplaza los derogados DS 40 y DS 54 de 1969) — Reglamento sobre prevención de riesgos en el trabajo
- **Ley 16.744** — Accidentes del trabajo y enfermedades profesionales
- **DS 594** — Condiciones sanitarias y ambientales básicas en lugares de trabajo
- **DS 67 / DS 76** — regímenes relacionados con prevención y gestión laboral; validar el alcance de cada adaptador en su recorrido legal
- **Ley Karin** — Prevención del acoso laboral y sexual
- **Ley 19.628** — Protección de datos personales

**Extensibilidad internacional:** existen módulos/adaptadores de jurisdicción y privacidad. Su existencia no certifica cumplimiento de GDPR, LGPD, HIPAA ni legislación de cada país; exige revisión del requisito, implementación y evidencia aplicable.

Las invariantes de acceso se definen en [`firestore.rules`](./firestore.rules), los handlers y los servicios de autorización. Deben verificarse con permisos positivos/negativos y el ámbito real; la presencia de un helper no prueba el aislamiento de todas las rutas. Catálogo completo de invariantes: [`security_spec.md`](./security_spec.md) ("Dirty Dozen" de payloads esperados a ser rechazados).

---

## Estado del proyecto

**En revisión de calidad y cierre de deuda técnica; no certificado para producción ni para publicación Android.** El alcance se conserva íntegro: no se considera lista una versión recortada por omitir capacidades pendientes.

La magnitud del código y la documentación acumulada son una base importante, pero no sustituyen evidencia de funcionamiento. La regla de cierre es resolver las tareas de **Notion Alpha 41**, con implementación, pruebas y evidencia verificable; una etiqueta de cierre por sí sola tampoco certifica el comportamiento.

### Qué significa «verificado»

- **Inventariado:** existe el archivo, ruta o montaje. No demuestra que el recorrido funcione.
- **Inspeccionado:** se leyó el código con referencias y versión; puede identificar defectos y controles.
- **Probado con mocks:** se ejecutó el caso indicado. No valida Firestore real, entrega externa ni dispositivo.
- **Integración/E2E:** recorrido ejecutado contra el entorno identificado, con readback y permisos negativos.
- **Android físico:** APK/AAB trazable a un SHA, dispositivo/OEM y resultados de permisos, suspensión, proceso muerto, offline y recuperación.

Un PASS que **reproduce un defecto** es evidencia para corregirlo, no evidencia de solución. Una corrección se cierra con regresión del contrato esperado, PR integrada y CI del SHA vigente; se añade validación real cuando el comportamiento depende de servicios o hardware.

### Evidencia y deuda de la revisión 2026-09-30

La [revisión de fronteras de identidad/proyecto](./docs/audits/2026-09-30-evidence/README.md) conserva resultados, fuentes, reproducciones ejecutables y enlaces a los tickets de Notion. Identifica defectos en visitantes, modales/roles MOC y Health Vault, y una prueba de historial dependiente del calendario. **Están documentados, no corregidos por esta actualización del README.**

No se publica un porcentaje global de «app funcionando» ni se extrapola un bloque verde al resto del producto. Los inventarios y auditorías anteriores se preservan como evidencia histórica, no como conteos actuales.

### Camino de calidad hacia Android

1. Reconciliar requisito → recorrido → código → evidencia → ticket, incluyendo entradas indirectas y montajes globales.
2. Corregir deuda confirmada y cubrir variantes críticas de identidad, proyecto, red, persistencia y ciclo de vida, sin eliminar capacidades.
3. Ejecutar integraciones/E2E autorizadas con datos sintéticos, incluyendo permisos negativos, reintentos y lectura de vuelta.
4. Producir un build Android trazable y probar dispositivos físicos: permisos, notificaciones, background/Doze, proceso muerto, almacenamiento/outbox, ubicación y BLE/sensores donde corresponda.
5. Validar firma, configuración de release, privacidad y declaraciones de datos/permisos según el comportamiento **real** del build; contrastar los requisitos vigentes en [Google Play Console Help](https://support.google.com/googleplay/android-developer/) y [Play Policy Center](https://play.google.com/about/developer-content-policy/).
6. Cerrar la cola de Notion y aportar evidencia de todos los gates antes de declarar la aplicación lista. iOS y pagos mantienen su alcance y planificación; la primera prioridad de publicación es Android.

Referencias de build y entrega: [runbook Android](./docs/mobile-build-runbook.md), [firma](./docs/mobile-signing-runbook.md), [submission](./MARKETPLACE_SUBMISSION.md). **Esta revisión no demuestra una subida a Play Console ni disponibilidad en la tienda.**


---

## Verticales de producto (mapa de implementación)

Este mapa orienta la investigación por dominio. El grafo ayuda a encontrar relaciones, pero no acredita funcionamiento ni ausencia de deuda. Cada vertical necesita recorridos y evidencia propios:

| Vertical | Qué hace | Archivos / hubs principales |
|---|---|---|
| **AI / RAG / Gemini** | Asistente "El Guardián" + análisis REBA/RULA + acciones Gemini con whitelist `ALLOWED_GEMINI_ACTIONS` | `services/gemini/`, `services/geminiBackend.ts`, `geminiService.ts`, `gemini.ts` (router), `aiToggle`, `aiQuality` |
| **CRQ / Ergonomía / Protocolos** | Cálculos determinísticos (REBA, RULA, IPER, PREXOR, TMERT, PLANESI, CEAL-SM) — son los motores bajo Stryker mutation | `services/ergonomics/`, `services/protocols/`, `services/safety/` |
| **Emergencia / SOS / ManDown** | SOS con outbox UUID + dead-letter; Hombre Caído con FGS/WorkManager nativo Android | `routes/emergency.ts`, `src/components/emergency/SOSButton.tsx`, `sosOutboxClient`, `packages/capacitor-mesh/`, `MeshPlugin.kt`, `MeshPlugin.swift` |
| **Mesh / offline / outbox** | Comunicación peer-to-peer entre dispositivos en faena (capacitor-mesh plugin nativo Android/iOS); outbox cifrado AES-256-GCM + HMAC con drain al reconectar | `mqttTelemetryBridge`, `meshPacket`, `encryptedOfflineQueue`, `encryptedKvStore`, `syncStateMachine`, `incidentOutbox`, `incidentFlow` |
| **Compliance / Privacy** | adaptadores de jurisdicción (`compliance/`) y `jurisdictionErrors`, ARCO, DS67/76, ley19628, KMS signer (`complianceKmsSigning`, `complianceSignature`, `compliance/registry`, `compliance/ley19628.ts`) | `complianceSignature`, `complianceKmsSigning`, `compliance/registry.ts`, `privacy/registry.ts` |
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
| **Backend** | Node.js compatible con las dependencias bloqueadas; Express 4.22, Firebase Admin SDK 14.5 |
| **Base de datos** | Firestore (cloud) + IndexedDB / SQLite (offline) |
| **IA** | `@google/genai` (Gemini), MediaPipe Vision y módulos de embeddings; versiones en `package-lock.json` |
| **Mobile** | Capacitor 8.5.1 (Android, iOS); validación física por plataforma pendiente de evidencia |
| **Maps / Geo** | React Google Maps, Turf, Leaflet, A*/Dijkstra |
| **PDF** | `pdfkit` (server) + `jspdf` (cliente) |
| **Auth** | Firebase Auth + custom claims (RBAC) |
| **Notificaciones** | Firebase Cloud Messaging (FCM) |
| **Billing** | Transbank SDK (Webpay), MercadoPago, Khipu, Google Play RTDN, Apple JWS, IAP Apple/Google |
| **Testing** | Vitest según lockfile, Stryker (mutation) y ratchets definidos en CI |
| **Observabilidad** | Sentry + cloud-error-reporting + Prometheus + PiiRedactor |
| **Seguridad** | AES-256-GCM, WebAuthn, KEK rotation, KMS 90-day, TLS cert-pinning (gating con ratchet) |

---

## Setup local

### Requisitos

- Node.js/npm compatibles con los `engines` de las dependencias de [`package-lock.json`](./package-lock.json). No asumir que cualquier Node 20 funciona con la versión de Vite bloqueada.
- Una cuenta de Firebase con Firestore habilitado
- API key de Gemini (Google AI Studio) — `GEMINI_API_KEY`

### Instalación

```bash
git clone https://github.com/mikesandoval10creator/Guardian-Praeventio.git
cd Guardian-Praeventio
npm ci

cp .env.example .env.local
$EDITOR .env.local   # ver docs/runbooks/SECRETS_RUNBOOK.md para cada variable

npm run validate:env   # verifica shape del .env antes de bootear
npm run typecheck      # tsc --noEmit (0 errores = invariante)
npm run test           # vitest run; tiempo y recursos dependen del entorno
npm run dev            # http://localhost:3000
```

> El repo incluye `.npmrc` con `legacy-peer-deps=true` para tolerar peer-ranges desactualizados de algunas dependencias upstream.

### Entorno y credenciales

No hay una lista «mínima» válida para todos los modos. [`scripts/validate-env.cjs`](./scripts/validate-env.cjs) define las variables y formatos de producción, opcionales y condicionales; consultar el [runbook de secretos](./docs/runbooks/SECRETS_RUNBOOK.md) y `.env.example` para preparar el entorno.

`npm run validate:env` usa el contrato de producción por defecto. Un modo de test no acredita que las integraciones reales estén configuradas; no inventar credenciales ni desactivar validaciones para aparentar disponibilidad.

`firebase-applet-config.json` es configuración de la aplicación y está versionado; **no reemplazarlo con una clave privada de service account**. El backend usa Application Default Credentials fuera del emulador (`server.ts`). Las credenciales privadas no se publican ni se añaden al repositorio.

### Comandos principales

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor Express + Vite con HMR en `http://localhost:3000` |
| `npm run build` | Build de producción del frontend |
| `npm run preview` | Servir el build localmente para verificar |
| `npm run start` | Servidor en modo producción |
| `npm run typecheck` | Verificación de tipos TypeScript (0 errores = invariante) |
| `npm run lint` | ESLint y controles de lecturas, errores de usuario y divulgación PGP definidos en `package.json` |
| `npm run lint:fix` | Autofix ESLint según el script; revisar el diff y volver a ejecutar gates |
| `npm run test` | Suite Vitest general; no incluye las integraciones/rules excluidas en `vitest.config.ts` |
| `npm run validate:env` | Verifica shape del `.env.local` antes de bootear |
| `npm run mutation` | Stryker sobre motores de cálculo de seguridad |
| `npm run cap:android` | Sincronizar y abrir Android Studio |
| `npm run cap:ios` | Sincronizar y abrir Xcode |
| `npm run test:rules` | Pruebas de reglas con emuladores Firestore/Storage; requiere entorno de emulación |

### Ratchets de CI (gates de release)

Estos controles automatizados detectan clases concretas de regresiones según sus baselines. No todos usan contadores con la misma dirección; pasar un ratchet no certifica el producto. Consultar los workflows de [CI](./.github/workflows/) y el código del control:

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

`npm run mutation` ejecuta Stryker según [`stryker.config.json`](./stryker.config.json), sobre los targets allí definidos. Una cobertura de líneas alta no basta para demostrar que los tests detectan cambios incorrectos en motores de riesgo.

Registrar versión, targets, mutantes, resultado y reporte de cada ejecución; comparar solo alcances equivalentes. Esta revisión no ejecutó Stryker y no presenta un score histórico como score actual. Consultar [CI](./.github/workflows/) para conocer qué gates se aplican al SHA de una PR.

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
│  Backend (Express + tsx, server.ts)                        │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐              │
│  │ verifyAuth │  │ Gemini RAG │  │ FCM push   │              │
│  │ + claims   │  │ /ask-guard │  │ + triggers │              │
│  │ + WebAuthn │  │ + SLM      │  │ + Geofence │              │
│  └────────────┘  └────────────┘  └────────────┘              │
│  eventLog.ts: pipeline de eventos y auditoría             │
└─────────────────────────────────────────────────────────────┘
          │                 │              │
          ▼                 ▼              ▼
┌──────────────────┐  ┌──────────────────────────┐
│ Firestore        │  │ Google Cloud (Vertex AI, │
│ + reglas RBAC    │  │ Pub/Sub, Play Billing,   │
│ reglas de acceso │  │ Cloud Run, KMS, Sentry)  │
└──────────────────┘  └──────────────────────────┘
```

- **`server.ts`** — punto de entrada del backend; orquesta autenticación, endpoints API, OAuth con Google Workspace/Calendar/Fit, billing webhook, RAG y triggers en background. God-file en split pendiente (ver `ARCHITECTURE.md` para estrategia).
- **`src/routes/`** — frontend SPA con `lazy()` para code-splitting.
- **`src/server/routes/`** — handlers HTTP agrupados por dominio.
- **`firestore.rules`** — reglas de acceso, validación y auditoría; contrastar con handlers y pruebas de emulador.
- **`android/`** — proyecto Capacitor nativo y configuración de build.
- **`packages/capacitor-mesh/`** — plugin nativo BLE mesh (Kotlin + Swift).
- **`tasks/`** — planes de implementación (EPP vision, PTS grounding) y lessons learned.
- **Índices/grafos de investigación** — consultar la versión y fecha del artefacto disponible; no asumir que un grafo local está publicado o actualizado en este checkout.

### Patrones arquitectónicos identificados

- **Pipeline de eventos** — `eventLog.emit()` organiza validación/append/bus/audit; comprobar por recorrido qué escrituras lo usan.
- **Pure/Server-Only split** — funciones puras vs Node-only (`analytics/serverAdapter`)
- **Resiliencia IA** — fallbacks y Resilience Health Monitor; probar agotamiento de proveedores, timeout y ausencia de datos sin fabricar resultados.
- **Persistencia y ámbito** — revisar el path/adapter realmente usado por cada módulo; no asumir que todas las colecciones siguen el mismo esquema.
- **Privacidad y auditoría** — contratos de minimización/consentimiento y trazabilidad; comprobar implementación y retención por mutación.
- **Build provenance** — SHA-256 + WebAuthn signature + atomic folio + jsPDF

---

## Seguridad y privacidad

El diseño incluye autenticación Firebase, autorización por proyecto/tenant, reglas de acceso, auditoría, cifrado, WebAuthn, controles de red y redacción de PII. **La presencia de esos mecanismos no certifica todos los handlers ni todos los flujos.**

- Secretos backend fuera del cliente y del repositorio; revisar configuración y rotación con el [runbook](./docs/runbooks/SECRETS_RUNBOOK.md).
- Permisos positivos y negativos en handlers/reglas, con identidad y ámbito comprobados en el servidor.
- Aislamiento también en el cliente: limpiar e invalidar datos, modales y respuestas tardías al cambiar usuario, proyecto o grant. La [auditoría reciente](./docs/audits/2026-09-30-evidence/README.md) contiene deuda confirmada en este punto.
- Cámara, micrófono, ubicación y datos de salud: verificar consentimiento, propósito, minimización, retención y salida real de datos por recorrido; no afirmar «100% on-device» sin comprobarlo.
- Para cifrado, firma, outbox y TLS pinning, comprobar el contrato y la configuración del build de destino; el ratchet por sí solo no demuestra el comportamiento en dispositivo.

Contratos: [`security_spec.md`](./security_spec.md), [`firestore.rules`](./firestore.rules), [`SECURITY.md`](./SECURITY.md). Los tests con mocks no sustituyen las reglas contra emulador, ni una prueba con datos reales está autorizada por este README.

---

## Despliegue

### Cloud Run (recomendado)

El [`Dockerfile`](./Dockerfile) hace build multi-stage (frontend + servidor) y expone el puerto 3000 con healthcheck en `/api/health`.

Configurar en Cloud Run:
- Secretos como variables de entorno (Secret Manager)
- Configuración Firebase separada de credenciales privadas; ADC y secretos según el runbook
- Service account con permisos de Firestore Admin y Vertex AI

Más detalle: [`RUNBOOK.md`](./RUNBOOK.md) + [`DR_RUNBOOK.md`](./DR_RUNBOOK.md). Secretos: [`docs/runbooks/SECRETS_RUNBOOK.md`](./docs/runbooks/SECRETS_RUNBOOK.md). Rotación KMS 90-day: [`KMS_ROTATION.md`](./KMS_ROTATION.md). Pipeline Cloud Build: [`docs/runbooks/CLOUD_BUILD_RUNBOOK.md`](./docs/runbooks/CLOUD_BUILD_RUNBOOK.md).

> **Estado vivo del deploy:** consultar [GitHub Actions](https://github.com/mikesandoval10creator/Guardian-Praeventio/actions), workflow y SHA exacto. Un registro histórico de fallo no es el estado actual; un job omitido tampoco es evidencia de despliegue.

### AI Studio

Este proyecto también puede correrse desde Google AI Studio: <https://ai.studio/apps/d2437df8-893e-424f-a15b-f6c3b5f170dc>.

### Android (Capacitor)

```bash
npm run cap:android   # sync + abre Android Studio
```

El proyecto Android vive en [`android/`](./android/). `cap:android` construye/sincroniza y abre Android Studio; no acredita un release firmado ni una prueba física. Más detalle: [`MARKETPLACE_SUBMISSION.md`](./MARKETPLACE_SUBMISSION.md) + [`IOS_BUILD.md`](./IOS_BUILD.md).

---

## Características principales

- **El Guardián** — asistente IA con RAG sobre la base normativa chilena (BCN, ISO).
- **Vision Analyzer** — detección de EPP y riesgos por computer vision (Gemini + MediaPipe edge on-device).
- **Knowledge Graph (Zettelkasten)** — red neuronal de riesgos, normativas y controles, navegable en 2D y 3D.
- **Modo Crisis** — chat de emergencia, check-in, detección de "Hombre Caído", rutas de evacuación dinámicas (A*/Dijkstra).
- **Análisis predictivo** — REBA/RULA ergonómicos, fatiga por video, cruces clima-tarea, pre-shift scoring.
- **PWA + Capacitor** — capacidades offline/sync y proyectos móviles; validar recuperación y paridad por plataforma antes de certificarlas.
- **i18n** — soporte multi-idioma (es-CL por defecto).
- **Multi-tenant con RBAC** — admin, supervisor, prevencionista, operario, gerente. Custom claims en Firebase Auth.
- **Audit logs** — mecanismos de trazabilidad; verificar cobertura de cada transición y restricciones de mutación.
- **Mesh BLE offline** — comunicación peer-to-peer entre dispositivos en faena sin señal.
- **B2D (Business-to-Developer)** — ver [`API_B2D_SPEC.md`](./API_B2D_SPEC.md).
- **DTE / SII** — integración con Servicio de Impuestos Internos para facturación electrónica.

Para pendientes, consultar Notion Alpha 41 y las [auditorías trazadas](./docs/audits/); para contexto histórico, [`TODO.md`](./TODO.md). Ver [`PRICING.md`](./PRICING.md) para monetización.

---

## Para nuevos contribuidores

Lee estos documentos antes de tocar nada:

1. **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** — flujo TDD (RED → GREEN → REFACTOR), convenciones, cómo agregar rutas / acciones Gemini / motores de cálculo, checklist de PR.
2. **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — mapa de módulos, data flows críticos (Webpay, REBA, curriculum claims), estrategia de split de `server.ts` y `geminiBackend.ts`, inventario de colecciones Firestore, modelo de tier-gating.
3. **[`RUNBOOK.md`](./RUNBOOK.md)** — procedimientos operacionales: emulador Firestore, deploy a Cloud Run, restore de backup, rotación KMS, FCM de prueba, triage Sentry.
4. **[`docs/api-routes.md`](./docs/api-routes.md)** — catálogo de endpoints HTTP.
5. **[Evidencia de revisión](./docs/audits/2026-09-30-evidence/README.md)** — defectos confirmados, controles positivos, límites y cómo reproducirlos antes de corregir.

Para emergencias de producción: [`DR_RUNBOOK.md`](./DR_RUNBOOK.md). Para reportes de seguridad: [`SECURITY.md`](./SECURITY.md). Para planes de implementación: [`tasks/`](./tasks/).

---

## Referencias de auditoría y vault

Fuentes complementarias, con responsabilidades distintas:

- **Notion Alpha 41** — cola viva de deuda/requisitos, criterios de aceptación y enlaces a PR/evidencia. El informe enlaza los tickets de esta revisión; no mantener otra lista de estados manualmente en el README.
- [Auditorías del repo](./docs/audits/) — snapshots técnicos con versión, alcance y límites. [Revisión 2026-09-30](./docs/audits/2026-09-30-evidence/README.md).
- [`TODO.md`](./TODO.md) y planes — contexto de trabajo, no sustituyen la reconciliación de Notion ni validan cierres por sí solos.
- [Arquitectura](./ARCHITECTURE.md) e índices/grafos — navegación y relaciones; no evidencia de ejecución.

El vault Obsidian de Daniel no forma parte de este repo. Preservar sus notas históricas y reconciliarlas con el ledger antes de afirmar qué falta leer:

- `01-Guardian/01-MOC-INDEX/00-MOC-Guardian-Maestro.md` — entrada al conocimiento acumulado.
- `01-Guardian/01-MOC-INDEX/Ledger-Cobertura-Codigo-Guardian.md` — piso hash-backed de lectura; **no representa por sí solo toda la lectura histórica** ni certifica funcionamiento.
- Auditorías pre-producción/nocturnas y `01-Guardian/09-VIDA-SAFETY/` — antecedentes y riesgos; cada afirmación histórica requiere revalidación antes de presentarse como estado actual.

No sumar ejecuciones solapadas ni mezclar archivos inventariados, lectura parcial, pruebas con mocks, E2E y Android físico bajo un único porcentaje.

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
