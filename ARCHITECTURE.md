# Praeventio Guard — Architecture

Documento vivo describiendo la arquitectura, los flujos de datos y la
estrategia de evolución del codebase. Si algo de este documento contradice
el código, **el código es la fuente de verdad** — abre un PR para corregir
el doc.

Última revisión: Round 16 / 2026-04-28. HEAD: `7b907d8`.

---

## 1. High-level architecture

Praeventio Guard es una **PWA single-page** servida por un **monolito Node**
en Cloud Run. Capacitor empaqueta la misma SPA como app nativa Android/iOS
para faena offline.

```
┌──────────────────────────────────────────────────────────────────┐
│  Cliente                                                         │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────────────┐    │
│  │ React 19 SPA  │  │ IndexedDB +  │  │ MediaPipe + native  │    │
│  │ (Vite, R7)    │  │ SQLite       │  │ sensors (Capacitor) │    │
│  │ Tailwind 4    │  │ (offline KV) │  │ (on-device)         │    │
│  └───────┬───────┘  └──────┬───────┘  └─────────┬───────────┘    │
└──────────┼──────────────────┼─────────────────────┼─────────────┘
           │ HTTPS + IdToken  │ syncManager.ts      │ no-network
           ▼                  ▼                     ▼
┌──────────────────────────────────────────────────────────────────┐
│  Backend — Express monolith (`server.ts`)                        │
│  ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │verifyAuth│ │ Gemini proxy │ │ Billing  │ │ Triggers        │  │
│  │(Firebase │ │ (whitelist)  │ │ (Webpay  │ │ (FCM push,      │  │
│  │ Admin)   │ │              │ │  + MP)   │ │  RAG ingest)    │  │
│  └──────────┘ └──────────────┘ └──────────┘ └─────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
           │             │              │              │
           ▼             ▼              ▼              ▼
    ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
    │ Firestore  │ │ Vertex AI  │ │ Transbank  │ │ FCM /      │
    │ (RBAC,     │ │ + Gemini   │ │ MercadoPago│ │ Resend /   │
    │ append-    │ │ + embed.   │ │            │ │ Sentry     │
    │ only)      │ │            │ │            │ │            │
    └────────────┘ └────────────┘ └────────────┘ └────────────┘
```

Decisiones clave:
- **Mismo origen** (`http://localhost:3000` en dev, `https://app.praeventio.net`
  en prod) para SPA + API. Vite corre en `middlewareMode` dentro del proceso
  de Express → cero CORS en dev, cookies de sesión funcionan tal cual.
- **Firebase Admin SDK** del lado servidor verifica el `Authorization:
  Bearer <idToken>` del cliente; el cliente nunca habla directo a Firestore
  para operaciones privilegiadas (audit_logs, invoices, billing).
- **Default-deny en `firestore.rules`**. Las colecciones que tocan PII o
  dinero (`invoices`, `processed_pubsub`, `processed_webpay`,
  `transactions`) no tienen reglas → solo el server con Admin SDK escribe.
- **Procesamiento biométrico 100% on-device** (MediaPipe Vision + Health
  Connect / HealthKit). No salen frames de cámara ni heart-rate al servidor.

---

## 2. Module map

### Frontend (`src/`)
```
src/
├── pages/                  # 87+ páginas, una por feature top-level
├── components/             # UI compartida (modales, wizards, charts)
├── contexts/               # Providers globales (8 contextos)
│   ├── FirebaseContext.tsx        # auth + db + storage
│   ├── ProjectContext.tsx         # proyecto activo + miembros
│   ├── SubscriptionContext.tsx    # tier-gating (8 feature flags)
│   ├── EmergencyContext.tsx       # modo crisis
│   ├── SensorContext.tsx          # IoT + wearables
│   ├── NotificationContext.tsx    # toasts + FCM
│   ├── UniversalKnowledgeContext.tsx
│   └── LanguageProvider.tsx       # i18next
├── hooks/                  # custom hooks (~50)
├── routes/                 # react-router 7, lazy() splitting por dominio
├── services/               # cliente HTTP + lógica de dominio (ver abajo)
├── lib/                    # utilities puras (date, crypto, formatters)
├── utils/                  # helpers de UI
├── types/                  # tipos compartidos cliente↔servidor
├── data/                   # tablas estáticas (normativa, REBA, RULA, GHE)
│   └── normativa/          # base de leyes BCN + ISO indexada
└── __tests__/              # tests vitest + supertest + rules-unit-testing
```

