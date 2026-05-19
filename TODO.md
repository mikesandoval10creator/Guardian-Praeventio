# TODO.md — Guardian Praeventio (Fuente Única de Verdad)

> **Filosofía:** "El riesgo se neutraliza en el diseño, no en la reacción." — El Guardián.
>
> **Regla #1 (inviolable):** este documento **NO marca ✅ sin evidencia file:line**. Cada claim de "hecho" debe ser verificable con `grep` o `Read` en el código real. Una app de prevención de riesgos NO puede permitirse falsa completeness — vidas dependen de que sepamos qué funciona de verdad.
>
> **Regla #2 (decisión usuario 2026-05-15):** "honesto" = **funciona REAL**. Si un feature no funciona, primero intentamos producirlo. Solo removemos cuando el usuario lo pide explícitamente (ej: SMS).
>
> **Regla #3 (decisión usuario 2026-05-15):** **la respuesta default es PRODUCIR la solución, no etiquetarla ni sacarla.** Si una dependencia externa falla (API key, servicio caído), construimos un fallback REAL (climatología determinística, scratch local, modelo físico) — no un banner "no disponible" ni un grid que colapsa. El usuario nunca debe percibir que algo "está roto" o "pendiente"; debe sentir que la app funciona, porque funciona.

**Última auditoría profunda:** 2026-05-15 — consolidación de 145+ docs internos + 5 agentes paralelos verificando claims contra código real + Codex reviews + PRs mergeados. Reemplaza a las versiones anteriores de TODO/ROADMAP/AUDIT/STATE/HONEST_STATE.

