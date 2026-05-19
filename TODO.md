# TODO.md — Guardian Praeventio (Fuente Única de Verdad)

> **Filosofía:** "El riesgo se neutraliza en el diseño, no en la reacción." — El Guardián.
>
> **Regla #1 (inviolable):** este documento **NO marca ✅ sin evidencia file:line**. Cada claim de "hecho" debe ser verificable con `grep` o `Read` en el código real. Una app de prevención de riesgos NO puede permitirse falsa completeness — vidas dependen de que sepamos qué funciona de verdad.
>
> **Regla #2 (decisión usuario 2026-05-15):** "honesto" = **funciona REAL**. Si un feature no funciona, primero intentamos producirlo. Solo removemos cuando el usuario lo pide explícitamente (ej: SMS).
>
> **Regla #3 (decisión usuario 2026-05-15):** **la respuesta default es PRODUCIR la solución, no etiquetarla ni sacarla.** Si una dependencia externa falla (API key, servicio caído), construimos un fallback REAL (climatología determinística, scratch local, modelo físico) — no un banner "no disponible" ni un grid que colapsa. El usuario nunca debe percibir que algo "está roto" o "pendiente"; debe sentir que la app funciona, porque funciona.

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

### 2.1 ✅ MFA: SMS REMOVIDO completamente (cierre 2026-05-15)
**Archivo:** `src/components/auth/MFASetupModal.tsx` (reescrito 100%)

**Estado anterior:** modal ofrecía 3 métodos pero el SMS path simulaba éxito con `setTimeout(1500)` y aceptaba cualquier código de 6 dígitos → bypass MFA total.

**Decisión usuario 2026-05-15:** "sms no quiero, tampoco llamadas". Aplicando Regla #2 (funciona REAL o no existe):

- **REMOVIDOS del componente:** estados `phoneNumber`, `verificationCode`, `step: 'phone'`, `step: 'verify'`, handlers `handleSendCode`, `handleVerifyCode`, props `Smartphone`/`KeyRound` para SMS, todo el flujo de teléfono
- **Métodos disponibles** (ambos REALES, ambos verificables):
  - 🟢 **Biometría / Passkey (WebAuthn)** — `handleBiometricSetup` con `useBiometricAuth.register()` — verificación CBOR server-side
  - 🟢 **TOTP (Google Authenticator, Authy, 1Password)** — botón redirige a `/security-shield` donde RFC 6238 está implementado real con `@noble/hashes`
- El intro screen explícitamente dice: *"Cero SMS, cero llamadas — métodos verificados criptográficamente."*

### 2.2 ✅ AuditTrail.tsx wireado a backend real (cierre 2026-05-15)
**Archivos:**
- `src/pages/AuditTrail.tsx:11-115` (wire al fetch real)
- `src/server/routes/audit.ts:98-181` (endpoint nuevo `GET /api/audit-log`)

**Estado anterior:** mostraba 5 entradas hardcoded tras `setTimeout(1500)`, NO leía Firestore.

**Fix aplicado:** nuevo endpoint `GET /api/audit-log` con:
- Auth via `verifyAuth`
- Filtros: `?projectId=X` (con membership check via `assertProjectMember`), `?module=NAME`, `?since=ISO`, `?limit=N` (max 100)
- Sin projectId → solo logs del propio usuario (no expone trail de otros)
- Devuelve entries con timestamp ISO + módulo + detalles + IP

Frontend ahora:
- Fetcha al endpoint con Bearer token del usuario
- Filtra por `selectedProject?.id` automáticamente
- Búsqueda local (cliente) sobre los entries cargados
- Estados visibles: loading / error / empty / data (con `data-testid` para tests)
- Sin `setTimeout` fake delay — UX espera el response real

### 2.3 ✅ EvacuationRoutes A* REAL implementado (cierre 2026-05-15)
**Archivos:**
- `src/services/routing/gridAStar.ts` (NEW, 217 LOC — A* real con MinHeap + Manhattan/Octile heuristic)
- `src/services/routing/gridAStar.test.ts` (NEW, 10 tests — incluye unreachable returns null, no fake path)
- `src/pages/EvacuationRoutes.tsx:129-150` (wire al findPathAStar real)

**Estado anterior:** `simulatedPath` hardcoded tras `setTimeout(2000)`. UI decía "Algoritmo A* sobre Grillas Dinámicas" → mentira.

**Fix aplicado:** algoritmo A* real con:
- MinHeap (priority queue) ordenado por fScore — O(log n) operaciones
- Heurística Manhattan (4-conexa) o Octile (8-conexa) — admisibles → garantiza shortest path
- Anti-corner-cutting con diagonales (más seguro para evacuación)
- Devuelve `null` si destino inalcanzable — NO fake path
- Determinístico (mismos inputs → mismo path)

EvacuationRoutes ahora:
- Llama `findPathAStar(grid, start, goal)` con la grilla 10×10 + obstáculos reales del state
- Si A* devuelve null → log warning + estado `routeCalculated: false` (UI muestra error honesto, no path inexistente)
- Subtitle UI actualizado: `"Algoritmo A* sobre grilla 10×10 (real, determinístico, heurística Manhattan)"`