### Backend (server-side)
```
server.ts                   # 3242 LOC — entry point monolítico
                            # Migración en marcha hacia src/server/*
src/server/                 # destino post-R5/R17/R18
├── routes/                 # un archivo por dominio (ver §4)
├── middleware/             # verifyAuth, assertProjectMember, rate limiters
├── triggers/               # Firestore onSnapshot listeners
└── adapters/               # webpay, stripe, mercadopago, resend
```

### Shared (cliente y servidor)
```
src/lib/                    # crypto, date, parser de pseudo-markdown
src/utils/                  # tipos zod, helpers de validación
src/types/                  # interfaces compartidas (Invoice, Claim, etc.)
src/data/normativa/         # corpus de leyes (BCN, ISO, NCh)
```

### AI (`src/services/ai`, `src/services/gemini*`)
```
src/services/geminiBackend.ts   # 2666 LOC — god-file en migración (R18)
src/services/geminiService.ts   # cliente HTTP que llama /api/gemini
src/services/ragService.ts      # vector search sobre normativa
src/services/ai/                # destino post-split (gemini/{domain}.ts)
```

---

## 3. Data flows críticos

### 3.1 Webpay payment (CLP)

```
Pricing.tsx (cliente)
    │  POST /api/billing/checkout {tierId,cycle,currency:'CLP',
    │                              paymentMethod:'webpay',cliente,...}
    ▼
server.ts:1972  validate body → resolveBillingTier → buildInvoice
    │  Firestore.invoices.doc(id).set({status:'pending-payment',...})
    │  webpayAdapter.createTransaction({amount, returnUrl,...})
    │  → Transbank tx token
    │  ◀── res.json({invoiceId, paymentUrl, status:'awaiting-payment'})
    ▼
SPA redirige a paymentUrl (Transbank-hosted)
    │  usuario paga
    ▼
Transbank → GET /billing/webpay/return?token_ws=...
    │
server.ts:2321  acquireWebpayIdempotencyLock(processed_webpay/{token_ws})
    │  webpayAdapter.commitTransaction(token_ws) → AUTHORIZED|REJECTED|FAILED
    │  invoices.doc(id).update({status:'paid'|'rejected'|'pending-payment'})
    │  finalizeWebpayIdempotencyLock
    │  audit_logs.add({action:'billing.webpay-return.authorized',...})
    │  → res.redirect('/pricing/success?invoice=...')
    ▼
SPA Pricing.tsx → useInvoicePolling → GET /api/billing/invoice/:id (≤1Hz)
    │  invoiceStatusLimiter (600 req/15min/uid)
    │  ✓ status === 'paid' → upgrade UI, refetch SubscriptionContext
```

Idempotencia: doble redirect del navegador (reload) o redelivery de
Transbank no procesa dos veces — `processed_webpay/{token_ws}` actúa como
mutex con TTL de 5 minutos.

### 3.2 REBA assessment (ergonomía)

