# TODO.md — Guardian Praeventio (Fuente Única de Verdad)

> **Filosofía:** "El riesgo se neutraliza en el diseño, no en la reacción." — El Guardián.
>
> **Regla #1 (inviolable):** este documento **NO marca ✅ sin evidencia file:line**. Cada claim de "hecho" debe ser verificable con `grep` o `Read` en el código real. Una app de prevención de riesgos NO puede permitirse falsa completeness — vidas dependen de que sepamos qué funciona de verdad.

**Última auditoría profunda:** 2026-05-15 — consolidación de 145+ docs internos + 5 agentes paralelos verificando claims contra código real + Codex reviews + PRs mergeados. Reemplaza a las versiones anteriores de TODO/ROADMAP/AUDIT/STATE/HONEST_STATE.

**Cobertura E2E real ponderada (recalibrada 2026-05-15):** ~70% (subió de 62% en 2026-05-05 tras Sprints 39-56 + Wave F + Codex sweep). **Meta Day-1 mundial:** 95%+.

---

## 📑 Índice

1. [Estado honesto por dominio](#1-estado-honesto-por-dominio)
2. [🔴 CRÍTICO inmediato — false completeness verificada](#2--crítico-inmediato--false-completeness-verificada)
3. [🟡 Codex review pendings sin mergear](#3--codex-review-pendings-sin-mergear)
4. [🟠 CI infrastructure rota en main](#4--ci-infrastructure-rota-en-main)
5. [⏸ Bloqueado por input usuario](#5--bloqueado-por-input-usuario)
6. [📋 Plan actual (orden de trabajo recomendado)](#6--plan-actual-orden-de-trabajo-recomendado)
7. [✅ Cerrado verificado (compacto)](#7--cerrado-verificado-compacto)
8. [🔮 Pendiente Day-1 — mobile + jurisdicciones + features](#8--pendiente-day-1)
9. [🗑 Descartado por directiva](#9--descartado-por-directiva)
10. [📚 Docs deprecated (no consultar)](#10--docs-deprecated-no-consultar)
11. [Convenciones para mantener este TODO vivo](#11-convenciones-para-mantener-este-todo-vivo)

---

## 1. Estado honesto por dominio

Cada dominio se mide:
- 🟢 **E2E** — flujo completo cableado, persistencia, tests, env vars usables en prod
- 🟡 **PARCIAL** — lógica existe pero falta wire crítico / secret / sensor / test
- 🔴 **SHELL** — UI sin backing real (o backing fingido)

| Dominio | % E2E | Tendencia desde 2026-05-05 | Notas |
|---|---|---|---|
| **Auth / RBAC** | 95% | — | WebAuthn cliente cierra envío de id/rawId (#264 + sweep) |
| **Multi-tenant rules** | 85% | ⬆️ +5pp | tenants/* matcher + cross-tenant tests |
| **Emergencia (SOS / Fall / Push)** | 92% | ⬆️ +2pp | FCM users/{uid}.fcmTokens migrado (#265 wave) |
| **Billing (Webpay / MP / IAP / Google Play)** | 88% | ⬆️ +3pp | Webhooks audit replay; **falta** MP IPN HMAC SHA-256 verify production wire |
| **AI / Gemini / Vertex (inferencia)** | 80% | ⬆️ +5pp | Adapter inferencia real; Trainer sigue STUB (NO descartar el bug) |
| **AI offline (SLM)** | 80% | ⬆️ +15pp | Phi-3 + Qwen SHA-256 reales; **Gemma SHA-256 null** todavía |
| **Compliance Chile (DS54/594/109/132 + Ley 16.744)** | 80% | ⬆️ +10pp | CPHS + DIAT/DIEP cerrados |
| **Compliance global (ISO 45001 + jurisdicciones)** | 45% | ⬆️ +20pp | 6 jurisdicciones nuevas (E.4); **falta** UK/CA/AU/JP/KR/IN wire UI |
| **i18n** | 91% | ⬆️ +46pp | 109/119 páginas con `useTranslation`; **quedan 10 páginas** |
| **Health Vault (ADR 0012)** | 85% | ⬆️ +5pp | Disclaimer + QR sharing |
| **CPHS Comité Paritario** | 80% | ⬆️ +30pp | Service + UI card (#265); falta endpoint admin |
| **DIAT/DIEP SUSESO** | 75% | ⬆️ +15pp | PDF real + folio + firma; **falta** WebAuthn ceremony real |
| **Mesh BLE/WiFi Direct** | 70% | ⬆️ +35pp | Plugin Android Kotlin **real (552 LOC)** + iOS Swift; falta consumer en src/ |
| **PWA / Offline / Sync** | 92% | ⬆️ +2pp | SW models cache + outbox engine (#245-246) |
| **Native plugins (HealthKit/HealthConnect)** | 40% | ⬆️ +10pp | Foundation; **bloqueado** por keystores |
| **Photogrammetry (COLMAP / Modal)** | 75% | ⬆️ +15pp | Worker Cloud Run real (325 LOC); falta deploy |
| **Digital Twin (3D mesh + AR)** | 80% | ⬆️ +15pp | InstancedMesh + Rapier + WebXR foundation (D.1+E.1) |
| **CQRS / Event Store** | 75% | ⬆️ +75pp | Real productivo (#261) — Event Store + aggregates + read model |
| **Bernoulli generators** | 50% | ⬆️ +5pp | Mayoría sin UI consumer; StructuralCalc va a logger.info, no Firestore |
| **Telemetry / Wearables** | 75% | ⬆️ +5pp | Telemetry.tsx real; WearablesPanel sigue UI-only |
| **Tests** | 70% | ⬆️ +20pp | 766 archivos; **8040 passing / 394 failing** (exit 0 silencia) |
| **Stryker mutation** | 72% global | — | Limiters todavía 3% por Windows crash |
| **Observability (Sentry + OTel)** | 90% | ⬆️ +5pp | Coverage sweep + CSP final (#249) |
| **Mobile build pipeline** | 50% | ⬆️ +20pp | Foreground Service C.2 + capacitor-proximity C.3; **falta** keystore prod |
| **CI/CD** | 75% | ⬇️ -15pp | **3 workflows rotos en main** (ver §4) |

**Promedio ponderado E2E: ~70%** (subió desde 62% el 2026-05-05 tras 56 PRs mergeados + Codex sweep).

---

## 2. 🔴 CRÍTICO inmediato — false completeness verificada

> **Estos items pretenden funcionar pero NO lo hacen.** Verificados con código en mano por agentes paralelos 2026-05-15. **Para una app de prevención de riesgos, esto es inaceptable** — empresas podrían tomar decisiones de vida basadas en datos fingidos.

### 2.1 🔴 MFA SMS bypass (P0 SEGURIDAD)
**Archivo:** `src/components/auth/MFASetupModal.tsx:34-63`

`handleSendCode` y `handleVerifyCode` solo hacen `setTimeout(..., 1500)` y retornan éxito sin enviar SMS real ni verificar código. **Cualquier código de 6 dígitos pasa la verificación MFA** — bypass total de la segunda factor. Solo el path biométrico (`handleBiometricSetup` con WebAuthn) hace algo real.

**Fix esperado:**
- Integrar Twilio Verify API o Firebase Auth Phone (bloqueado por credenciales Twilio — ver §5)
- Mientras tanto: **deshabilitar el path SMS** y forzar a usuarios a usar biometric/TOTP

### 2.2 🔴 AuditTrail.tsx fake (P0 COMPLIANCE)
**Archivo:** `src/pages/AuditTrail.tsx:12-24`

La "Caja Negra / Audit Trail" muestra 5 entradas hardcoded (`'Creación de matriz base para Proyecto Alpha'`, etc.) tras `setTimeout(..., 1500)`. **La página NO lee Firestore** aunque el backend (`src/server/routes/audit.ts`) sí existe y persiste eventos reales. Documenta-fake con consecuencias legales (ISO 45001 §10.2 audit trail).

**Fix:** Wire `useAuditLog()` hook a `GET /api/audit-log?projectId=...`.

### 2.3 🔴 EvacuationRoutes "A*" es interpolación lineal (P0 EMERGENCIA)
**Archivos:**
- `src/pages/EvacuationRoutes.tsx:129-143` — devuelve `simulatedPath` hardcoded
- `src/services/routingBackend.ts:37,46` — comentario literal: *"Basic interpolation (10 steps)"*

TODO.md previo decía `[x] Algoritmo A*`. Verificado: **no es A***. Para emergencias es crítico — rutas pre-calculadas no se adaptan a túneles bloqueados / pasillos con fuego reportado.

**Fix:** Implementar A* real sobre grilla discretizada de planos faena. O degradar honestamente: si no es A*, no decir A* en la UI/docs.

### 2.4 🔴 BunkerManager fake offline download
**Archivo:** `src/components/BunkerManager.tsx:25-52`

`downloadBunker` simula descarga BCN/3D Models con `setTimeout(500ms × 10)` y escribe objeto literal hardcoded a IndexedDB. **No descarga nada real** — el "bunker offline" se vende como protección para zonas sin señal pero el usuario opera con datos fijos legados.

**Fix:** Wire a `bcnService.ts` + asset registry real con fetch + hash verify.

### 2.5 🔴 NationalParksEmergency pronóstico fabricado
**Archivo:** `src/pages/NationalParksEmergency.tsx:43,51`

Pronóstico Día 2 y Día 3 con `weatherData.temp + (Math.random() * 4 - 2)`. **Decisiones de evacuación en parques con datos inventados.** El equipo ya corrigió el mismo patrón en `Calendar.tsx` (ver comentario línea 60) pero quedó vivo aquí.

**Fix:** Wire a `environmentBackend.ts:getForecast(days=3)` real (ya existe).

### 2.6 🔴 Cálculos Bernoulli van a `logger.info`, no a Firestore
**Archivos:**
- `src/components/engineering/StructuralCalculator.tsx:86-95`
- `src/components/engineering/HazmatStorageDesigner.tsx:76-78`

Comentario explícito: *"replace this console emission with addNode() into Firestore"*. **Cálculos de ingeniería estructural (uplift de andamios, distancia segura hazmat) se calculan correctamente pero NO se persisten** — el supervisor ve el número en pantalla pero el Zettelkasten/audit trail no lo registra.

**Fix:** Reemplazar `logger.info` con `addNode({type: 'engineering_calc', ...})`.

### 2.7 🔴 Vertex AI Trainer auto-stub (P1 documentación engañosa)
**Archivo:** `src/services/ml/vertexTrainer.ts:2,128-132`

Línea 2 dice literalmente: *"This module is a STUB intentionally"*. Línea 128 lanza `VertexTrainerError('NOT_ENABLED')` cuando `VERTEX_TRAINING_ENABLED=true`. PERO `HONEST_STATE.md:63` y `AUDIT_BACKLOG.md` dicen "✅ Vertex AI real" — eso se refiere al **adapter de inferencia** (`vertexAdapter.ts`, que SÍ es real), no al trainer.

**Fix:**
- **Opción A (recomendada):** declarar trainer DESCARTADO oficialmente — solo aplica a tier mega-enterprise, no es prioridad
- **Opción B:** implementar branch real `JobServiceClient.createCustomJob` de `@google-cloud/aiplatform`

### 2.8 🔴 assetlinks.json SHA-256 placeholder bloquea Play Store
**Archivo:** `public/.well-known/assetlinks.json:8`

`"sha256_cert_fingerprints": ["REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD"]`

Sin esto, **Android App Links no funcionan en Play Store**. Bloqueado por keystore real del usuario (§5).

### 2.9 🔴 SLM Gemma 2 2B SHA-256 null
**Archivo:** `src/services/slm/registry.ts:119`

`expectedSha256: null` — el modelo Gemma no tiene integrity check. Loader debe fail-closed en prod. Bloqueado por DevOps que descargue + compute SHA-256.

### 2.10 🔴 `tryAutoIssueDte` sin caller productivo
**Archivos:**
- `src/services/billing/invoice.ts:220-260` — función definida
- Solo se invoca en `src/server/routes/dte.ts` (admin route manual)

**Ningún webhook Webpay/MP/IAP la llama**. Las facturas pagadas no auto-emiten DTE. Confirma P1-3 del AUDIT_TRUTH_MATRIX.

**Fix:** Llamar `tryAutoIssueDte(invoice)` en los handlers `webpay/return`, `mercadoPagoIpn`, `mark-paid`.

### 2.11 🔴 Tests fallando silenciosamente
**Estado:** `npm test` → **8040 passing / 394 failing / 84 archivos failed** (exit code 0)

CI no falla por estos tests rotos. Algunos pueden ser flakiness, otros regresiones reales. Sin investigar.

**Fix:** Hacer `npm test -- --bail` para detectar regresiones; triage de los 394 failing por archivo.

---

## 3. 🟡 Codex review pendings sin mergear

> Codex ChatGPT hizo review automática en ~16 PRs mergeados últimos 14 días. La mayoría muestran "Codex usage limits reached" (sin contenido técnico). Solo **4 PRs** tuvieron hallazgos reales — **10 hallazgos totales** (2 P1 + 8 P2), **todos cubiertos por PRs #267 y #268 todavía abiertos**.

### PR #267 — Codex fixes de #263 #264 #266 (7 hallazgos)
- **P1** `firestoreRateLimitStore.ts:83` — keys con `/` (IPv6 CIDR) crean nested doc paths → IPv6 nunca se throttle
- **P1** `ERPIntegration.tsx:37` — frontend hardcodeaba `erpType: 'mock'` → override env producción
- **P2** `firestoreSessionStore.ts:127` — TTL como ISO string (Firestore TTL solo evalúa Timestamp)
- **P2** `firestoreRateLimitStore.ts:122` — mismo TTL bug
- **P2** `misc.ts:189` — failed sync attempts sin audit log
- **P2** `misc.ts:143` — legacy erpTypes (oracle/dynamics/odoo) caían al env adapter
- **P2** `zettelkastenStdioAdapter.ts:76` — `allowedTenantIds: new Set()` → MCP rechazaba todas las requests

### PR #268 — Codex fixes de #250 AI streaming (3 hallazgos)
- **P2** `AiResponseCard.tsx:150` — tier badge mislabels cuando streaming queda stale
- **P2** `useResilientAi.ts:120` — SLM adapter ignora `onStreamToken` (UI con caret vacío)
- **P2** `useResilientAi.ts:108` — late tokens del SLM zombie mutan streaming post-fallback

### Bonus en #267
- Fix TS narrowing en `KekRotationPanel.tsx:85` (PR #248 dejó 2 errores TS en main)

**Acción:** mergear #267 primero, luego #268 (rebase post-#267 si necesario).

---

## 4. 🟠 CI infrastructure rota en main

> 3 workflows fallan en main desde hace 7+ días. **No es regresión de PRs nuevos** — son fixtures/configs rotos que afectan a todos los PRs abiertos haciéndolos aparecer UNSTABLE.

| Workflow | Última falla | Frecuencia | Impacto |
|---|---|---|---|
| `Performance Budgets` | 2026-05-15 | 7+ corridas seguidas | Block visual de PRs |
| `Playwright full-stack (Express + Firestore emulator)` | 2026-05-15 | 8+ días | E2E gate desactivado en práctica |
| `Firestore rules tests` | 2026-05-15 | 5+ corridas | Sin gate de rules en CI |
| `Stryker mutation testing` (Linux) | 2026-05-15 | En PRs #267/#268 | Recurrente |

**Hipótesis investigar primero:**
- Performance Budgets: ¿Lighthouse CI saltando umbral por bundle size? `npm run size` debería decirlo
- Playwright full-stack: ¿fixture roto post-Sprint 36 hardening (`continue-on-error: false`)?
- Firestore rules: ¿emulator timing o regla con cobertura faltante?

**Acción:** Spawn task dedicado a estabilizar estos 3 workflows ANTES de mergear más features. Ver §6.

---

## 5. ⏸ Bloqueado por input usuario (no código)

Estos items no se pueden destrabar con código — requieren acción del usuario fuera del repo:

### Cuentas / suscripciones
- **Apple Developer Program** ($99/año) → bloquea iOS deploy + AASA Team ID real
- **Google Play Console keystore** (`*.jks` generado por usuario) → bloquea assetlinks SHA-256 + Play Store
- **Twilio account + número** → bloquea SMS Verify para MFA path (ver §2.1)

### Secrets a configurar en Cloud Run / Secret Manager
- `VITE_GOOGLE_MAPS_API_KEY` → 4 mapas + Site25DPanel
- `VITE_FIREBASE_VAPID_KEY` → FCM web push
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` → Calendar + Fit OAuth
- `IOT_WEBHOOK_SECRET` → Telemetry HMAC
- `MP_ACCESS_TOKEN` + `MP_IPN_SECRET` → MercadoPago producción
- `GOOGLE_PLAY_PACKAGE_NAME` + `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` + `GOOGLE_PLAY_RTDN_TOPIC` → Android billing
- `SENTRY_DSN` prod + rotar key del leak histórico
- `KMS_KEY_RESOURCE_NAME` + `KMS_ADAPTER=cloud-kms` → KEK source prod (sin esto, prod NO bootea por preflight)
- `SCHEDULER_SHARED_SECRET` → Cloud Scheduler gate del maintenance reaper
- `VERTEX_PROJECT_ID` + `VERTEX_LOCATION` → Vertex AI residencia Latam
- `Apple Root CA G3 PEM` (descarga oficial Apple) → SSN full-chain verify
- `DWG_CONVERTER_URL` + `DWG_CONVERTER_TOKEN` + `CAD_OUTPUT_BUCKET` → LibreDWG Cloud Run
- `PHOTOGRAMMETRY_WORKER_TOKEN` → COLMAP worker Cloud Run

### Documento / proceso externo
- Apple Root CA G3 PEM (oficial Apple)
- Acuerdos con mutuales (ACHS/IST/Mutual) para opcional auto-reporte DIAT (recordar: directiva usuario = no push automático, empresa cliente firma+entrega — esto sería **opcional** para clientes que lo soliciten)
- Traducciones humanas reales para fr/de/it/ja/zh-CN/ar/ko/hi (hoy son stubs ~40 keys cada uno; bloqueado por traductor profesional)

---

## 6. 📋 Plan actual (orden de trabajo recomendado)

> Decisión usuario: mergear pendientes primero, luego cerrar deuda crítica antes de seguir features.

### Sprint inmediato (esta semana)

1. **Mergear #267** (Codex fixes #263/#264/#266 — 2 P1 + 5 P2). Bloquea producto sin riesgos.
2. **Mergear #268** (Codex fixes #250 streaming — 3 P2). Rebase post-#267.
3. **Estabilizar 3 workflows de CI rotos** (§4) — task dedicada, no mezclar con features
4. **Mergear #260** después de rebase contra main (Resilience dashboard E2E wire)
5. **Mergear o cerrar #85** (TODO docs viejos — este TODO.md lo reemplaza)
6. **Podar 19 branches dev/sprint-*** viejas (ver `pr-codex-inventory` agent report)

### Sprint siguiente — false completeness sweep (§2)

Por orden de criticidad:
1. **Fix MFA SMS bypass** (§2.1) — deshabilitar SMS path hasta Twilio creds, forzar biometric/TOTP
2. **Wire AuditTrail.tsx** (§2.2) → `GET /api/audit-log` real
3. **Wire NationalParksEmergency** (§2.5) → `getForecast()` real
4. **Wire BunkerManager** (§2.4) → asset registry real
5. **Wire StructuralCalculator + HazmatStorageDesigner** (§2.6) → `addNode()` Firestore
6. **Honestar EvacuationRoutes "A*"** (§2.3) — implementar A* real O renombrar a "Ruta sugerida interpolada"
7. **Documentar Vertex Trainer como descartado** (§2.7) o implementar real
8. **Wire `tryAutoIssueDte`** (§2.10) en webhooks billing

### Sprint posterior — Day-1 readiness (mobile + global)

Bloqueado parcialmente por §5 (cuentas usuario). Pendiente:
- C.1 mobile signing real (cuando llegue keystore)
- 6 jurisdicciones nuevas (UK/CA/AU/JP/KR/IN) — code listo, falta wire UI
- 10 páginas restantes i18n sweep
- Demo project abierto sin login (Day-1)
- Traducciones humanas (cuando llegue traductor)

### Sprint vigente continuo

Mantener: tests verdes (resolver los 394 failing), CI workflow estable, no agregar nuevos fakes.

---

## 7. ✅ Cerrado verificado (compacto)

> Items con evidencia file:line. Por categoría — referencia rápida para no re-trabajar.

### Seguridad
- **KMS preflight fail-fast prod** — `src/server/kmsPreflight.ts:27-37` + `server.ts:157-166` (`process.exit(1)` si !ok)
- **WebAuthn cliente envía `id/rawId/type/clientExtensionResults`** — `src/hooks/useBiometricAuth.ts:184-192`
- **WebAuthn server verify** — `src/server/routes/curriculum.ts:763-849` (sin fallback consume-only en prod)
- **Hash chain forense (tamper-proof)** — PR #233
- **KEK rotation orchestrator + UI panel** — PRs #247 + #248 + #254
- **Firestore session store (Firestore-backed, multi-instance safe)** — PR #264, `src/server/sessionStore/firestoreSessionStore.ts`
- **Firestore rate limit store (multi-pod atomic via runTransaction)** — PR #264

### Billing
- **Webpay returnUrl + plan normalize** — `src/server/routes/billing.ts:560` + `src/services/pricing/subscriptionPlan.ts`
- **Apple SSN v2 webhook (JWS verify + idempotency)** — `src/server/routes/billing.ts:1763` (PR #232)
- **Google Play receipts validator (subscriptionsv2.get)** — `src/services/billing/googlePlayValidator.ts`
- **Apple App Store Server API validator** — `src/services/billing/appleTransactionValidator.ts`
- **MercadoPago x-signature HMAC SHA-256 validate** — `src/services/billing/mercadoPagoIpn.ts`
- **MercadoPago IPN mounted** — `server.ts:676` → `billing.ts:959` (rectifica claim P0 del TECHNICAL_DEBT_AUDIT)
- **ERP /sync honesto multi-modo** — PR #266, `src/services/erp/erpAdapter.ts` (reemplaza setTimeout fake)
- **Five premium fake pages → real** — PR #262: SecurityShield (MFA TOTP RFC 6238), ImmutableRender (Puppeteer), SusesoReports (DIAT firma), GoogleDriveIntegrationManager (OAuth real), SSOConfig (SAML/OIDC scaffold real)

### IA / SLM
- **Vertex AI adapter inferencia real** — `@google-cloud/vertexai 1.12` + `getAiAdapterFor({dataResidency, strict})`
- **SLM runtime ONNX + Web Worker + AbortSignal** — PRs #234, #239, #241
- **SLM Phi-3 SHA-256 real** — `src/services/slm/registry.ts:67`
- **SLM Qwen SHA-256 real** — `src/services/slm/registry.ts:75`
- **SLM encrypted offline queue** — PR #238
- **SLM in-app downloader UX** — PR #237
- **SLM auto-trigger reconciliation online/FCM** — PR #235
- **Resilient AI orchestrator 5-tier (SLM → ZK → Firestore → Gemini → canned)** — PRs #221-#229
- **Streaming SLM tokens UI** — PR #250 (con fix en PR #268 abierto)

### Mobile / IA local
- **BLE Mesh plugin Android Kotlin REAL (552 LOC GATT)** — `packages/capacitor-mesh/android/src/main/java/com/praeventio/mesh/MeshPlugin.kt`
- **BLE Mesh plugin iOS Swift CoreBluetooth** — PR #5503d50
- **Foreground Service Android (@capawesome)** — PR #0320389 (C.2)
- **capacitor-proximity sensor** — PR #784a9c3 (C.3)
- **SOS orchestrator + GPS breadcrumbs** — PR #a333c01 (C.5)
- **Mobile signing scripts + runbook + CI check** — PR #236 (config, no keystore real aún)

### Compliance
- **DIAT/DIEP PDF render real (pdfkit + folio atómico + WebAuthn signature)** — `src/services/suseso/diatPdfRenderer.ts`
- **CPHS module (DS 54 + ISO 45001 §5.4)** — `src/services/cphs/` + `src/components/cphs/CphsCommitteeStatusCard.tsx`
- **Job Safety Analysis (AST) + ISO 45001 hierarchy** — PR #259
- **Work permits validators (izaje/excavación/LOTO)** — PR #258 (36 tests)
- **Regulatory framework abstraction + 11 jurisdicciones** — ADR 0014 + `src/services/regulatory/jurisdictions/`
- **Privacy regimes 11+ países (GDPR/CCPA/CPRA/LGPD/Ley 19628/PIPEDA/APPI/PDPA/PIPL/152-FZ/PIPA-TW)** — `src/services/privacy/registry.ts`
- **EPP expiry job + checkExpiredPpe wired a maintenance reaper** — PR #28b3d9a

### Twin 3D + AR
- **InstancedMesh + LOD + Rapier physics (D.1)** — `src/components/twinScene/TwinSceneInstanced.tsx` + `TwinPhysicsScene.tsx`
- **Cargo stowage 3DBPP + COG (D.2)** — `src/services/cargo/stowageOptimizer.ts`
- **HVAC 1R1C thermal + CO2 + ventilation (D.3)** — `src/services/hvac/thermalModel.ts`
- **WebXR foundation + platform policy (E.1)** — PR #257
- **OSHA/ILO safety KPIs (D.10)** — `src/services/safetyMetrics/osha.ts`

### Zettelkasten + persistence
- **MCP Zettelkasten read-only stdio (D.11)** — `src/services/mcp/zettelkastenStdioAdapter.ts`
- **ZK canonical materializer (D.8.c)** — PR #435bca9
- **Site Book CRDT layer (multi-supervisor concurrent edits)** — PRs #251, #256
- **Generic offline outbox engine + encrypted adapter** — PRs #245, #246
- **CQRS Event Store + Incident aggregate + read model** — PR #261 (51 tests)

### Wire UI cards (Sprint K/L sin UI antes)
- **CphsCommitteeStatusCard + LeadershipTrailCard + EngineeringInventoryCard + MonthlyClientReportPanel + PrivacyDsarPanel** — PR #265

### CI / Observability
- **e2e workflow `continue-on-error: false`** — `.github/workflows/e2e.yml:90`
- **Sentry coverage server + CSP final + i18n sweep (D.13.a/b/c)** — PRs #116d42e, #891802d, #49beca3
- **Lint script honesto (real ESLint sobre firestore.rules)** — PR #264
- **Resilience health alert cron + FCM** — PR #249

---

## 8. 🔮 Pendiente Day-1

### Mobile pipeline
- **Android signing real** — `*.jks` keystore + `signingConfigs` en `android/app/build.gradle` (bloqueado por §5)
- **iOS provisioning + APNS p8** — bloqueado por Apple Developer Program (§5)
- **HealthConnect Android plugin nativo real** — foundation hecha; falta dance fuera de Telemetry.tsx
- **HealthKit iOS plugin nativo real** — idem
- **Apple Pay / Google Play Billing UI nativa Capacitor** — webhooks server listos; falta plugin frontend

### Compliance global expansion
- **Wire UI citation snippets** para los 6 nuevos jurisdiction packs (UK/CA/AU/JP/KR/IN) — code en `src/services/regulatory/jurisdictions/` listo, falta UI
- **Tier "Global" en pricing** — multi-jurisdicción simultáneo (Sprint posterior)
- **Per-country emission adapters** (doc-only, no push) — solo Chile cerrado; pendiente: US OSHA, UK RIDDOR, EU OSHA + Delt@/INAIL, MX NOM-019, BR NR-5, AU WHS, CN GB/T 33000, RU 152-FZ

### i18n
- **10 páginas restantes sin `useTranslation`** — verificar cuáles con `grep -L useTranslation src/pages/*.tsx` y wirearlas
- **Traducciones humanas** fr/de/it/ja/zh-CN/ar/ko/hi (hoy stubs ~40 keys) — bloqueado §5

### Roadmap features pendientes (Sprint 29-32 candidato)
- **F-A CalculatorHub** — 12 generadores Bernoulli sin UI consumer (gas dispersion, confined-space HVAC, respirator fatigue, pulmonary altitude, slope stability, dike hydrostatic, gas leak, misting dust, micro-wind, SLAM photogrammetry, hidrante fire network, scaffold wind suction)
- **F-B RAG NL sobre incidentes históricos del tenant**
- **F-D Gamification × salud** (días sin incidentes, awards) — sin tocar matriz IPER (directiva)
- **F-E Predictive Alerts × Calendar** — pre-warnings tareas críticas wind/seismic
- **F-F WebAuthn UI Settings** — backend completo, falta UI registro/listing credenciales

### Productos pendientes (mencionados sin implementar)

1. **MQTT IoT Broker productivo** — adapter existe (`src/services/iot/mqttAdapter.ts`); el cloud-iot/emqx están detrás de `IOT_BROKER_ADAPTER=cloud|emqx` env (default InMemory). Faltan: jerarquía de tópicos formal, X.509 device cert flow, heartbeat, WSS frontend, payload binario
2. **WebXR `immersive-ar` end-to-end Android** — foundation existe; falta wire ARCore real + hit-test stability
3. **ARKit Quick Look fallback iOS** (`.usdz`) — sin implementar (Sprint posterior)
4. **Object lifecycle Calendar wire** — `useObjectLifecycle` hook que dispare CalendarEventSpec a Google Calendar cuando un PlacedObject pasa a `installed`
5. **Geo-anchored ZK retrieval** — `useGeoAnchoredNodes(projectId, lat, lng, radiusM)` con Haversine
6. **Digital Twin Faena backend COLMAP deployado** — worker existe (`cloud-run/photogrammetry-worker/`), falta deploy real
7. **CSV ETL universal con import wizard** — Sprint 24 base; falta hub + detección automática schema
8. **Onboarding wizard step-by-step UI** — endpoint backend listo
9. **Coach IA por dominio** — hoy es un Asesor único; especializar por módulo (medicina/ergonomía/SST)
10. **DS 67/76 reports PDF** — similar a DIAT/DIEP; pendiente
11. **CLI + migration registry + SLO dashboard**
12. **Twin triple-gate auth wire global** (ADR 0011) — hoy solo Site25DPanel y DigitalTwinFaena
13. **AnatomyLibrary + DifferentialDiagnosis + DrugInteractions** — bundle OpenMedicalData CC0 + DrugBank + HCPCS
14. **VitalityMonitor backend** — wire a healthFacade native plugins
15. **MediaPipe Pose en AIPostureAnalysisModal** — hoy usa Gemini-vision; debería usar MediaPipe local (deps disponibles)
16. **MorningRoutine slot persistencia** — UI existe, falta persistir respuestas
17. **DynamicEvacuationMap / Coastal / Volcanic Maps con keys reales** — placeholder Maps key

### Tests pending (H33)
- ~184 componentes sin test cubiertos; triage por criticidad (priorizar emergency + billing + compliance + medical)
- Modales workers/medicine (AddWorkerModal, EditWorkerModal, MassImportModal, AccessControlModal, TraceabilityModal, QRCodeModal, LaborManagementModal, DocsModal, AddMedicineModal, AptitudeCertificateForm, VigilanciaScheduler, AIPostureAnalysisModal, AddErgonomicsModal, AddPsychosocialModal, AddHygieneModal)
- EmergencyOverlay sin test (`src/components/shared/EmergencyOverlay.tsx`)
- 394 tests existentes fallando — triage por dominio

### P2/P3 audit backlog restante
- **H1** Doc DWG desfasada
- **H3** Stripe pre-flight messaging (Stripe **descartado** por usuario; eliminar referencias del doc en lugar de "pre-flight")
- **H5** SII pre-flight messaging (3 adapters stub: LibreDTE, OpenFactura, SimpleAPI)
- **H19** KnowledgeGraph `as any` x18 cleanup
- **H22** KnowledgeGraph virtualización + Web Worker (>1k nodos)
- **H23** backgroundTriggers concurrency (Promise.all concurrency 10)
- **H24** Code splitting eager (KG, Site25D, PortableCurriculum a React.lazy)
- **H27** Geofence permission UX surface (toast cuando navegador deniega)
- **H30** verificar `/processing-activities` no fugue por tenantId
- **H31** Stryker en CI Linux ratchet (crash Windows bloquea)
- **H32** Seeds determinísticos en 8 archivos test

---

## 9. 🗑 Descartado por directiva

> Items que **NO** se van a implementar. Si aparecen en docs viejos, ignorar.

| Item | Razón |
|---|---|
| **Vertex AI Agent SDK como runtime productivo** | Runtime productivo en Gemini + Vertex AI Agent Builder (no SDK). Claude Code solo desarrollo. |
| **Vertex AI Trainer custom** | Solo aplica tier mega-enterprise; no es prioridad. Adapter inferencia sí real. Ver §2.7 — decidir si mantener stub o documentar oficial. |
| **Stripe** | Reemplazado por Transbank/Webpay + MercadoPago + Google Play Billing + Khipu. |
| **Cripto / Tokens / `useBinanceIntegration.ts`** | Pausado/descartado por el usuario. |
| **Gamificación ↔ Probabilidad de Riesgo** | Por principios de seguridad y responsabilidad legal, gamificación NUNCA altera matriz IPER. Solo recomendar. |
| **Push automático a APIs SUSESO/SII/MINSAL/OSHA/RIDDOR/NOM/NR/MEM/Rostrud** | Directiva 3 usuario: generamos documento, empresa cliente firma+entrega manualmente. Adapters quedan **doc-only**. |
| **Generación dinámica de rutas A* por LLM** | Reemplazada por A* determinista (mejor decisión legal) — aunque ahora código es interpolación, ver §2.3. |
| **Scraping público SUSESO accidentabilidad** | Reemplazado por cálculo interno (Dashboard Cumplimiento SUSESO). |
| **Bloqueo de maquinaria** | Directiva 2 usuario: NUNCA bloquear maquinaria, solo recomendar científicamente. |
| **ODA File Converter binary** | License comercial — pivotamos a LibreDWG Cloud Run (proxy real existe). |
| **Fatiga Humana → reasignar tareas automáticamente** | Solo notificar al supervisor (directiva: no bloquear, no decidir por humano). |

---

## 10. 📚 Docs deprecated (no consultar)

> Estos docs tienen claims optimistas/incorrectos. **Este TODO.md los supersede.** No actualizar — solo usar como referencia histórica.

- `STATE_OF_FUNCTIONALITY_2026-05-04.md` — reportaba 99% E2E (era 62%, hoy ~70%)
- `INFORME_AVANCE_NOTEBOOK_LLM.md` — reporta 81.29%/77.33% (auto-generado, no auditado)
- `INFORME_ESTADO_2026-04-29.md` — anterior al audit profundo
- `ROADMAP.md` + `ROADMAP_2026-05.md` + `PLAN_PARTE1/2/3/4_*.md` — fases ya cerradas (Sprint 27-56); items aún listados ahí ya están en §7 verificados
- `MASTER_PROPOSAL_2026-05.md` — proposal histórica
- `TECHNICAL_DEBT_AUDIT.md` (2026-05-07) — 2 items fueron rectificados por `AUDIT_TRUTH_MATRIX_2026-05-07.md` (WebAuthn endpoints SÍ existen; MercadoPago IPN SÍ montado). El resto del doc sigue válido como mapa histórico.

**Docs vivos y autoritativos (consultar):**
- ✅ **Este `TODO.md`** — fuente única de verdad
- ✅ `docs/audits/PRAEVENTIO_HONEST_STATE_2026-05-05.md` — % por dominio (algo desactualizado pero útil)
- ✅ `docs/audits/AUDIT_BACKLOG.md` — backlog vivo por hallazgo (H##)
- ✅ `docs/audits/AUDIT_TRUTH_MATRIX_2026-05-07.md` — matriz de claims rectificados
- ✅ `docs/audits/AUDIT_CODEX_2026-05-07.md` — Codex P0/P1/P2 (verificar contra commits recientes)
- ✅ Architecture Decision Records `docs/architecture-decisions/0001-0017` — decisiones inmutables
- ✅ Runbooks `docs/runbooks/` — operacionales

---

## 11. Convenciones para mantener este TODO vivo

1. **Cada PR mergeado actualiza esta sección**:
   - Si cierra hallazgo §2 → mover a §7 con file:line
   - Si cierra item §8 → mover a §7
   - Si descubre nuevo fake → agregar a §2 con evidencia file:line
   - Si Codex deja hallazgo nuevo → agregar a §3

2. **NUNCA marcar ✅ sin evidencia file:line.** Una app de prevención no permite falsa completeness.

3. **Cada PR body debe referenciar este doc**:
   - `Cierra: §2.X` (false completeness) o
   - `Cierra hallazgo: H##` (audit backlog) o
   - `Implementa: F-X` (roadmap feature)

4. **Cuando un dominio en §1 cambie ≥5pp** en cobertura E2E → agregar nota en commit message + actualizar tabla.

5. **Revisión mínima:** cada 2 semanas, agente parallel scan para detectar drift entre docs y código.

6. **Métrica honesta de éxito:** cuando el promedio ponderado §1 llegue ≥95% → abrir issue "Day-1 readiness checklist" cruzando este TODO + §5 secrets + §5 cuentas + verificación pentest externa.

---

**Próxima revisión profunda:** post-merge de #267 + #268 + cleanup §2 (estimada 2026-05-22).