### 2.4 ✅ BunkerManager REAL — descarga leyes BCN íntegras (cierre 2026-05-15)
**Archivos:**
- `src/components/BunkerManager.tsx:25-72` (fetch real, no setTimeout)
- `src/server/routes/bcn.ts` (NEW — endpoint `/api/bcn/snapshot`)
- `server.ts` mounted en `/api/bcn`

**Estado anterior:** simulaba descarga con `setTimeout(500ms × 10)` y persistía objeto literal hardcoded (`laws: ['Ley 16.744',...]`) como si fuera BCN.

**Fix REAL aplicado** (Regla #2: funciona o no existe — implementamos para que funcione):
- `bcn.ts:33-86` fetcha las **8 leyes críticas REALES** desde la Biblioteca del Congreso Nacional vía `bcnService.fetchLawFromBCN()`:
  - Ley 16.744, DS 594, DS 44/2024, DS 132 (Minería), DS 76 (Contratistas), Ley 20.123, DS 43 (Sustancias Peligrosas), Ley 21.156 (DEA)
- Cada ley devuelve `{ idNorma, titulo, fechaPublicacion, organismo, texto }` con el TEXTO ÍNTEGRO de la norma chilena
- Cache server-side 1h evita hammering al servidor BCN (que es lento)
- Si BCN está caído upstream Y no hay cache → 502 honesto. Si BCN parcialmente caído → devuelve las leyes que SÍ pudo descargar
- Frontend persiste el snapshot REAL en IndexedDB con metadata: `lawsCount`, `totalSizeBytes`, `source: 'bcn-api'`
- UI de error solo cuando hay falla de red/BCN real, con botón "Reintentar descarga" — NO mensaje de "endpoint pendiente"

### 2.5 ✅ NationalParksEmergency REAL — predicción con fallback climatológico (cierre 2026-05-15)
**Archivos:**
- `src/pages/NationalParksEmergency.tsx` (wire dual-source)
- `src/services/environment/chileClimatology.ts` (NEW, 16 tests — Regla #3)

**Estado anterior:** pronóstico Día 2/3 con `weatherData.temp + (Math.random()*4-2)`.

**Fix Regla #3 aplicado** (construir, no etiquetar ni sacar):
- **Source 1 (preferido):** `GET /api/environment/forecast?days=3` que wrappea OpenWeather 5-day API. Si responde con datos → usar predicción real.
- **Source 2 (fallback REAL):** climatología chilena DMC 1981-2010 — promedios mensuales 30-año por 7 zonas climáticas (norte_arido, norte_chico, central, sur, austral, altiplano, isla_pascua). Determinístico, mismo input → mismo output, sin Math.random.
- El forecast SIEMPRE tiene 3 días, NUNCA hay grid colapsado ni banner "no disponible". Solo un badge sutil arriba indica la procedencia (`OpenWeather` verde · `DMC 1981-2010` azul) para que el usuario sepa qué tipo de pronóstico está viendo.
- `riskForDay()` deriva risk level de datos REALES (`windKmh`, `tempMinC`, `precipMm`), funciona idénticamente con OpenWeather o climatología.

### 2.6 ✅ Cálculos Bernoulli SIEMPRE persisten (scratch local + auto-promote) (cierre 2026-05-15)
**Archivos:**
- `src/services/engineering/scratchCalculations.ts` (NEW, 10 tests — Regla #3)
- `src/components/engineering/StructuralCalculator.tsx:97-114` (wire scratch fallback)
- `src/components/engineering/HazmatStorageDesigner.tsx:99-118` (wire scratch fallback)
- `src/contexts/ProjectContext.tsx:120-141` (auto-promote al seleccionar proyecto)

**Estado anterior (Codex feedback):** los cálculos persistían SOLO cuando había proyecto seleccionado; sin proyecto eran silently dropped (solo `logger.info`).

**Fix Regla #3 aplicado** (construir, no agregar UI feedback de error):
- Nuevo módulo `scratchCalculations.ts` con storage IndexedDB:
  - `saveScratchCalculation(node, userUid)` — persiste idempotentemente (hash determinístico del payload canonicalizado evita duplicados)
  - `listScratchCalculations(userUid)` — lista los pendientes del user
  - `promoteAllScratchToProject(userUid, projectId)` — promueve todo al proyecto
  - Namespacing por uid: user A no ve scratch de user B; anonymous bucket separado
- StructuralCalculator + HazmatStorageDesigner: si `selectedProject?.id` existe → Firestore via `writeNodesDebounced`; si no → `saveScratchCalculation()` local
- ProjectContext: `useEffect` que detecta selección de proyecto + auto-promueve todos los scratch pendientes vía `writeNodesDebounced`
- Resultado: cálculo NUNCA se pierde. Sin UI de error. Funciona idénticamente con o sin proyecto.

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

### 2.10 ✅ `tryAutoIssueDte` wireado en webpay/return + mercadoPagoIpn (cierre 2026-05-15)
**Archivos:**
- `src/server/routes/billing.ts:1290-1372` (webpay/return)
- `src/server/routes/billing.ts:1063-1146` (mercadoPagoIpn handler)

**Estado anterior:** ambos handlers hacían `decideDteIssue()` (función pura que decide si emitir) pero NUNCA llamaban `tryAutoIssueDte()` que es quien efectivamente ejecuta la emisión vía Bsale.

**Fix aplicado:** ahora si `decision.shouldIssue === true`:
- Lazy-import `tryAutoIssueDte` (no contamina cold-start de otros endpoints)
- Llama con el `invoiceData` re-hidratado a status `paid`
- Loggea result: `ok`, `skipped`, `folio`, `errorMessage`
- Try-catch interno → si Bsale falla NO bloquea el redirect/ack del IPN

**Safety:** `tryAutoIssueDte` ya respeta `DTE_AUTO_ISSUE` env var (default `false`). En producción esto queda OFF hasta que infra setee la env, momento en que empieza a emitir DTEs automáticamente para suscripciones pagadas. Mientras está OFF, devuelve `skipped: 'disabled'` sin tocar Bsale.

### 2.11 🔴 Tests fallando silenciosamente
**Estado:** `npm test` → **8040 passing / 394 failing / 84 archivos failed** (exit code 0)

CI no falla por estos tests rotos. Algunos pueden ser flakiness, otros regresiones reales. Sin investigar.

**Fix:** Hacer `npm test -- --bail` para detectar regresiones; triage de los 394 failing por archivo.

---

## 3. 🟡 Codex review pendings sin mergear

> Codex ChatGPT hizo review automática en ~16 PRs mergeados últimos 14 días. La mayoría muestran "Codex usage limits reached" (sin contenido técnico). Solo **4 PRs** tuvieron hallazgos reales — **10 hallazgos totales** (2 P1 + 8 P2), cubiertos por PRs #267 + #268. **+ 7 hallazgos nuevos de Codex** en PRs #267/#268/#269, atendidos en este PR.

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

### ✅ Codex fixes de #267/#268/#269 atendidos en este PR (2026-05-15)
- **P2** `misc.ts:145` — legacy ERP rejection bloqueaba 501 si Firestore audit fallaba → ahora dentro de try + helper `logAttempt()` fail-soft
- **P2** `useResilientAi.ts:123` — safety timeout window NO se ajustaba a emergencyMode (3000ms vs 8000ms × 1.1) → ahora deriva del default del modo seleccionado
- **P2** `zettelkastenStdioAdapter.ts:92` — MCP envelope double-wrap → ahora passthrough del `content[]` que devuelve `handleMcpRequest`
- **P2** `TODO.md:116` — §2.6 falsamente decía que Bernoulli no persiste; SÍ persiste via `writeNodesDebounced` con projectId → rectificado a 🟡 partial (solo falta UI feedback cuando no hay proyecto)
- **P2** `TODO.md:277` — §7 violaba la Regla #1 (PR# sin file:line) → expandido a `src/services/...` real para cada item
- **P2** `TODO.md:293` — MercadoPago HMAC marcado closed cuando formato productivo `ts=..,v1=..` sigue diferido → calificado con nota explícita
- **P2** `TODO.md:318` — DIAT WebAuthn signature marcado closed cuando ceremony end-to-end falta → calificado con nota explícita

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

> **Regla #1 aplicada (Codex feedback 2026-05-15):** cada item DEBE citar file:line o ADR. Los items que solo citaban PR# fueron expandidos. Los items con dudas se marcan 🟡 PARTIAL en lugar de ✅.

### Seguridad
- **KMS preflight fail-fast prod** — `src/server/kmsPreflight.ts:27-37` + `server.ts:157-166` (`process.exit(1)` si !ok)
- **WebAuthn cliente envía `id/rawId/type/clientExtensionResults`** — `src/hooks/useBiometricAuth.ts:184-192`
- **WebAuthn server verify** — `src/server/routes/curriculum.ts:763-849` (sin fallback consume-only en prod)
- **Hash chain forense (tamper-proof audit)** — `src/services/audit/tamperProofChain.ts`
- **KEK rotation orchestrator** — `src/services/security/kekRotationOrchestrator.ts`
- **KEK rotation UI panel** — `src/components/security/KekRotationPanel.tsx` + montado en `src/pages/Settings.tsx`
- **Firestore session store (Firestore-backed, multi-instance safe)** — `src/server/sessionStore/firestoreSessionStore.ts` + wired `server.ts:455`
- **Firestore rate limit store (multi-pod atomic via runTransaction)** — `src/server/rateLimit/firestoreRateLimitStore.ts` + wired `server.ts:404`

### Billing
- **Webpay returnUrl + plan normalize** — `src/server/routes/billing.ts:560` + `src/services/pricing/subscriptionPlan.ts`
- **Apple SSN v2 webhook (JWS verify + idempotency)** — `src/server/routes/billing.ts:1763`
- **Google Play receipts validator (subscriptionsv2.get)** — `src/services/billing/googlePlayValidator.ts`
- **Apple App Store Server API validator** — `src/services/billing/appleTransactionValidator.ts`
- **MercadoPago IPN mounted** — `server.ts:676` → `src/server/routes/billing.ts:959` (rectifica claim P0 del TECHNICAL_DEBT_AUDIT)
- **ERP /sync honesto multi-modo** — `src/services/erp/erpAdapter.ts` (reemplaza setTimeout fake)
- **Premium fake pages → real (5)** — `src/pages/SecurityShield.tsx` + `src/pages/ImmutableRender.tsx` + `src/pages/SusesoReports.tsx` + `src/pages/GoogleDriveIntegrationManager.tsx` + `src/pages/SSOConfig.tsx`

> ✅ **MercadoPago HMAC formato productivo cerrado 2026-05-15** (Regla #3): `src/services/billing/mercadoPagoIpn.ts:160-310` implementa el manifest productivo `id:<dataId>;request-id:<rid>;ts:<ts>;` con HMAC-SHA256 y replay-protection 5 min. Helper `verifyMpIpnAnyFormat()` detecta auto el formato (legacy `sha256=` vs prod `ts=,v1=`) y wirea en `billing.ts:1006-1046`. 20 tests cubriendo válido/inválido/replay/wrong-secret/header malformado.

### IA / SLM
- **Vertex AI adapter inferencia real** — `src/services/ai/vertexAdapter.ts` (`@google-cloud/vertexai 1.12`)
- **SLM runtime ONNX + Web Worker** — `src/services/slm/slmRuntime.ts` + `src/services/slm/worker/slmRuntimeWorkerCore.ts`
- **SLM `inferStream` con AbortSignal + onToken** — `src/services/slm/slmRuntime.ts:230-548`
- **SLM Phi-3 SHA-256 real** — `src/services/slm/registry.ts:67`
- **SLM Qwen SHA-256 real** — `src/services/slm/registry.ts:75`
- **SLM encrypted offline queue** — `src/services/slm/encryptedOfflineQueue.ts`
- **SLM in-app downloader UX** — `src/components/slm/SlmManagerScreen.tsx`
- **Resilient AI orchestrator 5-tier** — `src/services/ai/resilientAiOrchestrator.ts:355-396` (SLM → ZK → Firestore → Gemini → canned)
- **Streaming SLM tokens UI** — `src/components/ai/AiResponseCard.tsx` + `src/hooks/useResilientAi.ts` (con fixes Codex en este PR)

### Mobile / IA local
- **BLE Mesh plugin Android Kotlin REAL (552 LOC GATT)** — `packages/capacitor-mesh/android/src/main/java/com/praeventio/mesh/MeshPlugin.kt`
- **BLE Mesh plugin iOS Swift CoreBluetooth** — `packages/capacitor-mesh/ios/Plugin/Plugin.swift`
- **Foreground Service Android (@capawesome)** — `src/services/foregroundService/guardianForegroundService.ts`
- **capacitor-proximity sensor** — `src/services/proximitySensor/proximityModeDetector.ts`
- **SOS orchestrator + GPS breadcrumbs** — `src/services/emergency/sosOrchestrator.ts` + `src/services/emergency/gpsBreadcrumbTracker.ts` + `src/services/emergency/emergencyNumbers.ts`
- **Mobile signing scripts + runbook + CI check** — `scripts/mobile-signing/` + `docs/runbooks/MOBILE_SIGNING.md` + `.github/workflows/mobile-signing-check.yml`

### Compliance
- **DIAT/DIEP PDF render (pdfkit + folio atómico)** — `src/services/suseso/diatPdfRenderer.ts` + `src/services/suseso/folioGenerator.ts`
- **CPHS service (DS 54 + ISO 45001 §5.4)** — `src/services/cphs/cphsService.ts` + `src/services/cphs/types.ts`
- **CPHS UI status card** — `src/components/cphs/CphsCommitteeStatusCard.tsx`
- **Job Safety Analysis (AST) + ISO 45001 hierarchy** — `src/services/jsa/jobSafetyAnalysis.ts`
- **Work permits validators (izaje/excavación/LOTO)** — `src/services/workPermits/criticalPermitValidators.ts` + `liftingPermitExtension.ts` + `excavationPermitExtension.ts`
- **Regulatory framework abstraction + 11 jurisdicciones** — ADR 0014 (`docs/architecture-decisions/0014-regulatory-framework-abstraction.md`) + `src/services/regulatory/jurisdictions/`
- **Privacy regimes 11+ países** — `src/services/privacy/registry.ts` (GDPR/CCPA/CPRA/LGPD/Ley 19628/PIPEDA/APPI/PDPA/PIPL/152-FZ/PIPA-TW)
- **EPP expiry job + checkExpiredPpe wired** — `src/server/jobs/checkExpiredPpe.ts` mounted via `src/server/routes/maintenance.ts`

> ✅ **DIAT WebAuthn ceremony cerrada end-to-end 2026-05-15** (Regla #3):
> - NUEVO `src/server/auth/webauthnAssertion.ts` (verificador reusable de assertion: challenge consume + credential lookup + crypto verify + counter monotonicity)
> - SUSESO sign endpoint (`src/server/routes/suseso.ts:171-262`) ahora ejecuta la ceremonia cuando `algorithm === 'webauthn-ecdsa-p256'` — campo `webauthnAssertion` obligatorio, verificado contra public key registrada antes de persistir
> - NUEVO endpoint `GET /api/suseso/form/:id/sign-challenge` para issuar challenge
> - 9 tests de capa 0 (shape validation); capas más profundas cubiertas por integration test existente en `__tests__/server/webauthnVerify.test.ts`

### Twin 3D + AR
- **InstancedMesh + LOD + Rapier physics (D.1)** — `src/components/twinScene/TwinSceneInstanced.tsx` + `src/components/twinScene/TwinPhysicsScene.tsx`
- **Cargo stowage 3DBPP + COG (D.2)** — `src/services/cargo/stowageOptimizer.ts`
- **HVAC 1R1C thermal + CO2 + ventilation (D.3)** — `src/services/hvac/thermalModel.ts`
- **WebXR foundation + platform policy (E.1)** — `src/services/ar/webxrCapabilities.ts` + `src/components/ar/`
- **OSHA/ILO safety KPIs (D.10)** — `src/services/safetyMetrics/osha.ts`

### Zettelkasten + persistence
- **MCP Zettelkasten read-only stdio (D.11)** — `src/services/mcp/zettelkastenStdioAdapter.ts` + `src/services/mcp/zettelkastenServer.ts`
- **ZK canonical materializer (D.8.c)** — `src/services/zettelkasten/canonical/materializer.ts`
- **Site Book CRDT layer (multi-supervisor concurrent edits)** — `src/services/siteBook/siteBookCrdt.ts` + adapter Firestore en `src/services/siteBook/siteBookFirestoreAdapter.ts`
- **Generic offline outbox engine + encrypted adapter** — `src/services/sync/genericOutboxEngine.ts` + `src/services/sync/encryptedOutboxAdapter.ts`
- **CQRS Event Store + Incident aggregate + read model** — `src/services/eventStore/inMemoryEventStore.ts` + `src/services/cqrs/incidents/incidentCommands.ts` + `src/services/cqrs/incidents/incidentReadModel.ts` + `src/services/cqrs/incidents/incidentSystem.ts`

### Wire UI cards (Sprint K/L sin UI antes)
- **CphsCommitteeStatusCard** — `src/components/cphs/CphsCommitteeStatusCard.tsx`
- **LeadershipTrailCard** — `src/components/leadership/LeadershipTrailCard.tsx`
- **EngineeringInventoryCard** — `src/components/engineeringControls/EngineeringInventoryCard.tsx`
- **MonthlyClientReportPanel** — `src/components/clientReporting/MonthlyClientReportPanel.tsx`
- **PrivacyRegimeCard** — `src/components/privacy/PrivacyRegimeCard.tsx`

### CI / Observability
- **e2e workflow `continue-on-error: false`** — `.github/workflows/e2e.yml:90`
- **Sentry coverage server** — `src/server/middleware/sentryCapture.ts` + invocaciones en routes
- **CSP final con nonce** — `src/server/middleware/securityHeaders.ts` + `vite.config.ts` CSP transform
- **i18n sweep 91% páginas** — `grep -l useTranslation src/pages/*.tsx | wc -l = 109` de 119
- **Lint script honesto (real ESLint sobre firestore.rules)** — `package.json:lint`
- **Resilience health alert cron + FCM** — `src/server/jobs/resilienceHealthAlert.ts` mounted via `maintenance.ts`

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

## 12. 📥 Propuestas re-incorporadas desde docs/archive/2026-05/

> **Generado 2026-05-19** — cross-reference de los 13 docs movidos a `docs/archive/2026-05/` vs §1-§11. Solo items NO presentes en TODO.md, NO en §9 Descartado, NO filosóficos abstractos. Total ~50 items técnicos verificados con grep contra código real.
>
> **Política:** estos items son carry-over válido — directiva usuario 2026-05-19: "no puedes borrar propuestas que no estén consideradas en TODO.md". Cada item linkea al doc archive como evidencia histórica.

### 12.1 MASTER_PROPOSAL_2026-05 — Sprints 10-19 no implementados

| ID | Item | Evidencia | Prioridad |
|---|---|---|---|
| §12.1.1 | **`/api/ask-guardian` con Gemini function-calling REAL** (no prefix injection). 3 tools: `getWeatherTool`, `getSeismicTool`, `searchNormativaBCN`. Output JSON `{causa_raiz, riesgos[], plan_accion}`. Prompt caching. | `archive/MASTER_PROPOSAL_2026-05.md:262-285` + Grep 0 hits `function_call` en src/server. `gemini.ts:273-282` solo env-context prefix. | ALTA |
| §12.1.2 | **Blender → glTF pipeline** Digital Twin / EPP / cuerpo DS 594. 3 assets: `human-body-7regions-ds594.glb`, `faena-mining-base.glb`, `epp-modular.glb`. Draco + KTX2. | `archive/MASTER_PROPOSAL_2026-05.md:337-341,484-494`. Hoy procedural fallback. | MEDIA |
| §12.1.3 | **MaestrIA pipeline 4-agentes foto→hallazgo**: Detector(Gemini Vision)→Evaluador(DS 594)→Estimador→Redactor PDF firmable. UI "PIPELINE PROGRESS". Foto in → hallazgo formal <30s. | `archive/MASTER_PROPOSAL_2026-05.md:343-347` + `PLAN_PARTE4:112-121`. Grep 0 hits src/services/maestria/. | ALTA |
| §12.1.4 | **ARIA 5 agentes Vertex AI Agent Builder**: Sentinel→KB Builder→Investigator→Q&A→Work Order Writer. MCP `gp-iper` bus. ManDown event → orden trabajo + Calendar <2min. | `archive/MASTER_PROPOSAL_2026-05.md:349-355`. Grep 0 hits src/services/aria/. | ALTA |
| §12.1.5 | **MCP servers internos** `gp-zettelkasten`, `gp-bernoulli`, `gp-iper`, `gp-environment`. Bus tipado vs callbacks. | `archive/MASTER_PROPOSAL_2026-05.md:130-135`. Grep 0 hits. | MEDIA |
| §12.1.6 | **5 smart actions Proto-1 ausentes** en `useZettelkastenIntelligence`: `create-worker-epp-connection`, `suggest-normatives-for-project`, `link-industry-to-project`, `suggest-epp-for-worker`, `auto-link-training-to-worker`. | `archive/MASTER_PROPOSAL_2026-05.md:77-83`. Hook existe pero patterns canónicos no. | MEDIA |
| §12.1.7 | **`AcademicContentProcessor` pipeline real** (695 LOC Proto-1). Hoy `AcademicProcessor.tsx` liviano. | `archive/MASTER_PROPOSAL_2026-05.md:76`. | BAJA |
| §12.1.8 | **Recovery `docs/legacy/analisis_funcional.md` + `auditoria01.md` + `PLAN_MAESTRO_skeleton.md`** via shallow clone `firebase-version`. | `archive/MASTER_PROPOSAL_2026-05.md:391-396` + `PLAN_PARTE3:177-187`. | BAJA |
| §12.1.9 | **`CLAUDE.md` raíz** generado con skill `init`. Onboarding <30min. | `archive/MASTER_PROPOSAL_2026-05.md:395`. Grep NO existe. | BAJA |
| §12.1.10 | **API-First B2B con OpenAPI spec + Postman MCP**. Bloquea ERP/HRM tier Enterprise (SAP/Buk/Workday). | `archive/MASTER_PROPOSAL_2026-05.md:399-405`. NO existe `docs/api/openapi.yaml`. | ALTA |
| §12.1.11 | **Canva brand kit HSE** (12 plantillas operativas). | `archive/MASTER_PROPOSAL_2026-05.md:399-406`. Grep 0 hits. | BAJA |

### 12.2 IMPLEMENTATION_ROADMAP — puentes arquitectónicos críticos

| ID | Item | Evidencia | Prioridad |
|---|---|---|---|
| §12.2.1 | **Event bus central Zustand (`sensorBus`)**. 54 hooks sensor son islas — sin correlación multi-sensor no se reducen falsos positivos. Regla: caída+inactividad+BLE desconectado=critical. | `archive/IMPLEMENTATION_ROADMAP.md:645-737` + `TDA:333-335`. Grep 0 hits. | **CRÍTICA** |
| §12.2.2 | **`conflict_queue` safety docs**. Para `inspection`/`incident_report`/`emergency_alert`/`medical_record`/`training_completion` NUNCA "last_write_wins" — resolución humana obligatoria. | `archive/IMPLEMENTATION_ROADMAP.md:1083-1102`. Grep NO encuentra `conflict_queue`. | **CRÍTICA** |
| §12.2.3 | **`safeNormativeQuery()`**. SLM responde "no tengo información verificada" si RAG <0.75 score, NUNCA alucina texto normativo. | `archive/IMPLEMENTATION_ROADMAP.md:1110-1140`. Grep 0 hits. | **CRÍTICA** |
| §12.2.4 | **Sync predictiva por topología ZK**. `buildPrefetchPlan(workerUid)` lee Calendar 4h → resuelve nodos por tipo tarea. 50MB cap. | `archive/IMPLEMENTATION_ROADMAP.md:578-639`. `topologyAwarePrefetch.ts` foundation parcial. | ALTA |
| §12.2.5 | **Outbox 3-capas alertas emergencia**: FCM → SMS (descartado) → Llamada voz a 60s. Decisión: ¿voice fallback o single-channel? | `archive/IMPLEMENTATION_ROADMAP.md:379-430`. | ALTA |
| §12.2.6 | **Test de campo 10 escenarios pre-piloto**: bolsillo 6h, sin señal 2h, caída-colchón <3s, batería 15%, cambio turno, 50 trabajadores k6, IAP falso, token revocado, supervisor sin señal, SHA256 mismatch. | `archive/IMPLEMENTATION_ROADMAP.md:1362-1376`. | ALTA |
| §12.2.7 | **Pilot fase 1-4 protocolizado** (semana 1-2 doc-only → 14-18 turno noche 24/7). 2-3 empresas voluntarias. | `archive/IMPLEMENTATION_ROADMAP.md:1377-1388`. | MEDIA |
| §12.2.8 | **Battery-aware polling**. BLE/HR/GPS reducen polling <20% batería. Total <12%/h turno 12h. | `archive/IMPLEMENTATION_ROADMAP.md:1054-1080`. Grep 0 hits `BATTERY_MODE_CHANGED`. | ALTA |
| §12.2.9 | **Session expiration 8h**. 3 checks en `verifyAuth`: `tokenIssuedAt<revokedAfter`, `tokenAge>8h` re-auth, `decoded.role!==userRecord.role` → ROLE_CHANGED. | `archive/IMPLEMENTATION_ROADMAP.md:1176-1200`. Parcial en §7. | ALTA |
| §12.2.10 | **MediaPipe local bundle** (`public/models/mediapipe/pose_landmarker_lite.task`). Hoy CDN — viola Ley 19.628 faenas privadas. | `archive/IMPLEMENTATION_ROADMAP.md:1008-1017` + `TDA:175-183`. | ALTA |
| §12.2.11 | **AIPostureAnalysisModal LIVE**. MediaPipe local + OffscreenCanvas + Worker 5fps + reba/rula streaming. Bucket OO.4. | `archive/IMPLEMENTATION_ROADMAP.md:968-1004`. Grep 0 hits `mediapipePoseWorker.ts`. | MEDIA |

### 12.3 TECHNICAL_DEBT_AUDIT — debt no resuelto

| ID | Item | Evidencia | Prioridad |
|---|---|---|---|
| §12.3.1 | **SLM Worker errores tipados** (4 puntos `slmWorker.ts:18,185,267,464`). | `archive/TECHNICAL_DEBT_AUDIT.md:158-168`. | MEDIA |
| §12.3.2 | **`@ts-ignore` 4 puntos prod**: `GuardianVoiceAssistant.tsx:14`, `billing.ts:125`, `billingService.ts:45`, `adService.ts:78`. | `archive/TECHNICAL_DEBT_AUDIT.md:74-87`. | BAJA |
| §12.3.3 | **WebXR `immersive-ar` real** (no placeholder simulado). Hit-test + dom-overlay. ARCore/RealityKit. | `archive/TECHNICAL_DEBT_AUDIT.md:230-242` + `IMPLEMENTATION_ROADMAP:925-962`. | MEDIA |

### 12.4 PLAN_PARTE3_PROTOTIPO2 — blueprint + decisiones

| ID | Item | Evidencia | Prioridad |
|---|---|---|---|
| §12.4.1 | **Workshop scoping nodos 321-512** (Inteligencia Colectiva / Ecosistema Enterprise / Expansión Regional / AI Avanzada). 192 nodos hoja sin spec. ¿Workshop o abandono "512 nodos"? | `archive/PLAN_PARTE3:155-173`. | DECISIÓN USUARIO |
| §12.4.2 | **Custom claim `assignedSiteIds[]`** RBAC scoping O(1) vs Firestore lookup. 6h. | `archive/PLAN_PARTE3:127-145`. | MEDIA |
| §12.4.3 | **`audit_log` mutaciones normativa**. Cada cambio `regulatory/jurisdictions/` emite audit entry. | `archive/PLAN_PARTE3:119`. | MEDIA |

### 12.5 AUDIT.md (2026-04-27)

| §12.5.1 | **`geminiBackend.ts` god-file split** (~2664 líneas → 12 modules: vision, embeddings, RAG, ergonomics, classify). | `archive/AUDIT.md:120-123` + `INFORME_ESTADO:239`. | MEDIA |

### 12.6 PLAN_PARTE2_PROTOTIPO1 — UI rich perdidas

| §12.6.1 | **`GeminiChat` persona técnica legal** (cuando pregunta 100% normativa). 3h. | `archive/PLAN_PARTE2:85-87`. | BAJA |
| §12.6.2 | **ManDown UI completa**: timer re-escalación + mapa eventos + badge supervisor ACK. ~6h. | `archive/PLAN_PARTE2:73-75`. | MEDIA |
| §12.6.3 | **Geofence visual rico**: polygon-on-map color riesgo + tooltips. ~4h. | `archive/PLAN_PARTE2:77-79`. | MEDIA |
| §12.6.4 | **`AfichesSeguridad` descarga PDF** (14 templates industria + QR). | `archive/PLAN_PARTE2:130`. | BAJA |
| §12.6.5 | **`HumanBodyViewer` rutinas auto-generadas** desde `ergonomicAssessments`. | `archive/PLAN_PARTE2:134`. | BAJA |

### 12.7 ROADMAP.md — Fase 10x

| §12.7.1 | **Wake Word "Hey Guardián"** (Capacitor native + background mic). | `archive/ROADMAP.md:75`. | DECISIÓN USUARIO |
| §12.7.2 | **Acciones contextuales nodos del grafo** (botones inline generar PTS / ver normativa / asignar capacitación). | `archive/ROADMAP.md:76`. | BAJA |
| §12.7.3 | **Reconocimiento social Muro Dinámico** ("Enterado y Aplicando" / "Kudos de Seguridad"). | `archive/ROADMAP.md:77`. | BAJA |
| §12.7.4 | **Telemetría IoT ↔ Probabilidad Falla** (aristas rojas RiskNetwork). | `archive/ROADMAP.md:86`. | BAJA |
| §12.7.5 | **Dashboard Cumplimiento SUSESO** (cálculo interno Tasas Acc/Sin). Reemplaza scraping descartado. | `archive/ROADMAP.md:87`. | MEDIA |
| §12.7.6 | **Alerting threshold-cross** (ej. 25 trabajadores → notificación CPHS DS 54). | `archive/ROADMAP.md:88`. | BAJA |

### 12.8 STATE_OF_FUNCTIONALITY — gaps específicos

| §12.8.1 | **9 generadores Bernoulli sin UI dedicada**: `confinedSpaceHVAC`, `dikeHydrostaticMonitor`, `gasDispersionCloud`, `gasLeakDetection`, `microWindEnergy`, `mistingDustSuppression`, `pulmonaryAltitude`, `slamPhotogrammetryNode`, `respiratorFatigue`. CalculatorHub.tsx agrupa pero algunos quieren panel propio. | `archive/STATE_OF_FUNCTIONALITY:130`. | MEDIA |
| §12.8.2 | **Pinecone API key real** vs fallback in-memory. | `archive/STATE_OF_FUNCTIONALITY:323`. NO en §5. | DECISIÓN USUARIO |
| §12.8.3 | **Khipu adapter wire**. Código+tests existen, no wireado en `Pricing.tsx`. | `STATE_OF_FUNCTIONALITY:rojo pero código existe`. | DECISIÓN USUARIO |
| §12.8.4 | **`autoTrigger.ts` test unitario** (DeviceMotion sismic). Crítico: dispara modo emergencia. | `archive/STATE_OF_FUNCTIONALITY:201`. | ALTA |
| §12.8.5 | **TacticalOnboardingModal persist progreso**. Skip-if-completed flag. | `archive/STATE_OF_FUNCTIONALITY:119`. | BAJA |
| §12.8.6 | **MorningRoutine slot persistencia respuestas**. UI lista, falta `addDoc(routine_checkins)` + +5 XP. ~2h. | `archive/STATE_OF_FUNCTIONALITY:192,308`. | MEDIA |

### 12.9 INFORME_AVANCE_NOTEBOOK_LLM

| §12.9.1 | **X.509 device cert flow IoT MQTT**. Auth sensores producción industrial. | `archive/INFORME_NOTEBOOK:92`. | ALTA |
| §12.9.2 | **RLHF bucket feedback → fine-tuning** SLM/Gemini. `aiFeedback` captura pero no cierra loop. | `archive/INFORME_NOTEBOOK:99`. | BAJA |
| §12.9.3 | **Streaming SSE Gemini** (token-by-token rendering Asesor). | `archive/INFORME_NOTEBOOK:99`. | MEDIA |

### 12.10 INFORME_ESTADO_2026-04-29

| §12.10.1 | **Marketplace Google Workspace add-on** (Titanio+ tier). OAuth Consent + Marketplace review. | `archive/INFORME_ESTADO:250`. | DECISIÓN USUARIO |
| §12.10.2 | **SOC 2 Type I path** (Vanta/Drata + Access Control / Change Mgmt / IR / BCP / Vendor). 6 meses external review. Enterprise+. | `archive/INFORME_ESTADO:251`. | ESTRATÉGICA |
| §12.10.3 | **PGP key publicada** `/.well-known/pgp-key.asc`. Vuln-disclosure + auditor trust. | `archive/INFORME_ESTADO:300`. | MEDIA |
| §12.10.4 | **`status.praeventio.net`** status page. | `archive/INFORME_ESTADO:301`. | BAJA |
| §12.10.5 | **Refactor Pages >700 LOC** (Training 868, Gamification 794, Matrix 766, SiteMap 746). | `archive/INFORME_ESTADO:260` + `AUDIT:127`. | BAJA |
| §12.10.6 | **Lighthouse CI status posts en PRs** (`LHCI_GITHUB_APP_TOKEN`). | `archive/INFORME_ESTADO:302`. | BAJA |

### 12.11 Resumen ejecutivo §12

**Prioridades CRÍTICAS (3) — implementar próximo sprint:**
- §12.2.1 Event bus central `sensorBus` (correlación multi-sensor)
- §12.2.2 `conflict_queue` safety docs (resolución humana)
- §12.2.3 `safeNormativeQuery()` (SLM no alucina normativa)

**Prioridades ALTAS (12):**
- §12.1.1, §12.1.3, §12.1.4, §12.1.10 (Sprints 10/12/13 + OpenAPI)
- §12.2.4-§12.2.6, §12.2.8-§12.2.10 (Roadmap critical paths)
- §12.8.4, §12.9.1 (autoTrigger test + X.509 IoT)

**Decisiones del usuario pendientes (6):**
- §12.4.1 ¿workshop 321-512 nodos o abandono "512 nodos"?
- §12.7.1 Wake Word — privacidad
- §12.8.2 Pinecone — pagar o aceptar degradado?
- §12.8.3 Khipu — wire o dormant?
- §12.10.1 Marketplace Google Workspace add-on
- §12.10.2 SOC 2 Type I path (estratégico)

**MEDIAS y BAJAS (~25):** refinamientos UX, recovery legacy, features Fase 10x posteriores. Ver tablas §12.1-§12.10.

---

**Próxima revisión profunda:** post-merge de #267 + #268 + cleanup §2 (estimada 2026-05-22).