```
AddErgonomicsModal.tsx (wizard 6-step)
    │  paso 1-5 captura ángulos de tronco/cuello/piernas/brazos/muñeca
    │  paso 6: revisión + firma del prevencionista
    ▼
calculateReba(inputs)  ← src/services/ergonomics/reba.ts (función pura)
    │  tabla A → score parcial torso/cuello/piernas
    │  tabla B → score parcial brazos/antebrazo/muñeca
    │  tabla C → score combinado + ajuste por carga + actividad
    │  → { score, level, recommendations }
    ▼
Firestore: ergonomic_assessments.add({
   workerId, projectId, inputs, score, level,
   signedBy, signedAt, createdAt
})
    │  reglas: append-only post-sign, member del proyecto
    ▼
auditService.logAuditAction({
   action: 'ergonomics.reba.signed',
   module: 'ergonomics',
   details: { workerId, score, level },
   projectId
})
    │  → POST /api/audit-log → server estampa userId + email del token
    ▼
audit_logs.add(...) (server-only via Admin SDK)
```

### 3.3 Curriculum claim (anti-fraude flagship)

```
ClaimForm.tsx (worker)
    │  worker firma claim (WebAuthn o standard) + nombra 2 referees
    │  POST /api/curriculum/claim {claim, category, referees, signedByWorker}
    ▼
server.ts:2901  validate (≤500 chars, exactly 2 referees, distinct emails)
    │  curriculumCreateClaim(...)
    │     → curriculum_claims.add({ status:'pending_referees', ... })
    │     → genera 2 raw tokens (256-bit) + hashea → tokenHash en cada slot
    │     → audit_logs.add('curriculum.claim.created')
    │  resend.emails.send(magicLink) × 2  (best-effort, non-blocking)
    │  ◀── res.json({success:true, claimId})
    ▼
Referee abre el email → GET /curriculum/referee/:token (público)
    │  refereeLimiter (30 req/15min)
    │  GET /api/curriculum/referee/:token → preview (claimText, workerName,...)
    ▼
RefereeAccept.tsx muestra claim, referee co-firma o declina
    │  POST /api/curriculum/referee/:token {action:'cosign', method, signature}
    ▼
server.ts:3115  hash(token) → match contra slot pendiente
    │  curriculumEndorse(...)
    │     → si ambos referees firmaron → status:'verified', append-only lock
    │     → si declina → status:'rejected'
    │     → audit_logs.add('curriculum.referee.signed' | '...declined')
```

Integridad: el server solo guarda `tokenHash` (SHA-256), nunca el raw token.
Resend rota el token (issue uno nuevo, reemplaza el hash) en lugar de
re-enviar — el viejo queda inerte.

---

## 4. Server.ts split strategy

`server.ts` (3242 LOC al cierre de R16) viola el guideline de "un módulo,
una responsabilidad". El split es incremental para mantener la suite de
tests verde en cada paso.

### Estado actual
- **R5 (en progreso)**: extraer middleware (`verifyAuth`,
  `assertProjectMember`, rate limiters) a `src/server/middleware/`.
- **R17 (planificada)**: extraer adaptadores (`webpayAdapter`, `stripeAdapter`,
  `mercadoPagoAdapter`) — ya parcial, completar.
- **R18 (planificada)**: extraer rutas a `src/server/routes/`.

### Mapa de rutas propuesto (`src/server/routes/*`)