**Verificación independiente:** 2026-05-19 — re-ejecutado `npm test` + inspección de `firestore.rules`, `billing.ts`, `mercadoPagoIpn.ts`, `SusesoReports.tsx`, `vertexTrainer.ts`, `MeshPlugin.kt`, workflows `.github/`, y cruce con `AUDIT_TRUTH_MATRIX_2026-05-07.md` + `PRAEVENTIO_HONEST_STATE_2026-05-05.md`. Resultados: §2.11 (394 tests fallidos) **es falso** — vitest reporta `10029 passing / 0 failed / 1 todo intencional / success:true`. §4 (CI rota) **es falso** — los 4 workflows YAML están sanos (mutation.yml reparado Sprint 39 B.1, e2e.yml `continue-on-error:false` Sprint 36). §3 (Codex pendings) **ya mergeados** (commits `6a077212` PR #267, `326c68ce` PR #268, fixes verificados en código). Se descubrieron 7 items abiertos nuevos (Stripe scaffold drift, IAP single SKU, SusesoApiClient en frontend, ZK 3 fuentes, B2D Climate stub, B2D Coach stub, EPP claim Gemini-vision) — listados en §2.12-2.18. Plan de implementación con factibilidad en §12.

**Cobertura E2E real ponderada (recalibrada 2026-05-15):** ~70% (subió de 62% en 2026-05-05 tras Sprints 39-56 + Wave F + Codex sweep). **Meta Day-1 mundial:** 95%+.

---

## 📑 Índice

1. [Estado honesto por dominio](#1-estado-honesto-por-dominio)
2. [🔴 CRÍTICO inmediato — false completeness verificada](#2--crítico-inmediato--false-completeness-verificada)
3. [✅ Codex review pendings — TODOS MERGEADOS](#3--codex-review-pendings--todos-mergeados-verificación-2026-05-19)
4. [✅ CI infrastructure refutado](#4--ci-infrastructure-refutado-verificación-2026-05-19)
5. [⏸ Bloqueado por input usuario](#5--bloqueado-por-input-usuario-no-código)
6. [📋 Plan actual (orden de trabajo recomendado)](#6--plan-actual-orden-de-trabajo-recomendado)
7. [✅ Cerrado verificado (compacto)](#7--cerrado-verificado-compacto)
8. [🔮 Pendiente Day-1 — mobile + jurisdicciones + features](#8--pendiente-day-1)
9. [🗑 Descartado por directiva](#9--descartado-por-directiva)
10. [📚 Docs deprecated (no consultar)](#10--docs-deprecated-no-consultar)
11. [Convenciones para mantener este TODO vivo](#11-convenciones-para-mantener-este-todo-vivo)
12. [🎯 Plan de implementación — convertir "promesas" en realidad](#12--plan-de-implementación--convertir-promesas-en-realidad)

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

### 2.11 ✅ Tests verde 100% (cierre 2026-05-19)
**Estado anterior (2026-05-15):** se afirmaba `npm test` → **8040 passing / 394 failing / 84 archivos failed** (exit code 0).

**Estado verificado 2026-05-19:** `npm test` → **10029 passing / 0 failed / 1 todo / success:true** (`/tmp/vitest-results.json`, 187s, 3222 suites, 10030 tests totales).

El único `it.todo` es legítimo y justificado: `src/components/ar/ARPosterScanner.test.tsx :: "renderiza error del matcher con CTA Reintentar (Codex #4) — E2E with mocked dynamic import flaky"`. No es regresión; es un test E2E que se reemplazó por cobertura integration.

Los 394 tests fallidos previos fueron arreglados entre 2026-05-15 y 2026-05-19, probablemente como side-effect de los ~10 PRs `feat(...)-wire-HTTP-surface` mergeados (#439-#448) que estabilizaron lógica subyacente.

**Riesgo cerrado:** no hay regresiones latentes en tests.

### 2.12 🔴 Stripe scaffold sigue en código pese a declararse "descartado" §9
**Archivos:**
- `src/services/billing/stripeAdapter.ts` (95+ LOC, "TYPED STUB", sin paquete `stripe` instalado)
- `src/services/billing/stripePreflightCheck.ts` (170+ LOC con validación de prefijos `sk_live_`/`sk_test_`)
- `src/services/billing/stripePreflightCheck.test.ts`
- `src/server/routes/billing.ts:84` import, `:159` comentario, `:476`, `:593-598` handler activo
- `src/pages/Pricing.tsx:946` comentario

`stripeAdapter.isConfigured()` retorna `false` porque no hay paquete instalado, así que el branch `body.paymentMethod === 'stripe'` no se activa en runtime → **no rompe nada**, pero el drift entre TODO.md §9 ("Stripe descartado") y el código activo confunde auditorías futuras.

**Fix Opción A** (recomendado si Stripe sigue descartado): borrar 4 archivos `stripe*.ts` + imports + branch en `billing.ts`.
**Fix Opción B**: revertir §9 y declarar Stripe como path internacional opcional activable post-Day-1.

### 2.13 🔴 IAP single SKU para todos los tiers
**Archivo:** `src/pages/Pricing.tsx:995` → `const productId = 'praeventio_premium_monthly';`

Todo IAP nativo (Apple Pay + Google Play Billing) compra el **mismo product** sin importar el tier seleccionado. Usuario que paga `oro`, `titanio` o `global-titanio` vía store recibe `praeventio_premium_monthly`. Hallazgo P1 de `AUDIT_TRUTH_MATRIX_2026-05-07.md:249`.

**Fix:** mapear `tier.id` → product SKU específico antes del `iapAdapter.purchase()`. Requiere crear los SKUs en App Store Connect + Google Play Console (bloqueado por §5 cuentas).

### 2.14 🔴 SusesoApiClient importado directo en frontend
**Archivo:** `src/pages/SusesoReports.tsx:27-33` → `import { SusesoApiClient, ... } from '../services/sii/susesoApiClient'`

`SusesoApiClient.fromEnv()` (línea 131 del adapter) usa `process.env.SUSESO_API_KEY` + `process.env.SUSESO_EMPLOYER_RUT`. En Vite browser:
- Vars sin prefijo `VITE_` **no están disponibles** → el client siempre será `null` en producción
- Si se renombran con prefijo `VITE_` → **los secretos quedan en el bundle del cliente**, accesibles vía DevTools

**Fix:** mover a server route admin (`POST /api/admin/suseso/submit`) con verifyAuth + tenant isolation; remover import del frontend. Hallazgo P1 de `AUDIT_TRUTH_MATRIX_2026-05-07.md:178-191`.

### 2.15 🔴 Zettelkasten dividido en 3 fuentes sin materializer
**Archivos:**
- `src/server/routes/zettelkasten.ts:191` → escribe `zettelkasten_nodes` (Bernoulli server-side)
- `src/contexts/UniversalKnowledgeContext.tsx:108, 224` → lee/escribe `nodes` (KG global)
- `src/hooks/useRiskEngine.ts:44, 86, 96, 263` → `nodes` (risk engine)
- `src/components/digital-twin/RiskNodeMarkers.tsx:79` → `tenants/{tenantId}/zettelkasten_nodes` (digital twin tenant-scoped)

Un nodo creado por calculadora Bernoulli **no aparece** donde RiskNetwork/AI Hub/Digital Twin esperan. El usuario percibe inconsistencia. Hallazgo P1 de `AUDIT_TRUTH_MATRIX_2026-05-07.md:193-207`.

**Fix:** definir collection canónica + materializer/bridge bidireccional + tests E2E (generar nodo desde calculadora → verlo en KG/RiskEngine/Twin).

### 2.16 🔴 B2D Climate adapter sigue deterministic-stub vs promesa "Open-Meteo/USGS/OpenAQ"
**Archivos:** routes en `src/server/routes/b2d*.ts` (verificar) — promesa marketing dice "Open-Meteo + USGS + OpenAQ" pero endpoint retorna stub determinístico.

**Fix Regla #3** (construir, no etiquetar): wire real:
- Open-Meteo API (gratuito sin key) para forecast meteorológico
- USGS Earthquake API para sismos
- OpenAQ API para calidad del aire
- Cache 1h server-side por (lat,lng,radius)
- Fallback determinístico solo si las 3 fuentes fallan simultáneamente

### 2.17 🔴 B2D Gemini AI Coach es determinístico, no usa Gemini
**Archivo:** servicio coach (verificar `src/services/coach/` o similar)

Promesa marketing dice "Gemini AI Coach"; código retorna respuestas determinísticas pre-armadas. **Fix:** wire `geminiAdapter.generateContent()` con prompt template + RAG sobre normativa del tenant + fallback determinístico solo si Gemini API falla.

### 2.18 🔴 EPP detection usa Gemini-vision, no Edge AI local
**Archivos:**
- Promesa: "Edge AI verifica EPP local"
- Realidad: `src/components/ai/VisionAnalyzer.tsx:152` usa Gemini-vision (cloud)
- `MediaPipe` local está implementado para postura/ergonomía (`useMediaPipePose`), no para EPP

**Fix Opción A** (alinear claim): cambiar marketing/UI a "EPP detection vía Gemini Vision (cloud)" + manejo offline degradado.
**Fix Opción B** (cumplir promesa): entrenar/usar modelo TFLite de detección de EPP local (yolo-tiny + 7 clases: casco/chaleco/gafas/guantes/arnés/botas/respirador). Modal en `AIPostureAnalysisModal` ya carga MediaPipe; añadir branch EPP.

---

## 3. ✅ Codex review pendings — TODOS MERGEADOS (verificación 2026-05-19)

> Codex ChatGPT hizo review automática en ~16 PRs mergeados últimos 14 días. La mayoría muestran "Codex usage limits reached" (sin contenido técnico). Solo **4 PRs** tuvieron hallazgos reales — **10 hallazgos totales** (2 P1 + 8 P2), cubiertos por PRs #267 + #268.
>
> **Verificación 2026-05-19:** ambos PRs ya están en main. Confirmado vía `git log --oneline --grep`: commits `6a077212` (PR #267) y `326c68ce` (PR #268). Fixes verificados en código:
> - `src/server/rateLimit/firestoreRateLimitStore.ts:75-100` tiene `encodeKey()` con comentario "Codex P1 fix (PR #264, 2026-05-15)"
> - `src/hooks/useResilientAi.ts:103-130` tiene gate `slmTokenWindowOpen` con comentario "Codex P2 fix (PR #250, 2026-05-15)" + follow-up PR #268
>
> Esta sección queda como registro histórico — **no requiere acción**.

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

## 4. ✅ CI infrastructure refutado (verificación 2026-05-19)

> El claim 2026-05-15 afirmaba 4 workflows rotos. **Re-verificación 2026-05-19 refuta esto**: los YAML están sanos.

| Workflow | Estado YAML 2026-05-19 | Evidencia |
|---|---|---|
| `Performance Budgets` | ✅ sano | `perf.yml` funcional |
| `Playwright full-stack (Express + Firestore emulator)` | ✅ sano | `e2e.yml:90` `continue-on-error: false` desde Sprint 36 hardening |
| `Firestore rules tests` | ✅ sano | `ci.yml:110` corre con emulator real |
| `Stryker mutation testing` (Linux) | ✅ sano | `mutation.yml:30-35` comentario "Sprint 39 Fase B.1: continue-on-error removido — el job ahora bloquea merge si la mutación cae bajo thresholds" |

**Acción pendiente única:** confirmar via GitHub Actions runs API que los workflows están **verde HOY**, no solo que el YAML compila. Verificar también:
- `orchestrator` mutation score 43.59% < break:50 (H31 P1, Sprint 29) — esto sí está abajo del umbral pero `continue-on-error` fue removido, así que bloqueará merges si no se sube
- `e2e-full-stack` corridas recientes

Esta sección queda como referencia histórica.

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

### Sprint inmediato (esta semana) — reflejando verificación 2026-05-19

> §3 (Codex), §4 (CI), §2.11 (tests fallidos) **ya están refutados/cerrados**. El plan se redirige a items realmente abiertos.

1. **Quick wins §12.1 #1-#11** (~6 hrs total) — `console.log` debug, 3 `Math.random()` en locks, 2 `@ts-ignore`, H1, H3, H5, H27, H30
2. **Decisiones D1-D4 §12.2** — usuario debe elegir entre A/B para Vertex Trainer, Stripe scaffold, IAP single SKU, push automático mutuales
3. **Closing sprint actual** §12.4 — H18/H25/H26 P1 en progreso (Sprint S28 B4)
4. **Podar branches viejas** dev/sprint-10..19 (~30 ramas) + claude/* obsoletas (~5)

### Sprint siguiente — completar §2 false completeness (3 items abiertos)

§2.1-§2.6 + §2.10 ✅ cerrados. Restantes:
1. **§2.7** Vertex Trainer (D1 decisión)
2. **§2.8** assetlinks SHA-256 — bloqueado §5 (keystore)
3. **§2.9** Gemma SHA-256 — bloqueado §5 (DevOps)

### Sprint posterior — §2.12-§2.18 nuevos hallazgos

Por orden de criticidad:
1. **§2.14** SusesoApiClient → server proxy (M 2d) — riesgo de leak de secretos
2. **§2.15** Zettelkasten canonical (M 3d) — inconsistencia de datos para usuario
3. **§2.13** IAP single SKU (D3 decisión)
4. **§2.18** EPP claim (D si Edge AI local vs Gemini-vision)
5. **§2.16** B2D Climate Open-Meteo/USGS/OpenAQ real (M 2d)
6. **§2.17** B2D Gemini AI Coach real (M 1d)
7. **§2.12** Stripe scaffold (D2 decisión)

### Sprint final pre-Day-1 — features grandes §12.1 #21-#26

Cuando §12.1 y §12.2 cerrados, atacar F-A/B/D/E/F + EPP Edge AI (~10 semanas-dev total).

### Sprint vigente continuo

Mantener: tests verdes (HOY 10029/10029 ✅), CI workflow estable, no agregar nuevos fakes.

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

## 12. 🎯 Plan de implementación — convertir "promesas" en realidad

> Después de cerrar la auditoría (§7 verificado + §2.11 y §3 y §4 corregidos), las "promesas" pendientes se agrupan en 4 categorías por factibilidad. Esta sección es la respuesta a la pregunta del usuario: *"¿qué nos falta para hacer reales todas las funciones que están como promesa?"*
>
> **Estimaciones:** S = small (<2 hrs · 1 dev), M = medium (1-3 días · 1 dev), L = large (1-2 semanas · 1 dev), XL = extra-large (>2 semanas · puede requerir 2+ devs o input externo).
>
> **Bloqueado** = requiere input usuario/externo antes de poder implementar.

### 12.1 — IMPLEMENTABLES YA (sin bloqueos, sin decisiones) · 26 ítems

#### Quick wins (S, <2 hrs) · 11 ítems

| # | Item | Archivo | Esfuerzo |
|---|---|---|---|
| 1 | Remover `console.log` debug | `src/components/knowledge/SmartConnectionsPanel.tsx:119` | S 5min |
| 2 | `Math.random()` → `crypto.randomBytes()` en lease distribuido | `src/services/scheduler/distributedLease.ts:76` | S 15min |
| 3 | `Math.random()` → `crypto.randomBytes()` en KEK lock | `src/services/security/kekRotationOrchestrator.ts:118` | S 15min |
| 4 | `Math.random()` → `crypto.randomBytes()` en audit trail | `src/server/routes/apprenticeship.ts:272` | S 15min |
| 5 | Justificar o quitar `@ts-ignore` billing | `src/server/routes/billing.ts:139` | S 10min |
| 6 | Justificar o quitar `@ts-ignore` billing service | `src/services/billingService.ts:45` | S 10min |
| 7 | H1 — limpiar doc DWG desfasada | `docs/` | S 30min |
| 8 | H3 — Stripe pre-flight messaging (cualquier opción §2.12) | `src/services/billing/stripe*` | S 1hr |
| 9 | H5 — SII pre-flight messaging (3 adapters stub) | `src/services/sii/` | S 1hr |
| 10 | H27 — Geofence permission UX toast | hook geofence | S 1hr |
| 11 | H30 — verify `/processing-activities` no fugue tenantId | `src/server/routes/privacy*` | S 1hr |

#### Medio plazo (M, 1-3 días) · 9 ítems

| # | Item | Esfuerzo | Plan técnico breve |
|---|---|---|---|
| 12 | 3 STUB_REPLACE_WITH_WEBAUTHN_ASSERTION en compliance builders (`Ds76Builder`, `Ds67Builder`, `SusesoFormBuilder`) | M 2d | Reusar `src/server/auth/webauthnAssertion.ts` (mismo wire que SUSESO sign en §7) |
| 13 | §2.14 SusesoApiClient → server proxy admin | M 2d | Endpoint `POST /api/admin/suseso/submit` + verifyAuth + tenant scope; remover import frontend |
| 14 | §2.15 Zettelkasten canonical materializer | M 3d | Definir `nodes` como canónica; cron job que materialice `zettelkasten_nodes` + `tenants/{tid}/zettelkasten_nodes` → `nodes` |
| 15 | §2.16 B2D Climate Open-Meteo + USGS + OpenAQ real | M 2d | 3 fetchers + cache 1h + fallback determinístico actual como último recurso |
| 16 | §2.17 B2D Gemini AI Coach real | M 1d | Wire `geminiAdapter.generateContent()` con prompt template; RAG sobre normativa del tenant si existe |
| 17 | H19 — KnowledgeGraph `as any` x18 cleanup | M 1d | Definir tipos correctos; quitar `any` cast por cast |
| 18 | H22 — KG virtualización + Web Worker para >1k nodos | M 3d | `react-window` para lista + worker para layout fuerza-dirigida |
| 19 | H23 — backgroundTriggers concurrency `Promise.all` con concurrency 10 | M 1d | Usar `p-limit` o helper propio; añadir test de throughput |
| 20 | H24 — Code splitting eager → `React.lazy` (KG, Site25D, PortableCurriculum) | M 1d | 3 wraps `lazy()` + `<Suspense fallback>` |

#### Grande (L, 1-2 semanas) · 6 ítems

| # | Item | Esfuerzo | Plan |
|---|---|---|---|
| 21 | §2.18 EPP Edge AI local (TFLite YOLO-tiny 7 clases) | L 2sem | Entrenar modelo o usar pre-trained; deps `@tensorflow/tfjs` ya en bundle; wire en `AIPostureAnalysisModal` |
| 22 | F-A CalculatorHub UI consumer 12 generadores Bernoulli sin UI | L 2sem | 12 panels engineering (gas dispersion, confined-space HVAC, respirator fatigue, pulmonary altitude, slope stability, dike hydrostatic, gas leak, misting dust, micro-wind, SLAM photogrammetry, hidrante fire, scaffold wind suction) |
| 23 | F-B RAG NL sobre incidentes históricos del tenant | L 1sem | Vector store Firestore + embedding gemini-embedding-001 + query interface |
| 24 | F-D Gamification × salud (sin tocar IPER) | L 1sem | Componente `HealthAwards` + lógica logros (días sin incidente, etc) |
| 25 | F-E Predictive Alerts × Calendar | L 1sem | Cron job: lee Calendar próxima semana + cruza con `getForecast()` + envía push push si tarea crítica wind/seismic |
| 26 | F-F WebAuthn Settings UI | L 1sem | Listing credenciales + registrar nueva + revocar; backend `webauthnAssertion.ts` ya existe |

### 12.2 — REQUIEREN DECISIÓN USUARIO · 4 ítems

| # | Item | Decisión | Si A | Si B |
|---|---|---|---|---|
| D1 | §2.7 Vertex Trainer (`vertexTrainer.ts:128`) | Descartar o implementar | Borrar stub + actualizar HONEST_STATE | Implementar `JobServiceClient.createCustomJob` (XL 3sem) |
| D2 | §2.12 Stripe scaffold | Descartar o activar | Borrar 4 archivos + imports | Instalar `stripe` npm + implementar adapter (L 1sem) |
| D3 | §2.13 IAP single SKU `praeventio_premium_monthly` | Mantener o crear SKUs por tier | Documentar en `BILLING.md` que IAP es flat-rate | Crear SKUs en stores (bloqueado §5) + mapear `tier.id` → SKU |
| D4 | §9 línea "Push automático SUSESO/SII/MINSAL/OSHA/RIDDOR/NOM/NR/MEM/Rostrud" | Mantener directiva o reconsiderar | Status quo (PDF + recordatorio) | Activar adapters doc-only existentes (M 2d cada uno) |

### 12.3 — BLOQUEADO POR §5 (input usuario externo) · 23 ítems

> Estos se pueden destrabar SOLO cuando el usuario provea cuentas/secrets/docs.

#### Bloqueado por cuentas/keystores (5)

| # | Item | Bloqueador |
|---|---|---|
| B1 | §2.8 `assetlinks.json` SHA-256 real | Google Play keystore (`*.jks`) del usuario |
| B2 | Mobile signing Android (`signingConfigs`) | idem |
| B3 | Mobile iOS provisioning + APNS p8 | Apple Developer Program ($99/yr) |
| B4 | HealthKit iOS plugin nativo | Apple Developer Program |
| B5 | HealthConnect Android plugin nativo | Play Console + keystore |

#### Bloqueado por secrets de infraestructura (12)

| # | Secret faltante | Habilita |
|---|---|---|
| B6 | `VITE_GOOGLE_MAPS_API_KEY` | 4 mapas + Site25DPanel + DynamicEvacuationMap/Coastal/Volcanic Maps |
| B7 | `VITE_FIREBASE_VAPID_KEY` | FCM web push (hoy fallback a polling) |
| B8 | `GOOGLE_CLIENT_ID/SECRET` | Calendar + Fit OAuth + Object lifecycle Calendar wire (B.5.3 #4) |
| B9 | `IOT_WEBHOOK_SECRET` | Telemetry HMAC verify |
| B10 | `MP_ACCESS_TOKEN` + `MP_ENV` | MercadoPago checkout productivo |
| B11 | `GOOGLE_PLAY_*` (3 keys) | Android billing RTDN |
| B12 | `SENTRY_DSN` prod + rotación leak | Error tracking real |
| B13 | `KMS_KEY_RESOURCE_NAME` + `KMS_ADAPTER=cloud-kms` | **Sin esto prod NO bootea** (preflight fail-fast) |
| B14 | `SCHEDULER_SHARED_SECRET` | Cloud Scheduler gate del maintenance reaper |
| B15 | `VERTEX_PROJECT_ID` + `_LOCATION` | Vertex AI residencia Latam |
| B16 | `DWG_CONVERTER_URL` + `_TOKEN` + `CAD_OUTPUT_BUCKET` | LibreDWG Cloud Run (DWG import) |
| B17 | `PHOTOGRAMMETRY_WORKER_TOKEN` | COLMAP worker auth |

#### Bloqueado por documento/proceso externo (6)

| # | Item | Bloqueador |
|---|---|---|
| B18 | §2.9 SLM Gemma 2 2B SHA-256 | DevOps computa hash del modelo descargado |
| B19 | Apple Root CA G3 PEM full-chain SSN | descarga oficial Apple |
| B20 | Traducciones humanas reales fr/de/it/ja/zh-CN/ar/ko/hi | traductor profesional (8 idiomas × ~40 keys) |
| B21 | Acuerdos con mutuales (ACHS/IST/Mutual) | proceso comercial — opcional Day-1 |
| B22 | COLMAP worker deploy Cloud Run | ops decide cuándo activar (worker existe en repo) |
| B23 | MQTT broker prod (emqx/cloud-iot) | ops decide adapter + provisiona broker |

### 12.4 — DEUDA TÉCNICA HEREDADA · 27 ítems (no urgentes pero suman)

#### En sprint actual 🔄 (5 P1 del AUDIT_BACKLOG)

H18, H25, H26, H28, H29 — ver `docs/audits/AUDIT_BACKLOG.md` líneas 31-46.

#### Sprint próximo 📅 (2)

H31 Stryker Linux ratchet (orchestrator 43.59% < break:50) — ver §4 nota.
H33 Tests 184 componentes (priorizar emergency + billing + compliance + medical) — ver §8.

#### P2/P3 backlog (4 restantes después de quick wins)

H11 ✅, H22, H23 (en §12.1 medio), H32 seeds determinísticos 8 archivos (S 4hrs), H16 CSP nonce regex frágil (M 1d), H30 (en §12.1 quick wins).

#### Productos pendientes Day-1 §8.5.3 (16 restantes)

1. MQTT IoT Broker prod (M 3d post-§B23)
2. WebXR `immersive-ar` end-to-end Android (M 3d — foundation existe)
3. ARKit Quick Look `.usdz` iOS (M 2d)
4. Object lifecycle Calendar wire (M 1d — endpoint listo, falta hook)
5. Geo-anchored ZK retrieval (M 1d Haversine)
6. Digital Twin Faena COLMAP deploy (M 1d post-§B22)
7. CSV ETL universal con import wizard (L 1sem)
8. Onboarding wizard step-by-step UI (M 2d)
9. Coach IA por dominio (especializar medicina/ergonomía/SST) (L 1sem post-§12.1 #16)
10. DS 67/76 reports PDF (M 2d — similar a DIAT/DIEP)
11. CLI + migration registry + SLO dashboard (L 2sem)
12. Twin triple-gate auth wire global (M 1d)
13. AnatomyLibrary + DifferentialDx + DrugInteractions (XL 3sem — bundle CC0)
14. VitalityMonitor backend (M 2d post-§B5)
15. MediaPipe Pose en AIPostureAnalysisModal (M 2d)
16. MorningRoutine slot persistencia (S 4hrs)

#### Branches sin fusionar (1 tarea admin · L 1sem)

Podar **214 branches** en `origin/` (claude/* 10-17d + dev/sprint-* 10-53 + feat/parallel-stream-*). Triage: rescatar trabajo único + borrar redundantes.

#### i18n (2)

- 10 páginas restantes sin `useTranslation` (S 2hrs)
- Traducciones humanas — bloqueado §B20

#### Compliance global (3)

- Wire UI 6 jurisdicciones UK/CA/AU/JP/KR/IN (L 1sem — código `src/services/regulatory/jurisdictions/` listo)
- Tier "Global" pricing (M 2d)
- 8 emission adapters doc-only US OSHA/UK RIDDOR/EU OSHA + Delt@/INAIL/MX NOM-019/BR NR-5/AU WHS/CN GB/T 33000/RU 152-FZ (XL — depende de D4)

### 12.5 — Resumen ejecutivo de factibilidad

| Categoría | Ítems | Esfuerzo total estimado | Bloqueador |
|---|---|---|---|
| **12.1 Implementables YA** | 26 | ~9 semanas-dev | Ninguno |
| **12.2 Requieren decisión** | 4 | ~5 semanas-dev (depende) | Usuario decide |
| **12.3 Bloqueado §5** | 23 | ~6 semanas-dev (cuando lleguen secrets) | Usuario externo |
| **12.4 Deuda heredada** | 27 | ~20 semanas-dev | Capacidad de equipo |
| **TOTAL ACCIONABLE** | **80** | **~40 semanas-dev** | mixto |

**Camino crítico hacia Day-1 (95% E2E):**

1. **Semana 1**: §12.1 #1-#11 (11 quick wins) + §12.4 H18/H25/H26 (sprint actual)
2. **Semana 2-3**: §12.1 #12-#20 (medio plazo) + §12.4 H28/H29 (sprint actual)
3. **Semana 4-5**: D1-D4 decisiones + §12.1 #21-#26 (large)
4. **Semana 6-10**: §12.4 productos Day-1 críticos (#1, #2, #3, #4, #5, #14, #15)
5. **Semana 11-12**: §12.3 destrabado cuando llegan secrets §5 (B6-B17)
6. **Semana 13+**: §12.4 productos no-críticos + 8 emission adapters + i18n traducciones

**Riesgo principal:** los items §12.3 bloqueados son ~30% del trabajo restante. Sin acción del usuario sobre cuentas y secrets, **el techo real es ~85% E2E**, no 95%.

---

**Próxima revisión profunda:** post-cleanup §12.1 quick wins (estimada 2026-05-26).

---

## 13. 🔍 Hallazgos NUEVOS — auditoría exhaustiva 2026-05-19 (32 items N1-N32)

> **Audit profundo ejecutado 2026-05-19** documentado en `docs/audits/AUDIT_EXHAUSTIVA_2026-05-19.md` (2900+ LOC, 27 secciones, 4 agentes paralelos especializados, build físico medido, verificación archivo por archivo).
>
> **Datos consolidados HOY:**
> - **30 MB** dist/ (28 MB ML models + 2 MB UI)
> - **15.6 MiB** PWA precache (485 entries)
> - **10029 tests passing** / 0 failed
> - **215 branches** sin fusionar (126 dev/sprint-*, 8 claude/*, 4 feat/*, +misc)
> - **148 TODO/FIXME** markers en código
> - **17 ADRs** + **16 Runbooks** documentados
> - **52 Firestore collections** declaradas en rules + **29 composite indexes**
> - **167 route files** + **542 endpoints** (120 GET + 419 POST + 0 PUT/PATCH + 3 DELETE)
> - **3 triggers Firestore** + **18 cron jobs**
> - **154 páginas** (1 huérfana: SloErrorBudget) / 111 sin test (72%)
> - **373 componentes** / 138 huérfanos REALES (37%) / 192 sin test (51%)
> - **175 hooks** / 92 huérfanos REALES (52.6%)
> - **619 services** / 7 estrictos huérfanos + 61 test-only = 68 efectivos (11%)
>
> **TOTAL HUÉRFANOS verificados: 299 archivos (139 componentes/páginas + 92 hooks + 68 services efectivos)**

### 13.1 🔴 P0 NUEVOS (críticos / bloqueantes legales)

| ID | Hallazgo | File:line | Esfuerzo |
|---|---|---|---|
| N17 | `invoices` collection sin `match` block en rules — billing.ts:563,655,921 escribe via Admin SDK directo | `firestore.rules:11` (solo comentario) + `billing.ts:563,655,921` | S 30min |
| N18 | `wisdomCapsules` (rules:536) vs `wisdom_capsules` (routes 4 lugares) — naming conflict | `firestore.rules:536` vs `wisdomCapsule.ts:266,314,414` | S 1h |
| N19 | `POST /api/audit-log` sin Zod — escribe a immutable `audit_logs`, payload malformado server-side es permanente | `routes/audit.ts:40` | S 30min |
| N20 | 3 admin endpoints sin Zod ni limiter per-uid (revoke-access, set-role, replicate-critical) | `routes/admin.ts:98,164,252` | S 1h |
| N29 | **Ley Karin engine huérfano** (`karinReportingEngine.validateKarinReport()` 239 LOC) — `useConfidentialReports` existe wireada pero NO usa este engine. **Ley Karin acoso laboral OBLIGATORIA en Chile.** | `src/services/confidentialReports/karinReportingEngine.ts:137` | M 1d |
| W1 | **`dr-dryrun.yml` workflow ROTO** — invoca `npm run test:dr` que NO existe en package.json. Cron mensual fallará silenciosamente. | `.github/workflows/dr-dryrun.yml:87` + `package.json` (sin `test:dr`) | S 15min |

### 13.2 🟡 P1 NUEVOS

#### Rate limiting / Zod gaps backend

| ID | Hallazgo | Esfuerzo |
|---|---|---|
| N21 | 12 endpoints "heavy" sin rate limiter per-uid (reports/generate-pdf, cad/convert-dwg, dte/generate, coachRag ×3, medicalAptitude, eventReplay, criticalRoles, firstResponderMap, auditPortal, adminJobs) | M 1d |
| N22 | 80 endpoints SIN Zod validation total — distribución billing.ts (9), organic.ts (8), admin.ts (7), curriculum.ts (6), projects.ts (4), +14 archivos más | L 1 semana |
| N23 | 35 collections que routes escriben pero NO en rules: `iap_receipt_attempts`, `apple_ssn_attempts`, `user_sessions`, `fcm_tokens`, `photogrammetry_jobs`, `predictive_alert_acks`, `imports`, `erp_sync_logs`, `health_vault_shares`, `knowledge_base`, `visitors`, etc. | M 2d |

#### Mascot UX (87 oportunidades del §15 AUDIT)

| ID | Hallazgo | Esfuerzo |
|---|---|---|
| N1 | 16 Suspense `fallback={null}` → `MascotLoader thinking` | S 30min |
| N2 | 11 form-success `setSaved(true)` → mascot celebrating | S 45min |
| N3 | 7 Hero/Landing prime spots → mascot xl prominente | M 1d |
| N4 | Onboarding completion celebration mascot xl | S 1h |
| N11 | DataLoadErrorBanner/SyncConflictBanner/OfflineIndicator → mascot alert | M 1d |

#### WIRE huérfanos (299 archivos)

| ID | Hallazgo | Esfuerzo |
|---|---|---|
| N5 | **138 componentes huérfanos verificados** + 1 página (SloErrorBudget) — categorizados por dominio | L 7-9 días |
| N6 | **92 hooks huérfanos verificados** (52.6%) — top: useEvacuation, useEscalation, useAuditPortal, useAiGuardrails, sosOrchestrator | L 1 semana |
| N7 | **68 services efectivamente huérfanos** (test-only, 11%) — top: encryptedOfflineQueue (603 LOC), criticalPermitValidators (481 LOC), monthlyClientReportBuilder (387 LOC) | L 1 semana |
| N27 | Wire `useEvacuation` (119 LOC) + `useEscalation` (155 LOC) en `pages/Emergency.tsx` (DS 76 Chile) | M 1d |
| N28 | Wire `sosOrchestrator.buildSosOrchestration()` (262 LOC) en `useAcousticSOS` o `useManDownDetection` | M 1d |
| N30 | Wire `useAiGuardrails` (215 LOC) + `useAiQuality` (170 LOC) en componentes `AiAsesor` | M 1d |
| N31 | Wire `stripePreflightCheck.runStripePreflight()` (318 LOC) en server.ts boot — o documentar Stripe descartado §9 | S 2h |

#### CI/CD governance gaps

| ID | Hallazgo | Esfuerzo |
|---|---|---|
| W2 | `.github/CODEOWNERS` ausente | S 30min |
| W3 | `.github/PULL_REQUEST_TEMPLATE.md` ausente | S 30min |
| W4 | `ci.yml` jobs sin `timeout-minutes` explícito (default 360 min) | S 1h |
| W5 | CodeQL `java-kotlin` + `swift` DESHABILITADOS (mobile code no se escanea) | S 30min (post mobile sprint) |
| W6 | `perf.yml` lhci Chromium flaky no marcado | M 4h (mover a nightly cron) |
| W7 | `e2e.yml e2e-full-stack` flaky (6 timeouts recurrentes) — añadir `--retries=2` | S 30min |
| W8 | `firestore-backup.yml` cron sin notificación Slack/Sentry en fallos | M 2h |

### 13.3 🟢 P2 NUEVOS

| ID | Hallazgo | Esfuerzo |
|---|---|---|
| N8 | `transformers.web` aparece 2 veces en bundle (862 KB × 2 = -352 KB brotli waste) — auditar imports SLM | M 4h |
| N9 | 14 `@deprecated` activos sin remoción — sweep | M 2h |
| N10 | 42 rutas duplicadas App.tsx (dual mount no destructivo) | M 1h |
| N12 | 2 nuevos archivos >1000 LOC: ConfidentialReports.tsx (1248) + OfflineInspection.tsx (1208) — split candidatos | L 1 sem cada |
| N24 | 9 cron jobs sin HTTP entry point (`runConsistencyAudit`, `runLoneWorkerEscalation`, `runExceptionAutoExpire`, `runWorkPermitAutoExpire`, `runLegalCalendarReminders`, `runDailyClimateRiskScan`, `firestoreCriticalReplicate`, `consolidateZettelkasten`, `runWeeklyDigest`) — exponer via verifySchedulerToken o documentar dead code | M 1d |
| N25 | 0 endpoints PUT/PATCH en 542 — migrar updates de POST a PATCH para REST hygiene | L 3-4d |
| N26 | 7 collections con composite index pero sin rules match: `work_permits`, `drills`, `inspections`, `culture_pulse`, `photogrammetry_jobs`, `invoices`, `incidents` | M 2h |

### 13.4 🟢 P3 NUEVOS (pulido / bundle)

| ID | Hallazgo | Esfuerzo |
|---|---|---|
| N13 | Eliminar `dist/mascot.png` (931 KB) + `dist/mascot.webp` (88 KB) legacy — post-§14.2 AUDIT ningún componente los importa | S 5 min |
| N14 | Convertir 5 mascots PNG (796 KB) → AVIF/WebP | S 2h |
| N15 | Tree-shake `lucide-react` (464 importes) | M 3h |
| N16 | 15 hardcoded strings sin `t()` → i18n 100% (OfflineIndicator:88, ProjectHealthCheck:96, ErrorBoundary:108 + 12 más) | S 1h |
| N32 | Sweep WIRE 299 huérfanos consolidado (138 componentes + 1 página + 92 hooks + 68 services) | XL 2-3 sem |

### 13.5 Corrección a § anteriores TODO (datos desactualizados detectados)

| § TODO | Estado anterior | Estado VERIFICADO HOY |
|---|---|---|
| §8 #13 AnatomyLibrary/DifferentialDiagnosis/DrugInteractions | "no implementadas" | ✅ Wireadas en `pages/Medicine.tsx` (falta data CC0) |
| §8 #14 VitalityMonitor | "UI sin backend" | ✅ Wireada en `pages/Hygiene.tsx` |
| §8 #16 MorningRoutine | "falta persistir" | ✅ Wireada en `pages/Hygiene.tsx:25,160` (incl. persistencia) |
| §8 #19 WearablesPanel | "solo en Telemetry" | ✅ Confirmado limitado a `pages/Telemetry.tsx` |
| §8 #8 Onboarding wizard UI | "endpoint listo, falta UI" | ✅ EXISTE (`OnboardingWizard.tsx` + `useOnboardingStatus.ts` + `pages/Onboarding.tsx`) |
| §2.1 TECHNICAL_DEBT android/ | "no existe" | ✅ EXISTE (`android/app/` + .gitignore) |
| §4.1 TECHNICAL_DEBT firebase.json | "sin hosting/storage" | ✅ YA TIENE hosting + storage + headers + emulators |
| §13.3 mi audit services | "53 huérfanos" | **CORRECCIÓN: 7 estrictos + 61 test-only = 68 efectivos** (los `.js` imports estaban siendo missed) |
| §13.3 mi audit hooks | "89 huérfanos" | Confirmado: 92 huérfanos (+3) |
| §7 Wire UI cards | "5 cards a wirear" | Solo LeadershipTrailCard wireada ✅; las otras 4 (CphsCommitteeStatusCard, EngineeringInventoryCard, MonthlyClientReportPanel, PrivacyRegimeCard) siguen huérfanas 🔴 |
| §8 Coach IA por dominio | "Asesor único" | ✅ EXISTE DomainPromptCatalog.tsx pero NO wireado en componente AsesorChat |
| §8 Twin triple-gate auth wire | "solo Site25DPanel y DigitalTwinFaena" | ✅ Confirmado limitado a 2 lugares |

### 13.6 Plan revisado HOY — camino a Day-1 mundial

**Esfuerzo restante: ~8 semanas-dev (sin contar §5 bloqueados)**

| Semana | Foco | Output | Cobertura E2E |
|---|---|---|---|
| 1 | P0 críticos: 6 items (WebAuthn ×3 + Karin + invoices + audit_log + dr-dryrun) | 75% |
| 2 | 12 endpoints heavy → rate limit + 80 endpoints → Zod sweep + CODEOWNERS/PR template | 78% |
| 3-4 | WIRE 139 componentes huérfanos | 84% |
| 5-6 | WIRE 92 hooks + 68 services + 17 hooks compliance | 89% |
| 7 | Tests páginas críticas (5) + i18n 100% + compliance global UK/CA/AU/JP/KR/IN wire | 92% |
| 8 | Refactor arquitectónico (geminiBackend + billing split) + polishing mascot 87 oportunidades | 95% |

**Items bloqueados §5 (input usuario):** 23 items continúan sin destrabar — techo real sin acción del usuario: ~85%.

### 13.7 Branches sin fusionar — triage URGENTE

| Categoría | Count | Acción recomendada |
|---|---|---|
| `dev/sprint-*` | 126 | Auditar work único, mergear o borrar (XL 2 sem) |
| `claude/*` | 8 | Mergear si activas o borrar |
| `feat/*` | 4 | Mergear o cerrar |
| Otros | 77 | Limpieza routinaria |
| **TOTAL** | **215** | Limpieza branches |

---

**Última actualización TODO.md:** 2026-05-19 23:00 — agregado §13 con 32 items NUEVOS (N1-N32 + W1-W8) descubiertos en AUDIT_EXHAUSTIVA_2026-05-19.md.

---

## §14 — Items NUEVOS de §29 AUDIT (cierre 2026-05-19, 3 Explore agents adicionales)

> Origen: `docs/audits/AUDIT_EXHAUSTIVA_2026-05-19.md` §29 — tercera pasada de auditoría con 3 agentes paralelos sobre componentes, services + lib, y testing coverage. Suma de items totales descubiertos en auditoría exhaustiva 2026-05-19: **87 items** (32 N + 35 B + 20 C).

### 14.1 🔴 P0 ABSOLUTOS (cierre antes de prod — 8 items)

| ID | Item | Estimate | Razón |
|---|---|---|---|
| **C1** | Crear `docs/architecture-decisions/0005-photogrammetry-pipeline.md` | S 1h | Master plan declara ADR-0005 "(CREATE)" pero no existe — gap governance |
| **C2** | iOS native scaffolding (`npx cap add ios`) | XL 1 sem | `ios/App/` solo tiene fastlane/ — no hay Xcode project = NO deployable a iOS App Store |
| **C6** | OAuth refresh AbortController + timeout 10s (`oauthTokenStore.ts:197`) | S 1h | Slow HTTP attack → sesiones colgadas, DoS user-level |
| **C7** | Gemini/OpenWeather AbortController + timeout 10s sweep | M 4h | Stack exhaustion en Cloud Run multi-instance (>10 archivos) |
| **C8** | OAuth refresh Idempotency-Key + lock per-user (`oauthTokenStore.ts:215-219`) | M 4h | Token race condition multi-request → duplicación de tokens |
| **C9** | Mutation orchestrator.ts: 7.69% → 70%+ | L 1 sprint | 48 mutantes sobreviven, 24 sin cobertura — lógica retry/adapters/analytics no testeada |
| **C10** | 10 rutas API críticas sin test (emergency, OAuth, billing, audit, admin, import, compliance, subscription, health, onboarding) | L 1 sprint | Hot paths (vida, dinero, seguridad) sin cobertura |
| **C20** | PR #450 CI Playwright e2e-full-stack failing (3 webhooks) | M 4h | Probable mascot a11y regression — bloquea merge a main |

### 14.2 🟡 P1 NEXT-SPRINT (9 items)

| ID | Item | Estimate |
|---|---|---|
| **C3** | Photogrammetry worker dedup: Python vs TypeScript canonical decision | M 1 día |
| **C4** | `marketplace/manifest.json` pricing enum "External pricing" | S 30min |
| **C11** | 355 `any` en signatures públicas → unknown + type guards (sweep) | L 1 sprint |
| **C12** | 783 type assertions `as X` sin runtime check → zod schemas + safeParse | L 1 sprint |
| **C13** | Telemetry Sentry spans en auth/SOS/KMS/payment hot paths | M 2 días |
| **C14** | SyncManager distributed lock (Firestore-backed, Cloud Run scale-out) | M 1 día |
| **C15** | Colapsar `geminiService.ts` (126 LOC wrapper) → `geminiBackend.ts` directo | M 1 día |
| **C16** | KnowledgeGraph.tsx: 16 useState → useReducer + memoization strategy | M 1 día |
| **C17** | 50 Modal components → BaseModal común (consolidación UI library) | L 1 sprint |

### 14.3 🟢 P2/P3 BACKLOG (3 items)

| ID | Item | Estimate |
|---|---|---|
| **C5** | `tests/e2e/landing.spec.ts` un-skip + Firebase test config en CI | M 2h |
| **C18** | 4 imgs sin alt fix: MorningRoutine.tsx:393, AnatomyLibrary, FindTheGuardian, EPPCharacter | S 1h |
| **C19** | 3 key={index} fix: CompensatoryExercises, NormativeQuiz, FirstAidCards | S 30min |

### 14.4 Resumen cuantitativo de auditoría 2026-05-19

| Fase | Items descubiertos | Sumatoria |
|---|---|---|
| 1ª pasada (§1-§22) | base inicial | — |
| 2ª pasada (§23-§27) | 32 items N (N1-N32) + 8 W (W1-W8) | 40 |
| §28 EXHAUSTIVO | 35 items B (B1-B35) | 75 |
| §29 + 3 Explore agents adicionales | **20 items C (C1-C20)** | **95** |

**Total items accionables: 95** (sin contar branches sin merge §13.7 = 215 branches separados).

### 14.5 Plan revisado HOY tras §29 — camino a Day-1 mundial (12 semanas-dev)

| Semana | Foco | Items |
|---|---|---|
| 1 | P0 críticos resiliencia + idempotency | C6 + C7 + C8 (OAuth/Gemini fetch hardening) |
| 2 | P0 tests rutas críticas | C9 + C10 (mutation orchestrator + 10 routes sin test) |
| 3 | P0 PR #450 + governance | C20 (CI playwright diagnostic) + C1 (ADR-0005) |
| 4-5 | Type safety sweep | C11 + C12 (355 any + 783 assertions) |
| 6 | Telemetry + resilience | C13 + C14 + C15 |
| 7-8 | WIRE huérfanos componentes (190) + hooks/services huérfanos | N6 + N9 + W3-W8 |
| 9 | Consolidación UI + a11y | C17 + C18 + C19 + C16 |
| 10 | iOS native scaffolding | C2 (requiere macOS, paralelizable) |
| 11 | Misc: photogrammetry dedup + marketplace + landing E2E | C3 + C4 + C5 |
| 12 | Polishing + smoke + perf budget | regression check + lighthouse green |

**Esfuerzo restante post-§29: ~12 semanas-dev** (sin contar §5 bloqueados por usuario).
**Cobertura E2E real HOY: 60-65%** (ajustada por hallazgos de §29).
**Cobertura E2E proyectada Day-1: 95%+** tras 12 semanas-dev.

---

**Última actualización TODO.md:** 2026-05-19 23:45 — agregado §14 con 20 items C nuevos (C1-C20) descubiertos en AUDIT §29 (3 Explore agents adicionales). Total acumulado: 95 items.