| Archivo | Rutas migradas | LOC estimadas |
|---|---|---|
| `health.ts`        | `/api/health` | 30 |
| `admin.ts`         | `/api/admin/revoke-access`, `/api/admin/set-role` | 110 |
| `audit.ts`         | `/api/audit-log` | 80 |
| `oauth.ts`         | `/api/auth/google/url`, `/auth/google/callback`, `/api/oauth/unlink`, `/api/drive/auth/*` | 200 |
| `calendar.ts`      | `/api/calendar/list`, `/api/calendar/sync` | 120 |
| `fitness.ts`       | `/api/fitness/sync` (deprecated until 2026-12-31) | 80 |
| `environment.ts`   | `/api/environment/forecast` | 40 |
| `telemetry.ts`     | `/api/telemetry/ingest` | 100 |
| `seed.ts`          | `/api/seed-glossary`, `/api/seed-data` | 50 |
| `projects.ts`      | `/api/projects/:id/*`, `/api/invitations/*` | 350 |
| `gamification.ts`  | `/api/gamification/*` | 50 |
| `coach.ts`         | `/api/coach/chat` | 30 |
| `legal.ts`         | `/api/legal/check-updates` | 40 |
| `gemini.ts`        | `/api/gemini` (proxy + whitelist) | 130 |
| `billing.ts`       | `/api/billing/verify`, `/api/billing/checkout`, `/api/billing/invoice/:id`, `/api/billing/invoice/:id/mark-paid` | 400 |
| `billing-webpay.ts`| `/billing/webpay/return`, `/api/billing/webhook` (RTDN) | 350 |
| `billing-mp.ts`    | `/api/billing/checkout/mercadopago`, `/api/billing/webhook/mercadopago` | 300 |
| `reports.ts`       | `/api/reports/generate-pdf` | 120 |
| `erp.ts`           | `/api/erp/sync` | 50 |
| `ask-guardian.ts`  | `/api/ask-guardian` | 100 |
| `curriculum.ts`    | `/api/curriculum/claim*`, `/api/curriculum/referee/:token` | 350 |

### Migración sin downtime
Cada PR de migración:
1. Crea el archivo nuevo en `src/server/routes/{domain}.ts` con los handlers.
2. Reemplaza en `server.ts` el bloque de rutas por
   `app.use(routerFromModule)`.
3. Tests existentes (`src/__tests__/server/{domain}.test.ts`) deben pasar
   sin cambios — son la red de seguridad.
4. Si tests no existen, **escribirlos antes** del split (red → green →
   migrate).

---

## 5. GeminiBackend.ts split strategy (R18)

`src/services/geminiBackend.ts` exporta ~85 funciones para el proxy
`/api/gemini`. Split propuesto en `src/services/gemini/`:

| Módulo | Funciones | Dominio |
|---|---|---|
| `embeddings.ts`   | `generateEmbeddingsBatch`, `searchRelevantContext` | Vector search |
| `safety.ts`       | `analyzeRiskWithAI`, `analyzePostureWithAI`, `analyzeSafetyImage`, `auditAISuggestion`, `getSafetyAdvice`, `getChatResponse` | Safety chat & análisis |
| `compliance.ts`   | `analyzeDocumentCompliance`, `auditLegalGap`, `evaluateNormativeImpact`, `evaluateMinsalCompliance`, `auditProjectComplianceWithAI`, `scanLegalUpdates`, `queryBCN`, `downloadSpecificNormative` | Cumplimiento normativo |
| `pts.ts`          | `generatePTS`, `generatePTSWithManufacturerData`, `analyzeFastCheck` | Procedimientos de Trabajo Seguro |
| `iso.ts`          | `generateISOAuditChecklist`, `processGlobalSafetyAudit` | Auditorías ISO |
| `incidents.ts`    | `predictGlobalIncidents`, `investigateIncidentWithAI`, `analyzeRootCauses`, `forecastSafetyEvents`, `predictAccidents` | Investigación + predicción |
| `epp.ts`          | `verifyEPPWithAI`, `predictEPPReplacement`, `auditEPPCompliance`, `optimizePPEInventory` | EPP |
| `network.ts`      | `autoConnectNodes`, `simulateRiskPropagation`, `enrichNodeData`, `analyzeRiskNetwork`, `analyzeRiskNetworkHealth`, `analyzeFeedPostForRiskNetwork`, `syncNodeToNetwork`, `syncBatchToNetwork` | Knowledge graph |
| `chemicals.ts`    | `analyzeChemicalRisk`, `suggestChemicalSubstitution`, `designHazmatStorage` | Riesgos químicos |
| `psychosocial.ts` | `analyzePsychosocialRisks`, `generateStressPreventionTips`, `analyzeShiftFatiguePatterns`, `generateShiftHandoverInsights` | Riesgo psicosocial |
| `training.ts`     | `generateTrainingRecommendations`, `generateTrainingQuiz`, `generateCustomSafetyTraining`, `generateSafetyCapsule` | Capacitación |
| `vision.ts`       | `analyzeVisionImage`, `analyzeBioImage`, `validateRiskImageClick`, `processAudioWithAI`, `processDocumentToNodes`, `analyzeSiteMapDensity`, `extractAcademicSummary` | Visión + multimodal |
| `emergency.ts`    | `generateEmergencyPlan`, `generateEmergencyPlanJSON`, `generateEmergencyScenario`, `calculateDynamicEvacuationRoute` | Emergencias |
| `health.ts`       | `analyzeHealthPatterns`, `mapRisksToSurveillance`, `getNutritionSuggestion`, `generateCompensatoryExercises`, `analyzeAttendancePatterns` | Salud ocupacional |
| `iot.ts`          | `generateRealisticIoTEvent`, `analyzeRiskCorrelations` | IoT + telemetría |
| `governance.ts`   | `suggestMeetingAgenda`, `summarizeAgreements`, `suggestRisksWithAI`, `suggestNormativesWithAI`, `analyzeFaenaRiskWithAI` | Comité Paritario |
| `business.ts`     | `generateExecutiveSummary`, `calculateComplianceSummary`, `calculatePreventionROI`, `generatePersonalizedSafetyPlan`, `generateActionPlan`, `generateSafetyReport`, `generateOperationalTasks`, `generateModuleRecommendations`, `generatePredictiveForecast`, `generateSusesoFormMetadata`, `calculateStructuralLoad` | Reportes ejecutivos |
| `semantic.ts`     | `semanticSearch` | Search |

`server.ts` line 1593 importa todas y agrupa en `ALLOWED_GEMINI_ACTIONS`.
Post-split, ese array se construye dinámicamente desde el agregador
`src/services/gemini/index.ts`.

---

## 6. Firestore collections inventory

| Colección | Modelo | Reglas | Notas |
|---|---|---|---|
| `users`               | RBAC raíz | self-read, admin-write | custom claims `role`. |
| `projects`            | Multi-tenant | members[]+createdBy lectura/escritura | tenant boundary. |
| `invitations`         | Token | server-only writes | tokens 32-byte hex. |
| `audit_logs`          | Append-only | create:true, update:false, delete:false | inmutable forensic trail. |
| `nodes`               | Knowledge graph | member del proyecto | Hallazgo, Incidente, Riesgo, normative, pts, protocol, document. |
| `incidents`           | Por proyecto | member | snapshot legacy, migrando a `nodes`. |
| `ergonomic_assessments`| Append-only post-sign | member, signed → readonly | REBA, RULA, NIOSH. |
| `chemical_exposure_records` | Append-only post-sign | member | DS 594 art. 70+. |
| `curriculum_claims`   | Worker-owned | append-only post-verify | flagship anti-fraude. |
| `invoices`            | Default-deny | server-only (Admin SDK) | facturación CLP/USD/MP. |
| `transactions`        | Default-deny | server-only | Google Play purchases. |
| `processed_pubsub`    | Default-deny | server-only | RTDN idempotency. |
| `processed_webpay`    | Default-deny | server-only | Webpay idempotency. |
| `user_sessions`       | Self | self-read | revocación de tokens. |
| `user_stats`          | Self | self-read, server-write | gamification. |
| `medals`              | Catálogo | public-read | gamification. |
| `telemetry_events`    | Por proyecto | member, server-only write | IoT. |
| `erp_sync_logs`       | Por uid | self-read | mock SAP/Defontana. |
| `oauth_tokens`        | Default-deny | server-only (envelope KMS) | Google + Drive. |
| `glossary`            | Catálogo | public-read | términos normativos. |
| `bcnKnowledge`        | Catálogo | public-read | leyes BCN. |
| `protocols`           | Catálogo | public-read | PTS templates. |
| `safety_capsules`     | Catálogo | member-read | micro-trainings IA. |
| `meeting_agendas`     | Comité | member-read/write | gobernanza. |
| `feed_posts`          | Por proyecto | member | feed social interno. |
| `feed_comments`       | Por proyecto | member | comentarios. |
| `feed_reactions`      | Por proyecto | member | likes. |
| `psychosocial_surveys`| Anónimo | server-write | SUSESO ISTAS-21. |
| `evacuation_plans`    | Por proyecto | member | plan de evacuación A*. |
| `crisis_checkins`     | Self | self-write | modo crisis. |
| `chat_threads` / `chat_messages` | Por proyecto | member | El Guardián chat. |

Total inventariado: **30+ colecciones**. La spec completa de invariantes
vive en `security_spec.md` ("Dirty Dozen"). Cualquier nueva colección
requiere un PR que toque a la vez `firestore.rules`, `security_spec.md` y
los tests de reglas (mínimo 5 — ver `CONTRIBUTING.md` §"Reglas de
Firestore").

---

## 7. Tier-gating model

`src/contexts/SubscriptionContext.tsx` calcula 8 feature flags a partir del
`subscription.planId` del documento `users/{uid}` y los expone vía
`useSubscription()` al árbol React.

| Flag | Tier mínimo | Enforcement |
|---|---|---|
| `canUseExecutiveDashboard`   | Oro          | Frontend route guard + tile visibility. |
| `canUseSSO`                  | Titanio      | Frontend gate (config); server enforces via custom claim si SSO está activo. |
| `canUseGoogleWorkspaceAddon` | Titanio      | Frontend tile + `/api/calendar/*` gating. |
| `canUseAdvancedAnalytics`    | Diamante     | Frontend; queries más caras se gatean por uid en server. |
| `canUseCustomBranding`       | Diamante     | Frontend (whitelabel CSS vars + logo upload). |
| `canUseVertexFineTune`       | Empresarial  | Frontend; el endpoint `/api/gemini` con acción de fine-tune valida tier antes de despachar. |
| `canUseAPIAccess`            | Empresarial  | Server: keys API generadas en panel admin, scoped por uid. |
| `canUseMultiTenant`          | Corporativo  | Server: header `X-Tenant-Id` requerido en API access flows. |

Ranks definidos en `subscription.ts`:
`free=0 < comite=1 < departamento=2 < plata=3 < oro=4 < titanio=5 <
diamante=6 < empresarial=7 < corporativo=8 < ilimitado=9`.

Server-side: cuando un endpoint requiere un tier mínimo, lee
`users/{uid}.subscription.planId` y compara contra `RANK_*`. Frontend gating
solo es UX — el enforcement de seguridad **siempre** vive en el server.

---

## 8. Observability

Tres capas:

1. **Sentry** (`@sentry/node` + `@sentry/react`) — captura excepciones
   no manejadas. El error middleware terminal en `server.ts:3191` llama a
   `getErrorTracker().captureException(...)` para todo error que llegue al
   bottom de Express. El cliente envuelve el error boundary en
   `src/services/observability/`.
2. **Cloud Monitoring** — métricas custom vía
   `praeventio/webpay/return_latency_ms` (histograma con label
   `outcome=success|failure|invalid`). Los descriptors están en
   `infrastructure/monitoring.tf` (Terraform) — los labels son inmutables,
   verificar contra `webpayMetrics.ts` antes de cambiar.
3. **`audit_logs` collection** — trail forense inmutable. Append-only por
   reglas Firestore. Cualquier cambio de estado del sistema deja entrada,
   con `userId` y `userEmail` estampados desde el token verificado por el
   server (no desde el body — el cliente no puede impersonar).

Logging estructurado: `src/services/observability/logger.ts` expone
`logger.info|warn|error(event, payload)`. Eventos canónicos visibles en
`server.ts`: `rtdn_received`, `rtdn_in_progress_skip`,
`webpay_return_failed`, `oauth_unlink_failed`, `iot_ingest_failed`, etc.

Métricas con cardinality discipline: ver `OBSERVABILITY.md` para reglas
sobre labels (no incluir uid, projectId, ni nada con > 100 valores
distintos).

---

## 9. Build + deploy

### Build
- `npm run build` ejecuta `vite build` → `dist/` con code-splitting por route
  (lazy + Suspense). Targets de bundle size: chunk principal ≤ 300kB
  gzipped (verificado por `npm run size` con `size-limit`).
- `npm run cap:android|cap:ios` ejecuta `vite build` y luego `cap sync`
  para empaquetar el SPA dentro del WebView nativo.

### Deploy a Cloud Run
- `Dockerfile` multi-stage (deps → build → runtime). Imagen final ~200 MB
  (Node 20-slim + dist + node_modules de prod).
- Healthcheck en `/api/health` (público, 200 cuando Firestore listCollections
  responde).
- Secretos inyectados vía Secret Manager → env vars (no commitees secretos
  en `cloudbuild.yaml`).
- Ver `RUNBOOK.md` §"Deploy to Cloud Run" para el workflow detallado.

### Capacitor (Android/iOS)
- `capacitor.config.ts` define el bundle id (`com.praeventio.guard`) y los
  permisos nativos.
- iOS build: ver `IOS_BUILD.md` (Xcode, signing, TestFlight).
- Android: `npm run cap:build:android` + Android Studio para firma final.

---

## 10. Testing strategy

- **Vitest** (jsdom) para frontend + servicios.
- **Supertest** para handlers HTTP (patrón consolidado en R15 I3,
  `src/__tests__/server/*.test.ts`).
- **`@firebase/rules-unit-testing`** para `firestore.rules` (suite en
  `src/__tests__/firestore.rules.*.test.ts`).
- **`__smoke__/`** — tests rápidos pre-merge (`npm run smoke`).

Total al cierre de R16: **866 tests**. La invariante de cada round es: la
suite no decrece sin justificación documentada en `IMPACTO.md` y aprobación
explícita.

---

## 11. Migración Vertex AI

Ver `VERTEX_MIGRATION.md`. Resumen: el SDK `@google/genai` apunta a Google
AI Studio en dev y a Vertex AI en prod (variable `GEMINI_BACKEND`). El
proxy `/api/gemini` es agnóstico al backend; el SDK abstrae la diferencia.
Beneficios de Vertex en prod: SLA, residencia de datos en us-central1, IAM
fino, audit trail GCP-native.

---

## 12. Migración Health Connect

Ver `HEALTH_CONNECT_MIGRATION.md`. `/api/fitness/sync` está marcado
`Sunset: 2026-12-31` (RFC 8594). Reemplazo: `src/services/health/` con
adapters `healthConnect.android.ts` y `healthKit.ios.ts` que leen on-device
(zero server hop). El cliente web pre-2026-12-31 sigue funcionando vía el
endpoint deprecated.

---

## 13. Roadmap inmediato (post-R16)

- **R17**: completar split de `server.ts` (rutas → `src/server/routes/`).
- **R18**: split de `geminiBackend.ts` (ver §5).
- **R19**: refactor de las 5 páginas > 700 LOC (AUDIT.md §5).
- **R20**: ESLint real (hoy `lint` es alias de `tsc --noEmit`).
- **R21**: i18n EN/PT-BR (LATAM expansion).

---

Para detalles operacionales, ver [`RUNBOOK.md`](./RUNBOOK.md). Para el
contrato de API, ver [`docs/api-routes.md`](./docs/api-routes.md). Para
políticas de seguridad, ver [`SECURITY.md`](./SECURITY.md) y
[`security_spec.md`](./security_spec.md).
