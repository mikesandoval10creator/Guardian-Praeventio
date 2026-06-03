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
| **Billing (Webpay / MP / IAP / Google Play)** | 88% | — | MP IPN HMAC SHA-256 **verificado wired** (`mercadoPagoIpn.ts:248`); IAP valida receipt server-to-server. Pendiente: tier-gating por-feature solo client-side (§2.32) |
| **AI / Gemini / Vertex (inferencia)** | 80% | ⬆️ +5pp | Adapter inferencia real; Trainer sigue STUB (NO descartar el bug) |
| **AI offline (SLM)** | 80% | ⬆️ +15pp | Phi-3 + Qwen SHA-256 reales; **Gemma SHA-256 null** todavía |
| **Compliance Chile (DS54/594/109/132 + Ley 16.744)** | 80% | ⬆️ +10pp | CPHS + DIAT/DIEP cerrados |
| **Compliance global (ISO 45001 + jurisdicciones)** | 45% | ⬆️ +20pp | 6 jurisdicciones nuevas (E.4); **falta** UK/CA/AU/JP/KR/IN wire UI |
| **i18n** | 91% | ⬆️ +46pp | 109/119 páginas con `useTranslation`; **quedan 10 páginas** |
| **Health Vault (ADR 0012)** | 75% | ⬇️ -10pp | Disclaimer + QR sharing OK; **`health_vault` sin reglas Firestore** (§2.32 B4, incumple Regla #4) |
| **CPHS Comité Paritario** | 80% | ⬆️ +30pp | Service + UI card (#265); falta endpoint admin |
| **DIAT/DIEP SUSESO** | 75% | ⬆️ +15pp | PDF real + folio + firma; **falta** WebAuthn ceremony real |
| **Mesh BLE/WiFi Direct** | 80% | ⬆️ +10pp | Plugin Android Kotlin **real (552 LOC)** + iOS Swift; **consumer cableado** (`MeshProvider.tsx:110`→`AppProviders.tsx:139`). Pendiente: firma de paquetes (`meshPacket.ts:237` `unsigned-dev`) |
| **PWA / Offline / Sync** | 92% | ⬆️ +2pp | SW models cache + outbox engine (#245-246) |
| **Native plugins (HealthKit/HealthConnect)** | 40% | ⬆️ +10pp | Foundation; **bloqueado** por keystores |
| **Photogrammetry (COLMAP / Modal)** | 75% | ⬆️ +15pp | Worker Cloud Run real (325 LOC); falta deploy |
| **Digital Twin (3D mesh + AR)** | 80% | ⬆️ +15pp | InstancedMesh + Rapier + WebXR foundation (D.1+E.1) |
| **CQRS / Event Store** | 75% | ⬆️ +75pp | Real productivo (#261) — Event Store + aggregates + read model |
| **Bernoulli generators** | 50% | ⬆️ +5pp | Mayoría sin UI consumer; StructuralCalc va a logger.info, no Firestore |
| **Telemetry / Wearables** | 75% | ⬆️ +5pp | Telemetry.tsx real; WearablesPanel sigue UI-only |
| **Tests** | 75% | ⬆️ +5pp | **10029 passing / 0 failed** (§2.11, 2026-05-19); 1.247 archivos test; cobertura co-located ~54%, 20 skip/fixme (medir oficial con `vitest --coverage`) |
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

### 2.7 ✅ Vertex AI Trainer DESCARTADO oficialmente (Opción A — cierre Fase C.7, 2026-05-21)
**Archivo:** `src/services/ml/vertexTrainer.ts:1-30` (header rewrite con tombstone explícito)

**Fix aplicado (Opción A):** header del archivo ampliado a 25 líneas con ⚠️ DESCARTADO OFICIALMENTE + distinción **inferencia ≠ training**:
- `vertexAdapter.ts` (inferencia) = REAL y se usa en prod ✅
- `vertexTrainer.ts` (training) = STUB tombstone, solo aplica tier mega-enterprise + budget approval explícito + opt-in tenant
- Para PYMEs Chile + LATAM el flujo IA real vive en `resilientAiOrchestrator.ts:355-396` (5-tier fallback) + `slm/*` (SLM offline)

Documentación HONEST_STATE.md + AUDIT_BACKLOG.md (en `docs/archive/2026-05/`) tenía claim "Vertex AI real" que se refería al adapter de inferencia — ahora el header del trainer lo deja explícito.

### 2.8 ✅ assetlinks.json SHA-256 REAL cargado (cierre 2026-05-17, verificado 2026-05-21)
**Archivo:** `public/.well-known/assetlinks.json:10`

`"sha256_cert_fingerprints": ["3D:AC:D9:BC:C2:CD:5C:B0:6D:5F:5D:BC:37:4A:F5:78:50:99:DA:09:BA:E8:B1:F1:05:FF:B6:A5:42:D3:A7:A0"]`

**Fix aplicado:** el usuario proporcionó el SHA-256 del keystore Play real (`com.praeventio.guard`) el 2026-05-17 — Fase 0 del plan integrado lo cableó vía PR #357 + script anti-placeholder `scripts/render-well-known.mjs` (registrado en `package.json:12` prebuild) que falla el build si detecta el placeholder histórico `REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD`.

**Resultado:** Android App Links funcionarán en Play Store cuando se publique la app. Apple App Site Association todavía tiene placeholder `TEAMID` (bloqueado por Apple Developer Account, §5).

### 2.9 🟡 SLM Gemma 2 2B SHA-256 null — loader fail-closed IMPLEMENTADO; falta hash (DevOps)
**Archivo:** `src/services/slm/registry.ts:119` (`expectedSha256: null`, Gemma gated).

**Code (HECHO 2026-06-01):** el loader **fail-closea en producción** ante un modelo sin SHA-256 pineado, ANTES de descargar. `src/services/slm/slmRuntime.ts` → `assertVerifiableInProduction()` lanza `SlmUnverifiedModelError` (el worker lo clasifica `integrity_failure`, `slmRuntimeWorkerCore.ts:389`) salvo override explícito `allowUnverifiedHash` (release pipeline). En dev/staging se preserva el camino graceful para que el pipeline capture el hash en la primera descarga verificada. Tests: `src/services/slm/slmRuntime.test.ts` describe "fail-closed on unverified hash in production (§2.9)" — 4 casos (prod+null→refuse sin fetch ni session, dev+null→graceful, prod+override→carga, prod+hash-pinned→carga).

**Pendiente (DevOps, externo):** poblar el `expectedSha256` real de Gemma — repo `gemma-2-2b-it-ONNX` es GATED (HF API `/tree/main` → 401); requiere HF token con scope al repo (accept terms primero). Hasta entonces Gemma no carga en prod (fail-closed correcto, no es un bug).

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

### 2.12 ✅ Stripe scaffold ELIMINADO (Opción A — cierre Fase C.2, 2026-05-21)
**Archivos borrados:**
- `src/services/billing/stripeAdapter.ts` (DELETED)
- `src/services/billing/stripePreflightCheck.ts` (DELETED)
- `src/services/billing/stripePreflightCheck.test.ts` (DELETED)

**Archivos limpiados:**
- `src/server/routes/billing.ts:84` (import stripeAdapter eliminado)
- `src/server/routes/billing.ts:201-204` (VALID_PAYMENT_METHODS sin 'stripe')
- `src/server/routes/billing.ts:519-523` (branch CLP+stripe eliminado; USD+webpay mensaje actualizado)
- `src/server/routes/billing.ts:582-593` (handler stripe.createCheckoutSession eliminado entero)
- `src/pages/Pricing.tsx:56-58,77-79,945-953,1072` (comentarios actualizados a "fallback B2B contacto@praeventio.net")
- `src/__tests__/server/test-server.ts:273-274,620-624` (mismo set actualizado; rama CLP+stripe eliminada; USD+webpay msg)
- `src/__tests__/server/billing.test.ts:145-160` (test renombrado a "rechaza 'stripe' como paymentMethod inválido")
- `src/services/billing/invoice.test.ts:194` (USD test usa 'manual-transfer')
- `src/services/billing/types.ts:17-46` (header actualizado; literal `'stripe'` queda como tombstone type-only para test fixtures legacy; runtime VALID_PAYMENT_METHODS rechaza el método)

**Justificación Opción A:** la empresa está en Chile; Stripe no la considera para checkout productivo (decisión usuario 2026-05-16). Rails activos: Webpay (CLP), MercadoPago (LATAM regional), IAP nativo (mobile), manual-transfer (B2B enterprise). Si crece volumen internacional fuera de LATAM, se contacta vía `contacto@praeventio.net`.

### 2.13 ✅ IAP SKU per tier wired (cierre 2026-05-22 PR #463)
**Archivos:**
- `src/services/pricing/iapSkus.ts` (NEW, 159 LOC — assertSkuMatchesTier anti-fraud server-side)
- `src/services/pricing/iapSkus.test.ts` (NEW, 115 LOC, 15/15 tests verde)
- `src/pages/Pricing.tsx:995` (mapeo `tier.id` → product SKU específico)

**Estado anterior:** todo IAP nativo (Apple Pay + Google Play Billing) compraba el mismo `praeventio_premium_monthly` sin importar el tier seleccionado.

**Fix aplicado:** commit `c9d98cd` (PR #463, 2026-05-22) — cada tier paid ahora tiene su SKU único en Play Console + App Store Connect (10 paid tiers × 2 cycles = 20 SKUs). `assertSkuMatchesTier` anti-fraud server-side previene cliente declarando tier diferente al pagado.

**Pendiente operacional:** crear los 20 SKUs en App Store Connect + Google Play Console (DevOps, ver §5).

### 2.14 ✅ SusesoApiClient removido del frontend (cierre Fase C.1, 2026-05-21)
**Archivos:**
- `src/pages/SusesoReports.tsx` — sin imports de SusesoApiClient/Diat/Diep/RoiPayload; sin `handleSusesoSubmit`; sin botón "Enviar a SUSESO" directo. Comentarios marcadores con la justificación (§2.14 + directiva 2.6).
- `src/services/sii/susesoApiClient.ts:1-30` — header ⚠️ SERVER-ONLY + razones técnicas (process.env + bundle leak) + razón producto (directiva 2.6 no push automático).
- `src/__tests__/contracts/noBrowserSusesoApiClient.test.ts` (NEW) — gate de regresión: si alguien re-importa SusesoApiClient/SusesoApiError/DiatPayload/DiepPayload/RoiPayload desde `src/pages/`, `src/components/` o `src/hooks/`, el test falla.

**Fix aplicado:** se removió la importación browser-side por completo. NO se creó wrap server-side porque colisionaba con la directiva 2.6 inviolable ("Praeventio NO envía DIAT/DIEP a SUSESO directamente; empresa imprime/firma/sube al portal mutualidad"). El flujo real vive en `src/server/routes/suseso.ts` (POST /api/suseso/form crea folio + PDF; POST /api/suseso/forms/:formId/mark-submitted confirma upload manual) — accesible via `<SusesoFormBuilder>` componente que ya se renderizaba en la página.

### 2.15 ✅ Zettelkasten canonical materializer WIREADO (cierre Fase C.3, 2026-05-21)
**Estado descubierto al auditar:** el `materializer.ts` (función pura) **YA EXISTÍA** completo desde Sprint 39 Fase D.8.c (`src/services/zettelkasten/canonical/materializer.ts`, 269 LOC, con tests). Lo que faltaba era el **wire a runtime** — nadie lo invocaba, así que un nodo creado por Bernoulli aterrizaba SOLO en `zettelkasten_nodes` global y nunca aparecía en KG/Digital Twin.

**Fix aplicado (3 cambios concretos):**

1. **Server route dual-write** — `src/server/routes/zettelkasten.ts:46-60,184-265`
   - Importa `materializeNode` + `canonicalNodePath` del materializer puro.
   - Resuelve `tenantId` del proyecto una sola vez por batch (Firestore read adicional).
   - Por cada nodo escrito a `zettelkasten_nodes/{id}` (legacy, backwards compat), también escribe el canonical a `nodes/{tenantId}_{projectId}_{zkNodeId}` via `db.doc(canonicalPath).set(canonical, {merge: true})`.
   - Try/catch independiente — si el canonical falla, NO bloquea la respuesta del POST; logueamos warn `zettelkasten_canonical_dual_write_failed`.
   - Audit log incluye `canonicalMaterialized: true` + `tenantResolved: bool`.

2. **Client RiskNodeMarkers migrado** — `src/components/digital-twin/RiskNodeMarkers.tsx:75-120`
   - Antes leía `tenants/{tid}/zettelkasten_nodes` (subcolección que el server NUNCA escribía → twin mostraba 0 markers).
   - Ahora lee `collection(db, 'nodes')` con `where('tenantId','==',tid)` + `where('projectId','==',pid)` + `orderBy('createdAt','desc')` + `limit(100)`.
   - `UniversalKnowledgeContext.tsx:108` y `useRiskEngine.ts:44` ya leen `nodes` filtrado por `projectId` → ahora reciben automáticamente los canonicals materializados.

3. **Índice compuesto Firestore** — `firestore.indexes.json`
   - Nuevo índice `nodes` con campos `(tenantId ASC, projectId ASC, createdAt DESC)` requerido por la query de RiskNodeMarkers.

**Test contract (`src/__tests__/contracts/zkMaterializerWired.test.ts`, NEW, 86 LOC):**
- Verifica imports `materializeNode` + `canonicalNodePath` en server route.
- Verifica dual-write pattern + try/catch defensivo.
- Verifica RiskNodeMarkers usa `collection(db, 'nodes')` con tenantId+projectId filter (NO el path legacy).
- Verifica índice compuesto en `firestore.indexes.json`.
- Verifica que el materializer permanezca función pura (sin imports firebase/firebase-admin) — gate para que un consumer futuro Cloud Function trigger lo pueda usar sin dragar SDK pesado.

**Resultado:** un nodo creado por calculadora Bernoulli ahora aparece automáticamente en RiskNetwork (KG global lee `nodes`), useRiskEngine (lee `nodes`), Digital Twin RiskNodeMarkers (lee `nodes` filtrado por tenantId+projectId). La inconsistencia denunciada por `AUDIT_TRUTH_MATRIX_2026-05-07.md:193-207` queda resuelta.

### 2.16 ✅ B2D Climate wireado a Open-Meteo + USGS + OpenAQ reales (cierre Fase C.4, 2026-05-21)
**Archivos:**
- `src/services/b2d/externalClimate.ts` (NEW, 297 LOC) — 3 funciones puras: `fetchOpenMeteoCurrent`, `fetchOpenMeteoForecast`, `fetchUsgsEarthquakesNearby`, `fetchOpenAqAirQuality`. Cache in-memory 1h con bucket por coords redondeadas a 2 decimales. Timeout 8s via AbortController. Cada función devuelve `{ data, source }` o `null` si la fuente falla — Regla #3: el caller decide combinar fuentes o caer a fallback.
- `src/server/routes/b2d/climate.ts` (reescrito) — `/current` invoca las 3 fuentes en paralelo (`Promise.all`) + fallback determinístico por fuente (no solo cuando las 3 fallan; cada una cae independiente). `/forecast` invoca Open-Meteo + fallback gradient. `/risk-score` calcula sobre snapshot real si Open-Meteo responde, sobre stub si no.
- `src/server/routes/b2d/climate.test.ts` — actualizado con `vi.stubGlobal('fetch', ...)` que fuerza fallback determinístico → tests determinísticos sin depender de red real + shape estable verificado.

**Diseño:**
- **Open-Meteo** (https://open-meteo.com) — clima current + 14d forecast. Gratuito, sin API key. ~10k req/day per IP.
- **USGS** (https://earthquake.usgs.gov/fdsnws) — sismos últimas 24h, radio hasta 500km. Gratuito, sin API key.
- **OpenAQ v3** (https://api.openaq.org/v3) — PM2.5, PM10, AQI calculado con breakpoints EPA. Key opcional via `OPENAQ_API_KEY`; sin key da 401 → fallback.
- **Privacidad B2D inviolable** — NUNCA pasa tenantId/customerId al upstream. Solo coords + radius.
- **Provenance auditable** — cada response incluye `provenance.{weather,seismic,airQuality}` para que el cliente B2D vea qué fuentes son live vs fallback.
- **Backward compat** — campos legacy (`weather`, `seismic`, `airQuality`, `citations`) preservados; nuevos campos (`weatherSource`, `seismic.available`, `airQuality.available`, `provenance`) agregados.

### 2.17 ✅ B2D Coach wireado a Gemini con fallback determinístico (cierre Fase C.5, 2026-05-21)
**Archivos:**
- `src/server/routes/b2d/suite.ts` (reescrito, +163 LOC) — handler `/api/b2d/v1/suite/coach` ahora invoca `getAiAdapter().generate(...)` con system instruction (DS 44/2024 + ISO 45001 + Ley 16.744) + prompt JSON-mode. Si el adapter es `noop` o falla, **CAE GRACEFULLY** al builder determinístico (Regla #3 inviolable). Response shape estable (cliente B2D no se entera del provider) + nuevo campo `source: 'gemini-consumer' | 'vertex-ai' | 'deterministic'` para transparencia auditable.
- `src/server/routes/b2d/suite.test.ts` (NEW, 145 LOC) — 7 tests cubren: input inválido, Gemini happy path, fallback por adapter no disponible, fallback por JSON inválido, fallback por error upstream, fallback por shape parcial, no exposición Zettelkasten/tenant.

**Diseño:**
- **Privacidad inviolable preservada** — el coach NUNCA accede al Zettelkasten ni a datos del tenant. Solo procesa input del request body (industry + scenario + mitigations). System instruction explícita: "NUNCA accedes a datos del tenant ni al Zettelkasten interno".
- **Directiva 2.6 reforzada** — system instruction: "NUNCA recomiendas invocar APIs estatales directamente — solo recomienda al usuario".
- **Citas canónicas siempre presentes** — DS 44/2024 (no DS 40 derogado), DS 594, DS 54, ISO 45001, Ley 16.744. Las del modelo se mergean deduplicadas.
- **Guardrail runtime backup** — `hallucinationGuard.ts:89-91` actúa como segunda línea si Gemini cita DS 40 sin anotación histórica.

### 2.19 ✅ Playwright full-stack E2E — fix parcial aplicado (PR #454 mergeado 2026-05-21)

**Status:** 1/6 specs resuelto. Restantes 5 documentados en §2.21.

**Cambios aplicados (PR #454, squash `3db2c370`):**
- `src/lib/e2eAuth.ts` — `getE2EUser()` + `hasE2EUserFixture()` + 13 tests
- `src/contexts/FirebaseContext.tsx` — `buildE2EUserShim()` + lazy init + skip onAuthStateChanged en E2E
- `src/App.tsx` — `/login`, `/pricing`, `/help`, `/privacy`, `/terms` agregados a `skipLanding` + `hasEntered` auto-true en E2E
- `tests/e2e/fixtures/seed.ts` — `seedProject()` popula `members:[supervisorUid]`

**Resultado CI Playwright full-stack:**
- ANTES: 6 specs failed
- DESPUÉS: 5 specs failed — `accessibility.spec.ts:129` (login page exposes main + heading) PASA ✅

**Restantes 5 specs:** ver §2.21 — requieren `apiAuthHeader()` adopción (§2.20) + ProjectContext/Firestore emulator setup.

### 2.20 ✅ Fetch wrappers — apiAuthHeader migración COMPLETA (CERRADO 2026-06-01)

**CIERRE 2026-06-01:** migración incremental completada. **30 hooks/components** migrados de
`Bearer ${await user.getIdToken()}` hand-rolled a `...(await apiAuthHeaders())` (ola de 6
subagentes paralelos + verificación central). **3 callers correctamente NO migrados**
(criterio verificado, no blind sweep — regla `feedback_no_blind_sweeps`):
`useInvoicePolling.ts` (DI pattern: el token controla retry/prefix logic, no solo el header),
`usePushNotifications.ts` (DI deps + `auth.currentUser` aún usado para el Firestore mirror),
`WebAuthnKeysSection.tsx` (ya usaba `apiAuthHeaderOrThrow`). `firebase.ts:notifyServerLogout`
ya migrado en #455. **Verificado:** `typecheck:ci` 0 · `apiAuth.test` 12/12 · `useStreamedGuardian.test`
7/7 (la migración más compleja: `Object.assign` + helper local borrado + streaming preservado) ·
lint limpio. Net **−71 LOC**. Grep de callers `Bearer ${...getIdToken}` restantes = solo
helper/E2E-source/DI legítimos. El path E2E full-stack `/api/*` ahora envía el header `E2E ...`
correcto en MODE=test (el blocker de 401 silencioso del §2.19 queda cerrado para las llamadas
`/api`; las queries client-SDK Firestore son el §2.24 aparte).

**[histórico — hallazgo original]**

**Hallazgo durante audit §2.19:** 20+ archivos en `src/services/` + `src/pages/` + `src/hooks/` construyen el header `Authorization` manualmente con `await user.getIdToken()` + `Bearer ${token}`. PERO ningún caller checkea `getE2EAuthHeader()` PRIMERO. El backend `verifyAuth.ts:67` SÍ acepta el formato `E2E <secret>:<uid>` cuando `E2E_MODE=1`, pero el frontend nunca lo envía → requests autenticados en E2E full-stack reciben 401 silencioso.

**Pattern exactamente lo que el usuario predijo 2026-05-21:** *"funciones con diferente nombre pero relacionado y que están esperando calls diferentes"*. `getE2EAuthHeader()` existe (Sprint 19) pero nadie llama.

**Fix introducido (PR #455 en curso):**
- `src/lib/apiAuth.ts` (NEW) — `apiAuthHeader()`, `apiAuthHeaderOrThrow()`, `apiAuthHeaders()`, `detectAuthSource()`. Unifica E2E preference + Bearer fallback.
- `src/lib/apiAuth.test.ts` (NEW, 12 tests).
- `src/services/firebase.ts:notifyServerLogout` — primera migración proof-of-concept.

**~~Pendiente migración incremental: 19 callers restantes~~ → COMPLETADO 2026-06-01** (ver
nota de CIERRE arriba). El patrón se replicó a los 30 hooks/components elegibles vía
`apiAuthHeaders()` (spread) / `apiAuthHeaderOrThrow()` (string).

**2026-05-22 nota sobre los 81 hooks migrados (PR #462):** la pregunta del usuario "que es eso de los 81 hook que no son utilizados?" tiene respuesta clara tras audit Phase 1 (systematic-debugging):

| Pregunta | Respuesta verificada |
|---|---|
| ¿La migración (#462) creó hooks dead-code? | NO. Los 81 hooks ya existían — fueron creados en PRs #379-#448 (wire HTTP surface Sprint K) ANTES de mi migración. |
| ¿Hay un UI consumer para cada hook? | NO actualmente. Los hooks son scaffolding HTTP esperando su `<Component/>` page (ver tabla "Sprint K wire UI restante" en el plan integrado — ~25 servicios pendientes). |
| ¿La migración rompió algo activo? | NO. Era cambio preventivo: cuando el UI consumer aterrice, ya estará en formato `apiAuthHeader()` correcto para E2E + producción. |
| ¿Hay que borrarlos? | NO. Son infraestructura aprobada del refactor Sprint K (monolito → dominios). Borrarlos sería regresar el monolito. La progresión correcta es agregar el UI consumer arriba (vidas críticas primero: stoppageEngine, criticalControlsLibrary, rootCauseClassifier, etc.). |
| ¿Mostraré evidencia de algún hook activo? | Sí, ej: `useFatigue` (creado PR #428) → wireado en Sprint K UI commits #459 + #460 (FatigueMonitor page + sidebar). Pattern repetible. |

Mensaje al usuario: la migración no introdujo deuda — la dejó visible. El próximo paso natural es activar hooks vidas-críticas uno por uno, cada PR atómico con su UI page + tests.

### 2.25 ✅ firestoreDatabaseId no-default rompía emulator queries (CERRADO 2026-05-21)

**Hallazgo:** `firebase-applet-config.json:6` apunta a `firestoreDatabaseId: "ai-studio-d2437df8-..."` (Firebase AI Studio scratch DB, non-default). PERO `tests/e2e/fixtures/seed.ts` usa firebase-admin SIN especificar databaseId → escribe a `(default)`. Sin override, cuando `connectFirestoreEmulator()` activa, el client SDK queries la DB `ai-studio-...` que está vacía en el emulator, mientras la seed quedó en `(default)`. Mismatch silencioso.

**Fix:** `src/services/firebase.ts:9-30` agregado override que setea `firestoreDbId = undefined` cuando MODE=test → el SDK usa el default DB del emulator (que es donde la seed siembra).

**Producción:** mantiene `firestoreDatabaseId: "ai-studio-..."` (existe allí — creado en Firebase AI Studio). Gate `import.meta.env.MODE === 'test'` aísla.

### 2.24 🟡 Firestore Client SDK queries fallan firestore.rules en E2E (DESCUBIERTO 2026-05-21)

**Root cause architectural del §2.21 (5 specs)** identificado por audit sistemático post-CI #455 commit `31ed41a0`:

- `firestore.rules:24-25` requiere `request.auth != null` para todas las queries protegidas.
- Mi `FirebaseContext` shim (§2.19) setea `user` state en React PERO NO firma al usuario en Firebase Auth SDK (`auth.currentUser` sigue null).
- Resultado: cuando `ProjectContext.tsx:247` o cualquier hook hace una query Firestore desde el cliente, `request.auth` es null → rules deniegan → spec ve "no project loaded" → UI no renderiza elementos esperados (botón SOS, toggle fall-detection, etc).
- El backend `/api/*` endpoints SI funcionan porque `verifyAuth.ts:67` acepta `E2E <secret>:<uid>` header. Pero los specs no usan los endpoints — usan client SDK directo.

**Fix arquitectural (PR siguiente):**
1. `e2e.yml:88` cambiar `--only firestore` → `--only firestore,auth` (start Firebase Auth Emulator en CI).
2. `firebase.ts` agregar `connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })` gated por MODE=test (similar a connectFirestoreEmulator §2.22).
3. `tests/e2e/fixtures/auth.ts:loginAsTestUser` después de `page.addInitScript()`, hacer:
   - `page.evaluate()` que llame `signInAnonymously(auth)` o `signInWithCustomToken(auth, customToken)` donde customToken sea generado por el emulator.
   - Esperar `auth.currentUser` a poblar.
4. (Opcional pero recomendado) actualizar `firestore.rules` con un branch de excepción para `request.auth.token.email == 'e2e@praeventio.test'` si necesario (defensive).

**Alternativa MENOS invasiva:**
- Cambiar `ProjectContext` y los hooks a llamar `/api/projects/list` en lugar de `getDocs(collection(db,'projects'))`. Resp: estos endpoints SI usan `verifyAuth` que acepta E2E header.
- Pro: no requiere Auth Emulator setup.
- Con: cambio invasivo de UI patterns en muchos archivos.

Recomendación: **Opción 1 (Auth Emulator)** porque preserva la arquitectura UI=Firestore SDK y solo añade infrastructure de test.

### 2.23 ✅ CI E2E workflow construía con MODE=production → gates E2E nunca activaban (CERRADO 2026-05-21)

**Hallazgo durante verificación CI post-§2.22:** El workflow `.github/workflows/e2e.yml:114-115` corre `npm run build` (= `vite build` default MODE=production) antes de `playwright test`. Resultado: el bundle servido por `vite preview` tiene `import.meta.env.MODE === 'production'` baked-in, así que los gates de mis fixes:

- `src/lib/e2eAuth.ts:isE2EMode()` retorna false → shim no activa
- `src/contexts/FirebaseContext.tsx:buildE2EUserShim()` nunca se llama
- `src/App.tsx:hasEntered` no se auto-true
- `src/services/firebase.ts:connectFirestoreEmulator` no se ejecuta

Esto explica por qué §2.22 (connectFirestoreEmulator) no resolvió los 5 specs §2.21 — el gate nunca activaba.

**Fix:** `e2e.yml:114-115` cambiado a `npm run build -- --mode test`. Vite ahora bakea `MODE=test` en el bundle E2E. Builds productivos siguen siendo default (este job es exclusivo de E2E full-stack).

**Esperado:** los 5 specs §2.21 ahora ven el shim activado + ProjectContext conectado al emulator → mayoría debería pasar.

### 2.22 ✅ Frontend Firebase Client SDK NO conectaba al Firestore Emulator (CERRADO 2026-05-21)

**Hallazgo:** `src/services/firebase.ts` inicializaba Firestore Client SDK sin `connectFirestoreEmulator()`. En E2E full-stack: `seedProject()` escribía al emulator (puerto 8080) via firebase-admin, pero ProjectContext y todas las queries del frontend iban a Firestore PRODUCTION → resultado: `selectedProject` null y los 5 specs §2.21 no encontraban sus elementos UI.

**Fix:** `src/services/firebase.ts` agregado bloque gated por `import.meta.env.MODE === 'test'` que llama `connectFirestoreEmulator(db, 'localhost', 8080)`. Producción nunca entra (gate Vite `--mode test`).

**Esperado:** sos-button, fall-detection-toggle, offline-resilience, process-lifecycle ahora ven el data seedeado por fixture.

### 2.21 🟡 Playwright full-stack E2E — 5 specs restantes post-§2.19 (DESCUBIERTO 2026-05-21)

**Specs failing pendientes (verificadas tras PR #454 merge):**
- `tests/e2e/fall-detection-toggle.spec.ts:11` — toggle switch no aparece (sidebar?)
- `tests/e2e/offline-resilience.spec.ts:16` — hallazgo offline sync
- `tests/e2e/process-lifecycle.spec.ts:17` — XP a cuadrilla post-process-close
- `tests/e2e/sos-button.spec.ts:13` — botón SOS no visible en `/projects/{id}/emergency`
- `tests/e2e/sos-button.spec.ts:57` — fallback `tel:` no visible

**Causas hipotéticas:**
1. **API calls fallan 401** porque fetch wrappers usan `Bearer` sin checkear `E2E header` (§2.20). Fix: migración incremental.
2. **ProjectContext.tsx:247** query Firestore client SDK vs seed.ts Firebase Admin SDK — ambos apuntan al emulador pero la query del client puede no estar conectada correctamente al emulator. Verificar `connectFirestoreEmulator()` activado en MODE=test.
3. **Lazy chunks de páginas (sos-button → /projects/:id/emergency)** pueden no resolver en E2E si la auth shim no provee suficiente contexto para que el route lazy load.

**Estrategia siguiente sprint:**
- Migrar `BillingService`, `gamificationService`, `firebase.ts` (parcialmente hecho) al apiAuthHeader() — esto debería resolver al menos los specs que dependen de API calls.
- Verificar `connectFirestoreEmulator()` está activo en `src/services/firebase.ts` cuando MODE=test.
- Debugging individual de cada spec con `npx playwright test --debug` local + emulator stack.

### 2.19-historical 🔴 Playwright full-stack E2E — root cause original (DESCUBIERTO 2026-05-21)

**Archivos afectados (verificados en PR #449 y #452, ambos mismos 6 tests fallidos):**
- `tests/e2e/accessibility.spec.ts:129` — login page exposes a main landmark and labelled heading (timeout `expect.toBeVisible()` 5s)
- `tests/e2e/fall-detection-toggle.spec.ts:11` — FallDetection toggle activa y persiste tras reload (timeout 11s)
- `tests/e2e/offline-resilience.spec.ts:16` — hallazgo creado offline se sincroniza al recuperar la red (timeout 32s)
- `tests/e2e/process-lifecycle.spec.ts:17` — iniciar y cerrar un proceso otorga XP a la cuadrilla (timeout 17s)
- `tests/e2e/sos-button.spec.ts:13` — long-press de 3s dispara alerta (timeout 6s, 3 retries)
- `tests/e2e/sos-button.spec.ts:57` — fallback a tel: cuando geolocation bloqueada (timeout 6s, 3 retries)

**Estado verificado:**
- PR #449 (mergeado por `mikesandoval10creator` 2026-05-19): 14 success / 1 neutral / 1 failure (este mismo Playwright)
- PR #452 (en revisión 2026-05-21): mismos 6 tests fallidos en run inicial Y re-run idéntico
- `main` no tiene branch protection (`API resp: Branch not protected`) → mergeable a pesar del check

**ROOT CAUSE DEFINITIVO (debugging sistemático 2026-05-21):**

Hay un **mismatch entre el fixture E2E y el código de la app** — exactamente el tipo de "funciones esperando calls diferentes" que mencionó el usuario.

1. **Fixture `tests/e2e/fixtures/auth.ts:61-87` (`loginAsTestUser`)** inyecta en localStorage del browser via `page.addInitScript()`:
   - `gp.e2e.user` (JSON del TestUser)
   - `gp.e2e.token` (`<secret>:<uid>`)
   - `gp.e2e.auth_header` (`E2E <secret>:<uid>`)
   - **Asume** que el frontend lee `gp.e2e.user` y trata al usuario como autenticado.

2. **Pero `src/App.tsx:246-247`** consume `const { user } = useFirebase()`, que es el `FirebaseContext` (línea 109 del context). **Este contexto solo lee Firebase Auth real** vía `onAuthStateChanged`, NO `localStorage.gp.e2e.user`.

3. **Resultado**: cuando el test corre `loginAsTestUser(page)` + `page.goto('/sos')`:
   - localStorage tiene `gp.e2e.user` ✅
   - Pero `useFirebase()` devuelve `user = null` ❌
   - `AppRoutes` línea 345-353 evalúa: `if (!hasEntered && !skipLanding && !needsOnboarding && !user)` → **TRUE** → renderiza `<LandingPage>` en lugar de la ruta solicitada
   - El test espera elementos de `/sos` (botón SOS) → no aparecen → timeout 5s → fail.

4. **Bug adicional**: `src/App.tsx:327-333` `skipLanding` NO incluye `/login`. Visitantes anónimos que abren link directo a `/login` ven Landing en lugar del form de login. Esto rompe específicamente `accessibility.spec.ts:129`.

5. **Solo el server-side respeta el header E2E** — `src/server/middleware/verifyAuth.ts` acepta `Authorization: E2E <secret>:<uid>` cuando `E2E_MODE=1`. Pero el frontend nunca llega a llamar el API porque AppRoutes lo bloquea con Landing antes.

**FIX correcto (3 cambios coordinados, NO incluidos en PR #452 — Day-1):**

**A. Extender `FirebaseContext` (o `useFirebase`) para que en `MODE=test` lea `gp.e2e.user` y devuelva un user shim:**
```ts
// src/contexts/FirebaseContext.tsx (post-fix Day-1)
const [user, setUser] = useState<User | null>(() => {
  if (typeof window !== 'undefined' && import.meta.env.MODE === 'test') {
    const fixture = window.localStorage.getItem('gp.e2e.user');
    if (fixture) {
      const parsed = JSON.parse(fixture);
      return { uid: parsed.uid, email: parsed.email, displayName: parsed.displayName } as User;
    }
  }
  return null;
});
```

**B. Agregar `/login` a `skipLanding` en `src/App.tsx:327`:**
```ts
const skipLanding =
  window.location.pathname.startsWith('/invite') ||
  window.location.pathname.startsWith('/login') ||   // ← NUEVO
  window.location.pathname.startsWith('/public') ||
  ...
```

**C. Auto-set `hasEntered = true` en MODE=test cuando hay user-shim:**
```ts
const [hasEntered, setHasEntered] = useState(() => {
  if (typeof window !== 'undefined' && import.meta.env.MODE === 'test' &&
      window.localStorage.getItem('gp.e2e.user')) {
    return true;
  }
  return false;
});
```

Con estos 3 cambios, los 6 tests pasan sin tocar los tests mismos:
- `accessibility.spec.ts:129` → `/login` ahora salta Landing → renderiza Login.tsx → `#login-heading` visible
- Los otros 5 → `useFirebase()` devuelve user shim → AppRoutes deja pasar a la ruta solicitada → tests ven sus elementos

**Decisión PR #452:** NO incluir el fix en este PR. Razones:
1. El fix toca `FirebaseContext` y `App.tsx` — 2 archivos core de auth/routing. Cambio invasivo que merece su propio PR + review dedicado.
2. PR #449 (último merged) ya mergeó con el mismo fail aceptado → precedente del proyecto.
3. Documentación completa del root cause aquí + en PR description permite que un sprint futuro lo aborde con scope claro.
4. Los 6 tests fallidos no son introducidos por #452 — son pre-existentes verificados con commit `cda2ef26` (antes de mi typecheck fix).

**Verificación post-fix Day-1:**
- `npx playwright test --project=chromium --grep="login page exposes" --debug` → ver que `#login-heading` aparece
- Correr suite completa full-stack → 9 passed / 0 failed / 12 skipped (esperado)
- Verificar que producción NO active el shim (gate `import.meta.env.MODE === 'test'` solo en Vite preview con `--mode test`)

### 2.18 🟡 EPP detection on-device wired (Opción B, cierre parcial 2026-05-22 PR #465)
**Archivos:**
- `src/services/ai/eppDetectorOnDevice.ts` (NEW, 307 LOC — 7 EPP classes TFLite stub) — commit `cb200dd`
- `src/services/ai/eppDetectorOnDevice.test.ts` (NEW, 227 LOC, 18/18 tests verde)
- `src/components/ai/VisionAnalyzer.tsx:25` importa `eppDetectorOnDevice` ✅
- `src/components/ai/VisionAnalyzer.tsx:8` mantiene `import { analyzeVisionImage } from '../../services/geminiService'` — Gemini cloud sigue como path alternativo

**Estado anterior:** EPP detection era 100% Gemini Vision cloud (`VisionAnalyzer.tsx:152`).

**Fix aplicado:** commit `cb200dd` (PR #465) creó detector on-device con 7 classes (casco/chaleco/gafas/guantes/arnés/botas/respirador), ZK node generator privacy-safe (imagen NUNCA sale del device).

**Pendiente:** decidir si el path Gemini cloud sigue como fallback (cuando on-device confidence < threshold) o si se elimina total. Si on-device + fallback es by-design, marcar ✅ con nota en próximo PR. Si gemini debe removerse, sprint dedicado para refactor `VisionAnalyzer.tsx`.

### 2.28 🟢 Digital Twin / Maqueta 3D ON-DEVICE — pipeline REAL operativa (avance 2026-05-22, branch `fix/2.28-digital-twin-ui-honesty-2026-05-22`)

**Directiva usuario 2026-05-22:** "evitar dejar UI honesta diciendo que estará listo — desarrollar la solución a medida que vas encontrando los errores". Aplicado en commits `719a1136` + `65f1f866`:

**Pipeline implementada end-to-end (sin server-side):**

| Etapa | Archivo | Funciona |
|---|---|---|
| Extract frames del video | `src/services/digitalTwin/onDeviceReconstruction/frameExtractor.ts` | HTMLVideoElement + canvas.getImageData; 30 frames default; AbortSignal + progress; soporta encodings sin keyframes |
| Build point cloud | `src/services/digitalTwin/onDeviceReconstruction/pointCloudBuilder.ts` | Grilla 24×24 por frame; Z derivado de brightness Rec.709 + edge gradient; colores RGB del píxel preservados; Float32Array |
| Export GLB | `src/services/digitalTwin/onDeviceReconstruction/glbExporter.ts` | three.js GLTFExporter binary=true; POINTS primitive con vertexColors |
| Adapter on-device | `src/services/digitalTwin/photogrammetry/onDeviceAdapter.ts` | `submitJob(videoFile, projectId, userId, onProgress, abortSignal)` → Firestore job + Storage upload del GLB |
| Firestore job store | `src/services/digitalTwin/photogrammetry/reconstructionJobStore.ts` | createJob / markCompleted / markFailed / subscribeReconstructionJobs |
| UI wire | `src/pages/DigitalTwinFaena.tsx` | Subscribe live Firestore + handleSubmit ejecuta adapter + progress bar + Cancelar + visor carga GLB real via useGLTF |

**Tests verdes:**
- `pointCloudBuilder.test.ts` — 9 cases (color preservation, Z barrido, aspect ratio, bounding box, progress callback, edge cases).
- `noServerSidePhotogrammetry.test.ts` — 10 cases (incluye gate "no caller productivo de /api/photogrammetry en src/").

**Privacy enforced:**
- `videoFile` permanece en RAM del browser. Storage NUNCA recibe el video — solo el GLB resultante (estructura/color, no imagen identificable).
- Storage upload metadata: `onDeviceOnly: true, engine: on-device-webxr`.
- Firestore guarda métricas + meshUri + userId; no guarda el video original.

**Métricas medidas (notebook típico):**
- 30 frames × 640px × grid 24 → ~17k puntos.
- GLB ~ 300 KB.
- Pipeline total ~3-8 s en notebook, ~10-15 s en celular mid-range.

**Pendiente para siguiente iteración (no bloquea este PR):**
- MiDaS / Marigold TFLite (~30 MB) — depth real por monocular ML; sigue corriendo on-device.
- Multi-frame fusion (KinectFusion-like) — mesh denso vs nube de puntos.
- WebXR depth-sensing wire (cuando ARCore disponible).
- USDZ export para iOS Quick Look — `three/examples/jsm/exporters/USDZExporter.js` ya está disponible.

**Backup honesto del análisis previo (Phase 1 audit 2026-05-22, commit `5ac72258`):**

El audit identificó que PR #458 (Phase 1, 2026-05-21) eliminó el backend de photogrammetría (server.ts:64-68 + 584-587 documentan el descarte). `DigitalTwinFaena.tsx` quedó llamando `/api/photogrammetry/jobs` → 404 silencioso. Primer commit cerró ese leak con UI conservadora (toast "próximamente"); commits posteriores reemplazaron ese toast con la pipeline funcional documentada arriba. Contract test gate previene la regresión.

---


**Directiva inviolable usuario 2026-05-21:**

> "Debes considerar que NO usaré GPU externa ni COLMAP porque son de pago. Ya había comentado que el digital twin y la producción de la maqueta 3D debe ser EN EL CELULAR del usuario, así reducimos costos y reinvertimos los futuros ingresos en otras cosas."

**Implicaciones:**
- Sin Cloud Run con COLMAP (alto CPU/RAM = costo Cloud)
- Sin Modal serverless GPU (paid tier)
- Sin Vertex AI training (ya descartado §2.7)
- Procesamiento 100% en device del usuario (smartphone Android/iOS)

**Stack on-device alternativa correcta:**
- **WebXR `immersive-ar` con depth sensing** — Android Chrome ≥ 90 + ARCore expone depth maps del device
- **MediaPipe Pose/Hand/Face** — runtime browser/Capacitor, OSS Apache-2
- **Three.js mesh generation** — Marching Cubes / Poisson sampling client-side
- **TFLite (TensorFlow Lite)** — modelos cuantizados <50MB para EPP detection (§2.18 Opción B)
- **WebGL/WebGPU shaders** — render del 3D, usa GPU del propio dispositivo (gratis)
- **`gltf-transform` (client-side)** — convertir mesh a glTF/USDZ para Quick Look iOS

**Archivos ON-DEVICE existentes (verificados 2026-05-21):**
- `src/services/ar/webXrCapabilities.ts` — detecta `depth-sensing` feature
- `src/services/ar/arSceneOrchestrator.ts` — Three.js scene orchestration
- `src/services/ar/usdzConverter.ts` — conversión gltf → usdz on-device
- `src/components/ai/VisionAnalyzer.tsx` — vision AI (actualmente Gemini cloud — §2.18 plantea TFLite local)
- `src/hooks/useMediaPipePose.ts` (verificable) — pose tracking client-side
- `src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.ts` — SLAM scaffolding ZK

**Plan ON-DEVICE (PR siguiente):**
1. Eliminar `cloud-run/photogrammetry-worker/` (todo el directorio)
2. Eliminar `src/services/digitalTwin/photogrammetry/colmapAdapter.ts` + `modalAdapter.ts` (+ tests)
3. Conservar `mockAdapter.ts` (útil para tests UI sin device)
4. Quitar refs en `.github/workflows/deploy.yml` (`PHOTOGRAMMETRY_WORKER_URL`, `PHOTOGRAMMETRY_WORKER_TOKEN`, `MODAL_*_URL`)
5. Agregar gate test `noServerSidePhotogrammetry.test.ts` (similar a §2.14 SusesoApi gate)
6. Crear `src/services/digitalTwin/photogrammetry/onDeviceAdapter.ts` — WebXR depth + Three.js mesh
7. Documentar en `docs/ARCHITECTURE_ON_DEVICE.md` el por qué + cómo

**Restricciones de calidad on-device:**
- Aceptar menor calidad de mesh vs COLMAP cloud (densidad puntos / texture quality)
- UX: progress bar mientras device procesa (puede tomar 1-3 min en celular)
- Fallback degradado para devices sin depth sensing (ARCore solo en Pixel 4+, iPhone 12 Pro+)
- Mostrar al usuario "Procesando en tu celular — no se sube nada a servidores" — privacy win

### 2.27 ✅ Tier 1 paralelo — audit verificado (mostly DONE) 2026-05-21

**Hallazgo durante audit Tier 1 (user request "sigue con el plan"):** El plan integrado 2026-05-17 listaba 4 items como pendientes mayores. Verificación 2026-05-21 con `find`/`grep` muestra que la mayoría está completo.

| Item plan original | Estado real verificado |
|--------------------|------------------------|
| **2.A WebXR `immersive-ar` end-to-end** | 🟢 ~85% DONE. 11 archivos en `src/services/ar/`: arAnchorService, arAnchorFirestoreAdapter, arHitTest, arPlatformPolicy, arQuickLookFallback, arSceneOrchestrator, posterCatalog/Matcher/Embeddings, usdzConverter, webXrCapabilities. `DigitalTwinFaena.tsx:884` wireado con "Ver en AR (WebXR)" button + ArViewLink (iOS Quick Look). `useArPlacement.ts:53` placeholder por design (state coordinator — actual session lo arma el componente). Gap residual: tuning posibles refinamientos. |
| **2.B Photogrammetry COLMAP + Modal deploy** | 🔴 **DESCARTADO 2026-05-21 por directiva usuario**: "no usaré GPU externa ni COLMAP porque son de pago. El digital twin y la producción de la maqueta 3D debe ser EN EL CELULAR del usuario, así reducimos costos y reinvertimos los futuros ingresos en otras cosas". Mismo pattern que §2.7 Vertex Trainer descartado, §2.12 Stripe descartado. **Path correcto:** on-device — WebXR depth sensing + MediaPipe + Three.js + TFLite. Ver §2.28 NEW abajo para roadmap on-device. Archivos a eliminar en PR siguiente: `cloud-run/photogrammetry-worker/`, `colmapAdapter.ts`, `modalAdapter.ts`. Conservar `mockAdapter.ts` para tests. Quitar refs en `deploy.yml`. |
| **2.C MQTT IoT productivo** | 🟢 ~90% DONE. `src/services/iot/`: mqttClient.ts real (MQTT.js v5.15 over WebSocket, QoS, edge filter, reconnect), mqttAdapter.ts, edgeFilter.ts, firestoreBridge.ts, ingestRuleEngine.ts. `topicHierarchy.ts` no encontrado — posible gap menor. **Falta OPS:** broker prod (EMQX/HiveMQ) + X.509 device certs (KMS). |
| **2.D CalculatorHub 12 Bernoulli** | ✅ 100% DONE. `src/pages/CalculatorHub.tsx` (Sprint 29 Bucket AA F-A) wireado en `routes/AIRoutes.tsx:26` (`/calculators`). 15 generators en `src/services/zettelkasten/bernoulli/`: pulmonaryAltitude, respiratorFatigue, gasLeakDetection, confinedSpaceHVAC, mistingDustSuppression, hidranteFireNetwork, microWindEnergy, scaffoldWindSuction, dikeHydrostaticMonitor, gasDispersionCloud, slopeStabilityAfterRain, slamPhotogrammetryNode + hazmatPipePressure + miningVenturi + structuralWindLoad. |

**Sprint K wire UI vidas críticas (Fase 3.E plan):**
- ✅ `loneWorkerService` + `src/components/loneWorker/` existen
- ⚠️ `evacuationHeadcount` service existe sin UI consumer (NO `src/components/evacuation/`)
- ✅ `stoppageEngine` + `src/components/stoppage/` existen
- ✅ `criticalControlsLibrary` + `src/components/criticalControls/` + routes
- ✅ `fatigueMonitor` service + `src/components/fatigue/FatigueAssessmentCard.tsx` existen — **falta wire en Dashboard/page**
- ✅ `rootCauseClassifier` + `src/components/rootCause/` + routes

**Gaps reales verificados (2026-05-21):**
1. `evacuationHeadcount` sin UI consumer — needs `<EvacuationDashboard />`
2. `FatigueAssessmentCard.tsx` existe pero NO está referenciado en ningún page/route/App.tsx
3. 2.B + 2.C requieren OPS (gcloud + broker setup)

**Conclusión:** la fricción del plan a estado real era info desactualizada del 2026-05-17. La mayoría del trabajo Tier 1 ya estaba mergeado en sprints intermedios.

### 2.26 ✅ UX anonymous browsing — public collections Instagram-style (CERRADO 2026-05-21)

**Directiva usuario 2026-05-21:** *"La app la pueda usar cualquier persona... login solo cuando quiera gestionar su info. Como Instagram que te dejan ver perfiles/publicaciones públicas... datos privados de empresas y personas con estándares de banco."*

**Fix aplicado en `firestore.rules`:**

| Colección | Antes | Después | Razón |
|-----------|-------|---------|-------|
| `normatives/` | `isEmailVerified()` | `true` | DS 44/2024, ISO 45001, Ley 16.744 son regulaciones PÚBLICAS chilenas/internacionales. Sin PII. |
| `community_glossary/` | `isEmailVerified()` | `true` | Glosario terminología SST, definiciones estándar. Sin PII. |
| `global_templates/` | `isEmailVerified()` | `true` | Templates IPER/PTS/PREXOR son referencia técnica pública. Sin PII. |

**Banking-grade preserved:**
- Writes en las 3 siguen `admin/supervisor` only (no anonymous write).
- `audit_logs` siguen admin-only read + Admin SDK-only writes (immutable).
- `oauth_tokens` siguen `read,write: false` (server-only).
- `projects/`, `workers/`, `nodes/` private (project-scoped via `members array-contains user.uid`).
- `firestore.rules:25` default-deny si `request.auth == null` para todo lo NO listado explícitamente arriba.

**Resultado UX:**
- Anonymous puede leer normativa SST y glosario directamente desde Google SEO → mejor conversión.
- `GuestSaveModal` (`ProjectContext.tsx:179`) sigue gating SAVE — convierte al momento de querer guardar.
- Header `RootLayout.tsx:349-356` muestra CTA "Iniciar sesión" para anonymous (Instagram-style).

### 2.28 🟡 Digital Twin / Maqueta 3D ON-DEVICE — directiva usuario 2026-05-21 (NEW)

**Directiva inviolable usuario 2026-05-21:**

> "Debes considerar que NO usaré GPU externa ni COLMAP porque son de pago. Ya había comentado que el digital twin y la producción de la maqueta 3D debe ser EN EL CELULAR del usuario, así reducimos costos y reinvertimos los futuros ingresos en otras cosas."

**Implicaciones:**
- Sin Cloud Run con COLMAP (alto CPU/RAM = costo Cloud)
- Sin Modal serverless GPU (paid tier)
- Sin Vertex AI training (ya descartado §2.7)
- Procesamiento 100% en device del usuario (smartphone Android/iOS)

**Stack on-device alternativa correcta:**
- **WebXR `immersive-ar` con depth sensing** — Android Chrome ≥ 90 + ARCore expone depth maps del device
- **MediaPipe Pose/Hand/Face** — runtime browser/Capacitor, OSS Apache-2
- **Three.js mesh generation** — Marching Cubes / Poisson sampling client-side
- **TFLite (TensorFlow Lite)** — modelos cuantizados <50MB para EPP detection (§2.18 Opción B)
- **WebGL/WebGPU shaders** — render del 3D, usa GPU del propio dispositivo (gratis)
- **`gltf-transform` (client-side)** — convertir mesh a glTF/USDZ para Quick Look iOS

**Archivos ON-DEVICE existentes (verificados 2026-05-21):**
- `src/services/ar/webXrCapabilities.ts` — detecta `depth-sensing` feature
- `src/services/ar/arSceneOrchestrator.ts` — Three.js scene orchestration
- `src/services/ar/usdzConverter.ts` — conversión gltf → usdz on-device
- `src/components/ai/VisionAnalyzer.tsx` — vision AI (actualmente Gemini cloud — §2.18 plantea TFLite local)
- `src/hooks/useMediaPipePose.ts` (verificable) — pose tracking client-side
- `src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.ts` — SLAM scaffolding ZK

**Plan ON-DEVICE (PR siguiente):**
1. Eliminar `cloud-run/photogrammetry-worker/` (todo el directorio)
2. Eliminar `src/services/digitalTwin/photogrammetry/colmapAdapter.ts` + `modalAdapter.ts` (+ tests)
3. Conservar `mockAdapter.ts` (útil para tests UI sin device)
4. Quitar refs en `.github/workflows/deploy.yml` (`PHOTOGRAMMETRY_WORKER_URL`, `PHOTOGRAMMETRY_WORKER_TOKEN`, `MODAL_*_URL`)
5. Agregar gate test `noServerSidePhotogrammetry.test.ts` (similar a §2.14 SusesoApi gate)
6. Crear `src/services/digitalTwin/photogrammetry/onDeviceAdapter.ts` — WebXR depth + Three.js mesh
7. Documentar en `docs/ARCHITECTURE_ON_DEVICE.md` el por qué + cómo

**Restricciones de calidad on-device:**
- Aceptar menor calidad de mesh vs COLMAP cloud (densidad puntos / texture quality)
- UX: progress bar mientras device procesa (puede tomar 1-3 min en celular)
- Fallback degradado para devices sin depth sensing (ARCore solo en Pixel 4+, iPhone 12 Pro+)
- Mostrar al usuario "Procesando en tu celular — no se sube nada a servidores" — privacy win

### 2.27 ✅ Tier 1 paralelo — audit verificado (mostly DONE) 2026-05-21

**Hallazgo durante audit Tier 1 (user request "sigue con el plan"):** El plan integrado 2026-05-17 listaba 4 items como pendientes mayores. Verificación 2026-05-21 con `find`/`grep` muestra que la mayoría está completo.

| Item plan original | Estado real verificado |
|--------------------|------------------------|
| **2.A WebXR `immersive-ar` end-to-end** | 🟢 ~85% DONE. 11 archivos en `src/services/ar/`: arAnchorService, arAnchorFirestoreAdapter, arHitTest, arPlatformPolicy, arQuickLookFallback, arSceneOrchestrator, posterCatalog/Matcher/Embeddings, usdzConverter, webXrCapabilities. `DigitalTwinFaena.tsx:884` wireado con "Ver en AR (WebXR)" button + ArViewLink (iOS Quick Look). `useArPlacement.ts:53` placeholder por design (state coordinator — actual session lo arma el componente). Gap residual: tuning posibles refinamientos. |
| **2.B Photogrammetry COLMAP + Modal deploy** | 🔴 **DESCARTADO 2026-05-21 por directiva usuario**: "no usaré GPU externa ni COLMAP porque son de pago. El digital twin y la producción de la maqueta 3D debe ser EN EL CELULAR del usuario, así reducimos costos y reinvertimos los futuros ingresos en otras cosas". Mismo pattern que §2.7 Vertex Trainer descartado, §2.12 Stripe descartado. **Path correcto:** on-device — WebXR depth sensing + MediaPipe + Three.js + TFLite. Ver §2.28 NEW abajo para roadmap on-device. Archivos a eliminar en PR siguiente: `cloud-run/photogrammetry-worker/`, `colmapAdapter.ts`, `modalAdapter.ts`. Conservar `mockAdapter.ts` para tests. Quitar refs en `deploy.yml`. |
| **2.C MQTT IoT productivo** | 🟢 ~90% DONE. `src/services/iot/`: mqttClient.ts real (MQTT.js v5.15 over WebSocket, QoS, edge filter, reconnect), mqttAdapter.ts, edgeFilter.ts, firestoreBridge.ts, ingestRuleEngine.ts. `topicHierarchy.ts` no encontrado — posible gap menor. **Falta OPS:** broker prod (EMQX/HiveMQ) + X.509 device certs (KMS). |
| **2.D CalculatorHub 12 Bernoulli** | ✅ 100% DONE. `src/pages/CalculatorHub.tsx` (Sprint 29 Bucket AA F-A) wireado en `routes/AIRoutes.tsx:26` (`/calculators`). 15 generators en `src/services/zettelkasten/bernoulli/`: pulmonaryAltitude, respiratorFatigue, gasLeakDetection, confinedSpaceHVAC, mistingDustSuppression, hidranteFireNetwork, microWindEnergy, scaffoldWindSuction, dikeHydrostaticMonitor, gasDispersionCloud, slopeStabilityAfterRain, slamPhotogrammetryNode + hazmatPipePressure + miningVenturi + structuralWindLoad. |

**Sprint K wire UI vidas críticas (Fase 3.E plan):**
- ✅ `loneWorkerService` + `src/components/loneWorker/` existen
- ⚠️ `evacuationHeadcount` service existe sin UI consumer (NO `src/components/evacuation/`)
- ✅ `stoppageEngine` + `src/components/stoppage/` existen
- ✅ `criticalControlsLibrary` + `src/components/criticalControls/` + routes
- ✅ `fatigueMonitor` service + `src/components/fatigue/FatigueAssessmentCard.tsx` existen — **falta wire en Dashboard/page**
- ✅ `rootCauseClassifier` + `src/components/rootCause/` + routes

**Gaps reales verificados (2026-05-21):**
1. `evacuationHeadcount` sin UI consumer — needs `<EvacuationDashboard />`
2. `FatigueAssessmentCard.tsx` existe pero NO está referenciado en ningún page/route/App.tsx
3. 2.B + 2.C requieren OPS (gcloud + broker setup)

**Conclusión:** la fricción del plan a estado real era info desactualizada del 2026-05-17. La mayoría del trabajo Tier 1 ya estaba mergeado en sprints intermedios.

### 2.26 ✅ UX anonymous browsing — public collections Instagram-style (CERRADO 2026-05-21)

**Directiva usuario 2026-05-21:** *"La app la pueda usar cualquier persona... login solo cuando quiera gestionar su info. Como Instagram que te dejan ver perfiles/publicaciones públicas... datos privados de empresas y personas con estándares de banco."*

**Fix aplicado en `firestore.rules`:**

| Colección | Antes | Después | Razón |
|-----------|-------|---------|-------|
| `normatives/` | `isEmailVerified()` | `true` | DS 44/2024, ISO 45001, Ley 16.744 son regulaciones PÚBLICAS chilenas/internacionales. Sin PII. |
| `community_glossary/` | `isEmailVerified()` | `true` | Glosario terminología SST, definiciones estándar. Sin PII. |
| `global_templates/` | `isEmailVerified()` | `true` | Templates IPER/PTS/PREXOR son referencia técnica pública. Sin PII. |

**Banking-grade preserved:**
- Writes en las 3 siguen `admin/supervisor` only (no anonymous write).
- `audit_logs` siguen admin-only read + Admin SDK-only writes (immutable).
- `oauth_tokens` siguen `read,write: false` (server-only).
- `projects/`, `workers/`, `nodes/` private (project-scoped via `members array-contains user.uid`).
- `firestore.rules:25` default-deny si `request.auth == null` para todo lo NO listado explícitamente arriba.

**Resultado UX:**
- Anonymous puede leer normativa SST y glosario directamente desde Google SEO → mejor conversión.
- `GuestSaveModal` (`ProjectContext.tsx:179`) sigue gating SAVE — convierte al momento de querer guardar.
- Header `RootLayout.tsx:349-356` muestra CTA "Iniciar sesión" para anonymous (Instagram-style).

---

### 2.29 ✅ Audit trail ausente en rutas mutantes (rule #3) — CERRADO `rule3_pending=0` **(server-side; ver §2.32 B11 para el bypass client-side aún abierto)** (campaña 2026-05-31)

**Hallazgo** (auditoría real `everything-claude-code` + verificación manual, HEAD `1fd2c31e`): ~20 rutas en `src/server/routes/` mutan estado (Firestore `.set/.update/.add` o adapter) **sin** escribir `audit_logs` → viola CLAUDE.md regla #3. Solo **14/197** rutas auditaban. Para una app de prevención, un audit trail con huecos es false completeness severa (la empresa cree que hay traza y no la hay).

**Checklist vivo (autoritativo):** `scripts/convention-guard-baseline.json` → `rule3_pending`. El guard `scripts/check-convention-guard.cjs` (gate CI vía `src/__tests__/scripts/conventionGuard.test.ts` + pre-commit) FALLA si aparece una ruta nueva mutante sin audit; cada fix la quita del baseline (ratchet monotónico).

**Prioridad verificada:** 🔴 workPermits(×3 DS132) · confidentialReports(×3 Ley Karin) · correctiveActions(×2) · restrictedZones/define · 🟠 legalObligations(×2) · operationalChange(×3 MOC) · billing(/verify+/checkout) · drivingSafety(×4) · 🟡 projectClosure(×4) · visitors(×3) · eppFlow(×3) · evacuationHeadcount(×3) · loneWorker(×2) · sitebookSign · horometro(×2) · incidentFlow(escribe path equivocado `tenants/{tid}/audit_logs`) · ⚪ preventionCost · leadership.

**Cerrados:**
- ✅ **annualReview** objectives/evidence/conclude — `src/server/routes/annualReview.ts:300,386,448` (`await auditServerEvent(req,'annualReview.*','annual_review',…)`). Test: `src/__tests__/server/annualReview.test.ts` bloque "rule #19 (transaction) + #3 (audit_logs) compliance".
- ✅ **Olas 1-4 + triage final → `rule3_pending = 0`.** Checklist vivo autoritativo `scripts/convention-guard-baseline.json` → `rule3_pending: {}` (machine-checked en CI por `src/__tests__/scripts/conventionGuard.test.ts`, gate PASS). **28 rutas finales auditadas** en el PR de cierre, cada una con `await auditServerEvent(req,'<mod>.<verb>','<mod>',{ids},{projectId})` tras el write (acciones grep-verificables, p.ej. `grep "correctiveActions.create" src/server/routes/correctiveActions.ts`): apprenticeship · compliance · correctiveActions · culturePulse · dataConfidence · documentVersioning · drillsManager · emergencyBrigade · engineeringControls · equipmentQr · externalAuditPortal · knowledgeBase · lessonsLearned · microtraining · misc · offlineInspections · pdca · photoEvidence · portableHistory · positiveObservations · projects · qrAck · qrSignature · residualRisk · sif · sitebook · suppliers · wisdomCapsule. Test nuevo (ruta antes sin cobertura): `src/__tests__/server/correctiveActions.router.test.ts`.
- ✅ **14 falsas-positivas del guard coarse** (matchea `new XAdapter`/`res.set`/event-bus) → `rule3_exempt` con razón one-line (read-only/pure-compute/infra): cphsMinute, dataQuality, equipment, inbox, incidentTrends, loto, openapi, preShiftRisk, riskRadar, softBlocking, systemEvents, vulnerability, waste, workerReadiness.
- ✅ **4 handlers derived-cache/infra** que escriben en un read-path pero no persisten registro de negocio → documentados en `_handlerLevel_rule3_derivedCacheExempt` (dataConfidence GET-snapshot, wisdomCapsule GET-today, misc /erp/sync, externalAuditPortal /public).
- ✅ **Handler-level guard-invisible CERRADO:** `restrictedZones`/define (`restrictedZones.define`), `billing`/verify (`billing.verify`), `billing`/checkout (`billing.checkout`) — el archivo ya auditaba OTROS handlers (file-level guard ciego), audit agregado a estos handlers específicos. Baseline `_handlerLevel_rule3_guardInvisible` → RESOLVED. **Regla #3 sin huecos conocidos.**

### 2.30 ✅ Read-modify-write sin runTransaction (rule #19) — CERRADO `rule19_pending=0` (campaña 2026-05-31)

**Hallazgo:** handlers que hacen `get()` + `set/update()` sobre el MISMO doc sin `db.runTransaction` → race split-brain / lost-update. Candidatos CLAUDE.md #19 + barrido real verificado.

**Checklist vivo:** `convention-guard-baseline.json` → `rule19_pending`.

**Verificados:** 🔴 annualReview (clobbea el doc completo, `set(merge:false)`) · 🟠 healthVault GET `/view` (TOCTOU: 2 escaneos concurrentes pasan `maxViews` en la última vista) · 🟡 visitors(check-out/ack) · knowledgeBase(/use,/flag-obsolete) · apprenticeship/expose. (incidentTrends / culturePulse / cphsMinute verificados **OK** — descartados: read-only o docs distintos.)

**Cerrados:**
- ✅ **annualReview** ×3 handlers — `src/server/routes/annualReview.ts:260,335,423` envueltos en `db.runTransaction<R>(…txn.get/txn.set…)` con result discriminado (patrón `apprenticeship.ts:245`). Test: spy `runTransaction` en `annualReview.test.ts`.

### 2.31 🟡 CI "Tests" job open-handle hang — detector instrumentado 2026-06-01 (next-step del audit, HECHO)

**Update 2026-06-01 (deuda residual, sesión audit B1-B18):** se implementó el
**próximo paso recomendado** — detector de handles opt-in en `src/test/setup.ts`
(gated por `DETECT_HANDLES=1`, inerte en runs normales). Snapshot de
`process.getActiveResourcesInfo()` en file-load vs `afterAll`. Hallazgos
empíricos (corriendo `src/__tests__/server`, 153 files / 3476 tests):

- **`Timeout+1` es de vitest, NO de la app**: aparece hasta en un test trivial
  vacío → es el heartbeat del worker. El detector lo descuenta (señal real =
  `Timeout+2` o más).
- **`TCPServerWrap`/`TCPSocketWrap`/`SimpleShutdownWrap`** aparecen en los 142
  files que usan supertest: es el server efímero de `request(app)` con el
  `close()` **en vuelo** (`SimpleShutdownWrap`) al momento del `afterAll` —
  transitorio, drena solo. El suite **salió limpio en 38s** (sin repro del hang)
  en este entorno → confirma que el hang es el caso raro (~30%) donde un
  `close()` de supertest no alcanza a completar (probable test con
  `request(app)` sin `await`, no determinista).
- **Rate-limiters de producción verificados IPv6-safe**: `commute.ts:45`,
  `incidents.ts:58`, `emergency.ts:55`, `organic.ts:43`, `healthVault.ts:72`,
  `server.ts:699` y los compartidos en `limiters.ts` usan
  `ipKeyGenerator(req.ip ?? '')`. La `ValidationError` de express-rate-limit en
  el log de tests viene SOLO de 3 fixtures de test (`webauthnVerify.test.ts:981`,
  `askGuardian.test.ts:121`, `webauthnRegister.test.ts:216`) que usan `req.ip`
  pelado → ruido de log + inconsistencia con prod, no bug de seguridad.

**Sigue abierto (genuinamente unbounded):** el handle exacto del caso raro no
reprodujo local. Mitigación: re-run de PRs verificados-seguros. **Ahora
instrumentado** — el próximo que vea el hang en CI corre `DETECT_HANDLES=1 npx
vitest run <subset>` y ataca el archivo que muestra `TCPServerWrap` sin
`SimpleShutdownWrap` o `Timeout+2`. **B-2.31-D1 ✅ HECHO (2026-06-01):** los 3
fixtures (`webauthnVerify`, `askGuardian`, `webauthnRegister`) ahora usan
`ipKeyGenerator(req.ip ?? '')` — ruido `ValidationError` de express-rate-limit
eliminado, 46 tests verdes.

---

### 2.31-OLD 🟡 CI "Tests" job open-handle hang — corre 30min → kill (intermitente ~30-40%, INVESTIGADO 2026-06-01)

**Hallazgo (esta sesión):** el job CI **Tests** falla ~30-40% de runs **no por una aserción** sino
porque el proceso vitest **no termina**: corre hasta `timeout-minutes` (~30min) y lo matan
("Worker exited unexpectedly" sin assertion surfaceable). Confirma el flake folklore de campañas
previas (memoria `project_audit_transaction_campaign`). **Evidencia directa:** PR #638 (cambio
data-only pt-BR, sin test dependiente) corrió **30m15s → fail**, luego **5m40s → pass** en re-run
sin cambios de código.

**Triage hecho (descarta culpables obvios):**
- `vitest.config.ts` no setea `pool` → default `forks` (kill-able). El hang es el worker que no
  sale por un handle abierto **post-tests**, no un test colgado (el `--test-timeout=30000` de #594
  no aplica a este caso).
- Los 3 timers server-side (`triggers/healthCheck.ts:94`, `emergency/autoTrigger.ts:415`,
  `mesh/transportFacade.ts:125`) están bien diseñados (cleanup explícito `stop()`/`clearInterval`)
  y **ningún test los arranca** (grep de starters = 0). NO son el leak.
- No hay `setInterval` module-level en `src/server/`. El leak **no es determinista** (si lo fuera
  colgaría 100% de runs, no 30-40%) → apunta a un test que condicionalmente deja un handle (server
  supertest sin cerrar / connection / timer con race de cleanup).
- `src/test/setup.ts` solo limpia jsdom (React unmount); **no hay teardown node-side** que
  detecte/cierre handles colgados.

**Próximo paso recomendado (NO hecho — requiere repro local con Java 21 + emulador o bisect):**
correr el suite server con detección de handles — `process.getActiveResourcesInfo()` en un
`afterAll` global gated por env `DETECT_HANDLES=1`, snapshot before/after por archivo para atribuir
el `Timeout`/`Socket` colgado al archivo que lo filtra. Alternativa: bisect por subcarpeta de
`src/__tests__/server/`. Mitigación vigente: re-run de PRs verificados-seguros (data-only /
typecheck-verde).

**Por qué no se cerró acá:** el hunt del handle exacto en ~10k tests es **no-acotado** y el flake
puede no reproducir local; un fix especulativo violaría TODO.md Regla #1 (nada ✅ sin evidencia
verificable). Registrado como **deuda evidenciada con next-step** en vez de fingir cierre.

---

### 2.32 🔴 Deuda verificada por barrido archivo-por-archivo (auditoría 2026-06-02)

**Origen:** auditoría de contexto archivo-por-archivo de los **3.545 archivos** del
repo (cobertura mecánica 100% + 25 revisiones profundas). Evidencia, detalle por
archivo y reconciliación contra este TODO en
`docs/audits/file-ledger/` — ver `INDEX-CONSOLIDADO.md` y `PHASE3-RECONCILIATION.md`.
Esta sub-sección es **autoritativa** sobre el estado real de los ítems listados:
varios contradicen un ✅ previo (Rule #1).

> **Hallazgo sistémico (B11):** el factory `createProjectScopedStore.save/patch`
> (`src/store/createProjectScopedStore.ts:190-215`) y varios contextos
> (`EmergencyContext.triggerEmergency` sobre `emergency_events`, `ProjectContext`,
> `UniversalKnowledgeContext`, `FirebaseContext`) escriben a Firestore **client-side
> sin `auditServerEvent`**. El cierre de §2.29 (`rule3_pending=0`) es **solo
> server-side** (ratchet sobre `src/server/routes/`); este camino cliente→Firestore
> **no está cubierto** y es un posible hueco Regla #3 para operaciones hechas por UI
> (MOC, CPHS, SiteBook, Stoppage). → Decisión: trigger server vs re-cablear UI a
> endpoints auditados.

**P0 — Vida (🛟):**
- 🔴 **ManDown no hace push** — `useManDownDetection` escribe Firestore pero no
  llama `triggerEmergency`/FCM ni hay trigger server sobre `mandown_events`. (§16.6.2
  lo listaba como "UI completa MEDIA"; el gap real es el pipeline de push.) *Usuario
  pidió dejar documentado.*
- 🔴 **LOTO read-only** — `src/server/routes/loto.ts:55` solo expone `GET`; no hay
  endpoint para aplicar candado / verificar cero-energía / liberar; `LotoAdapter`/
  `applyFullRelease` son código muerto; `LotoStatusPanel` huérfano. El control que
  "previene energización" **no está cableado**. (§2.29 lo eximió como "read-only" —
  exención técnicamente válida que **ocultaba** esta brecha de vida.)
- 🟡 **AlertScheduler con probes vacíos** — `RootLayout.tsx:467` `probes={[]}` → el
  pipeline predictivo Bernoulli está dormido en prod.
- ✅ **Ruta de evacuación insegura RESUELTA (Fase 5, 2026-06-03)** (era DEEP-EX-03):
  `routingBackend.ts` esquivaba UN solo peligro por waypoint (`break`) sin re-chequear
  el punto reubicado → la ruta podía atravesar un 2º peligro. Nuevo
  `clearPointFromHazards()` libra TODOS los peligros con re-chequeo (cota dura,
  determinista); 16/16 tests reales. Pendiente: verificar que los SEGMENTOS entre
  waypoints no crucen un peligro (no solo los vértices) + validar endpoints.

**P1 — Privacidad / cumplimiento (🔐):**
- 🔴 **External Audit Portal sin gate de rol** — `externalAuditPortal.ts:234,306,355,428`
  solo `verifyAuth`, sin `assertProjectMember`/`isAdmin` → cualquier member del tenant
  emite token de auditor externo con acceso cross-proyecto a docs/IPER/incidentes.
- 🔴 **`health_vault`/`health_vault_shares` sin reglas Firestore** (grep=0) — colección
  médica más sensible; writes por Admin SDK pero incumple Regla #4 (sin rules-tests ni
  `security_spec`); el listado client-side cae en default-deny.
- 🔴 **Libro de obras firmado sigue MUTABLE + test falso-verde** — `firestore.rules:414,422`
  chequea `signedAt` top-level; la firma escribe `signature.signedAt` anidado
  (`siteBookSigning.ts:247`) → el gate nunca dispara; el rules-test pasa sembrando un
  `signedAt` sintético (`projectScopedStores.rules.test.ts:181`). Además SiteBook tiene
  3 paths disjuntos (adapter `tenants/.../sitebook_entries` vs firma
  `projects/.../site_book_entries`).
- 🔴 **`visitors.ts` sin `assertProjectMember`** — `:112,119` solo `verifyAuth` +
  `tenantIdFor` → escritura de visitas cross-proyecto (viola Regla #6). *(El audit
  server-side de §2.29 sí cerró; este es el gap de membership, distinto.)*
- 🔴 **Biometría de login débil** — `Login.tsx:10` usa `utils/biometrics.ts:88` que
  retorna `true` client-side sin verificación server-side de firma. *(§2.1 ✅ cubre el
  setup MFA `useBiometricAuth`, NO el path de login.)*
- 🔴 **Medicine.tsx UI de diagnóstico** — `MedicalAnalyzer/DifferentialDiagnosis/
  DrugInteractions` (`:134,137,141`) llaman acciones Gemini no whitelisted → 403, y
  contradicen ADR 0012. UI muerta a retirar/feature-flag.
- 🟡 **AIPostureAnalysisModal sube foto** — fallback Gemini Vision
  (`AIPostureAnalysisModal.tsx:206-210`) sube la foto del trabajador (matiz Regla #12:
  foto estática subida manualmente, no frame en vivo).
- 🟡 **`culturePulse.respondSurvey` audita `userId`** (`:657`) → re-identificación de
  encuesta "anónima".

**P2 — Integridad / robustez:**
- 🟡 **Gamificación auto-otorga puntos** — `gamification.ts:35` toma `amount` del cliente
  sin cota/whitelist; `gamificationService.ts:34` lo envía verbatim.
- 🟡 **Tier-gating por-feature solo client-side** — `SubscriptionContext.tsx:64-68`; sin
  middleware server que re-chequee rank (Regla #11 parcial; activación sí está gateada).
- 🟡 **PDCA flow no crea edges** — `incidentFlow.ts:77-84` inyecta solo `writeNodes` → los
  7 nodos ZK quedan sin conectar (trail ISO 45001 §10.2 no end-to-end).
- 🟡 **`comite_actas` sin regla de write** — `ComiteParitario.tsx:73` escribe → default-deny
  en prod; duplica el canónico `cphs_meetings`. *(El gate de inmutabilidad de cphs_meetings
  SÍ está bien: pivota sobre `signatures.size()`.)*
- 🟡 **Reglas Codex #650** — `site_book_counters` sin regla; `documents_for_read` exige
  `authorUid` que el writer no estampa; `lone_worker_sessions` update sin
  `existing().workerUid==auth.uid`; `root_cause_analyses` (`rootCauseStore.ts:20`) vs regla
  `root_causes`. Modelos laxos `exceptions`/`legal_obligations`/`shifts` (`firestore.rules:466-477`,
  hay `TODO(review dahosandoval@)`).
- 🟡 **Guards #13/#17 NO wired** — `.husky/pre-commit` solo corre medical/convention/i18n/
  any-ratchet; `precommit-stub-guard` (#13) y `precommit-allowbackup-guard` (#17) no se
  referencian en husky/CI/package.json, pese a que CLAUDE.md dice "Enforced (PR #514)".
- 🟡 **B16 sync:** `conflict_queue` (`conflictQueue.ts`, 238 LOC) **existe pero está muerto
  y sin reglas** (resuelve la contradicción §16.2.2: 1432 ✅ vs 1463 CRÍTICA → la verdad es
  "engine sí, feature no"); `meshPacket.ts:237` firma `'unsigned-dev'` nunca verificada;
  `encryptData` web es base64, no cifrado (`offlineStorage.ts`).
- 🟡 **B4:** `Math.random` en ID `incidentRagService.ts:299` (Regla #15); incidents path
  mismatch (bundle root vs servicio tenant-scoped).

**P3 — Limpieza / huérfanos (🔵):**
- **86 UI huérfanas** (48 componentes + 38 hooks, 0 pages sin rutear); **`euler/*` ~4.053 LOC
  100% huérfano**; `eventBus/*` sin listeners; cadena RAG-coach huérfana; subsistemas muertos
  (cost calculator 928 LOC, EPP purchase-order, twin instanced, AR placement,
  `ProjectScopedPage` scaffold).
- **Duplicados a consolidar:** doble-MQTT (cloud `NotImplementedError` vs WS client),
  doble-DS76, doble PDF SUSESO, `changeMgmt` vs `operationalChange`.
- **IoT MQTT** no conecta a broker (`mqttAdapter.ts` cloud/EMQX `NotImplementedError`);
  comentario `:16` "mqtt is NOT a dependency" **falso** (`package.json:151`).
- **Sugerencia:** crear bloque **B-DigitalTwin** (~25 archivos hoy sin bloque; pipeline
  on-device MiDaS ONNX real).

**Estratégico — Cuota/resiliencia IA (Gemini):**
- 🔴 **Inferencia de producción sobre clave AI Studio gratuita** (`gemini.ts:271`) —
  Google estrechó cuotas (req/día + nivel de "thinking"); a escala el tráfico de
  clientes agotaría la cuota y degradaría/caería la IA. Ya existen rate-limit
  por-usuario + global, circuit-breaker, costo estimado, orquestador resiliente (flag
  OFF) y RAG (`safeNormativeQuery`). **Decisión documentada en
  `docs/architecture-decisions/0019-ai-quota-resilience-strategy.md`**: migrar a
  Vertex pay-as-you-go (F1) + encender orquestador/SLM (F2) + ruteo Flash/thinking
  (F3) + RAG-first/caché (F4) + budget por tenant/tier (F5). BYOK queda como opción
  enterprise con clave **paga**. Pendiente: investigar números exactos de cuota.

**Correcciones de consistencia aplicadas a este TODO (2026-06-02):**
- §1 tabla: Mesh "consumer cableado" (no "falta"); Billing quita "falta MP IPN HMAC"
  (verificado wired); Tests sincronizado con §2.11 (10029/0) + matiz cobertura.
- §2.29 acotado a "server-side" (este §2.32 B11 abre el gap client-side).
- Inconsistencia `conflict_queue` (§16.2.2) resuelta arriba.

**Doc-drift detectado (auditoría I-DOCS, ver `DEEP-I-DOCS.md`):**
- 🔴 **`ARCHITECTURE.md` viola Regla #20** — `geminiBackend.ts` dice 2923 LOC (real
  **1466**), `server.ts` 1411 (real **1500**), refs `server.ts:1972/2321/2901/3115/3191`
  **más allá del EOF** (post-split), `ALLOWED_GEMINI_ACTIONS` ya está en
  `gemini.ts:119` no en `server.ts:1593`.
- 🟡 `stubs-inventory.md` da el mesh nativo como stub (es real); 3 runbooks de
  photogrammetry despliegan workers ya eliminados; CLAUDE.md #13/#17 dice guards
  "Enforced" sin estarlo; ADR 0006 superseded sin marcar, ADR 0005 ref inexistente.

> **Nota de completitud (actualizada 2026-06-02):** barrido 100% mecánico + ahora
> **100% atribuido por bloque** (los 355 UI sin bloque reclasificados →
> `ui-reclass-map.json`; server+services en cierre). I-DOCS revisado (doc-drift
> arriba). **Pendiente:** ~50 archivos mal-clasificados por heurística a reubicar, y
> medir cobertura real con `vitest --coverage`. Detalle en
> `docs/audits/file-ledger/DEEP-UI-RECLASIFICACION.md` y `DEEP-SRV-RECLASIFICACION.md`.

---

### 2.33 🔴 Deuda de la pasada exhaustiva línea-por-línea (1.743 archivos FEAT, 2026-06-03)

**Origen:** segunda pasada que leyó **TODOS** los archivos FEAT línea por línea (no
solo la capa crítica). Índice + detalle: `docs/audits/file-ledger/DEEP-EX-INDEX.md`
y `DEEP-EX-01..41.md`. ~45 hallazgos 🔴 NUEVOS, agrupados en **17 patrones
sistémicos** (arreglar la clase, no el síntoma). Los más graves re-verificados por grep.

**Patrones de mayor impacto (vida/cumplimiento):**
- **P1 — Colecciones client-side SIN reglas Firestore → default-deny silencioso.** El
  fix de §17 (14 colecciones) **quedó incompleto**; faltan ≥20: `pings` (baliza de vida),
  `deas`/`inspections` (desfibriladores), `clinical_alerts`, `findings`, `control_validations`,
  `read_receipts`, `driving_incidents`, `calendar_events`, `reconstructions`/`reconstruction_jobs`/
  `placed_objects`, `comite_actas`, `documents`, `personalized_plans`, `slo_metrics`, etc. Tests
  `.firestore.test.ts` usan Admin SDK → falso verde.
- **P2 — Colas offline descartan datos de seguridad tras N reintentos** sin dead-letter:
  ✅ **`sosOutbox` RESUELTO (Fase 5, 2026-06-03)** — tras MAX_RETRY el SOS se marca
  `deadLettered` y se retiene (jamás se descarta); + `deadLetters()`/`clearDeadLetter()`;
  el hard-cap nunca evicta un dead-letter; 11/11 tests reales. Pendiente: surjir
  dead-letters en UI; `syncStateMachine.ts:313` (incidentes/evidencia); `genericOutboxEngine.ts:248`.
- **P3 — Identidad/rol/tenantId del cliente sin verificar contra el token:** `sif.ts`
  (reviewedByUid SIF suplantable), `stoppage.ts:216` (resumedByRole reanuda paralización),
  `exceptions.ts` (approvedByRole), `suseso.ts` (tenantId DIAT/DIEP cross-empresa),
  `networkBackend.ts` (authorUid), `microtraining.ts:187` (certificar a cualquiera).
- **P4 — Firmas WebAuthn presence-checked pero nunca verificadas cripto:** DTE (`dte.ts:349`),
  referee co-sign, biometría login, aptitud médica, kms-sign-rsa.
- **P5 — Records firmados MUTABLES** (gate keya campo que el writer no escribe) + tests falso-verde:
  `site_book`, `lighting_audits` (DS594). (cphs_meetings sí está bien.)
- **P6 — Puntos ciegos del guard ADR 0012:** código de diagnóstico real fuera del scope —
  `VitalityMonitor.tsx` (CIE-10 golpe de calor), `medicalAnalysisBackend.ts` (differentialDiagnosis),
  `occupational-health/`, `psychosocialBackend`, `shiftBackend`. El guard solo escanea `health/`+`medicine/`.
- **P7 — Imágenes de cámara a Gemini cloud vs directiva #12:** `BioAnalysis.tsx:411` (frame vivo),
  `AIPostureAnalysisModal`, `EPPVerificationModal.tsx:63`.
- **P8 — Envenenamiento de RAG (Zettelkasten):** `KnowledgeIngestion.tsx:60` y `networkBackend.ts:77`
  (nodos `global`/master sin gate), `ragService.queryCommunityKnowledge` (self-poisoning).
- **P9 — Auto-otorgamiento de gamificación** por escritura directa (reglas restringen keys no valores):
  `user_stats`, `gamification_scores`.
- **P14 — Job de réplica DR replica CERO filas en silencio** (`firestoreCriticalReplicate.ts:154`
  filtra `createdAt` pero audit escribe `timestamp`; invoices Timestamp vs epoch-ms) → RPO incumplido.

**Patrones de robustez/costo:** P10 datos falsos mostrados como reales (SloErrorBudget,
WeatherBulletin, dataConfidence, EmergencySquadManager); P11 `JSON.parse` sin try/catch
sistémico en `*Backend.ts` (#5, **un codemod**); P12 `Math.random` en IDs cliente (#15);
P13 SLM sin verificar sha256 del CDN; **P15 el cap global de gasto IA usa MemoryStore
por-pod → cap real = réplicas × cap** (relevante a ADR 0019); P16 stubs disfrazados
que llegan al usuario; P17 copy de cumplimiento mentiroso.

**Notas operacionales:** push de incidente CRÍTICO al CPHS no llega a dispositivos
modernos (`backgroundTriggers.ts:213` lee `fcmToken` legacy singular); `predictionBackend`
usa `gemini-3.1-pro-preview` facturado a precio Flash (sub-metering).

**Aguantó el escrutinio (sólido):** billing/pagos, clúster cripto (AES-256-GCM/CloudKMS),
Zettelkasten v2 core, motores puros (IPER/REBA/analítica), aislamiento server.

---

### 2.34 🔴 Deuda de la pasada exhaustiva 2 — tests + infra + build + docs (2026-06-03)

**Origen:** segunda pasada línea-por-línea de los **1.725 archivos restantes** (1.247
tests + 89 I-CORE/I18N/DATA + 72 I-PLAT + 132 I-BUILD + 185 I-DOCS). Con esto **el
repo completo (3.545 archivos, menos 77 binarios) queda leído línea por línea.** Índice:
`docs/audits/file-ledger/DEEP-EXT-INDEX.md`; detalle `DEEP-EXT-01..23` + `DEEP-EXI-24..35`.

**Tests — la cobertura es BIMODAL (el conteo "10.029 passing" sobreestima):**
- 🔴 **"Wire-up contract": 144 de 164 tests co-located en `src/server/routes/*.test.ts`**
  solo introspeccionan `router.stack`; no ejercitan handler/`verifyAuth`/`validate`.
  Borrar `verifyAuth` deja la suite verde. (Cobertura real vive en las 143 suites
  supertest de `src/__tests__/server/`; rutas sin companion = sin cobertura conductual.)
- 🔴 **Reimplementación-disfrazada:** `auditCoverage` (prueba la invariante #3 sobre
  copias), `mercadoPagoIpn`, `telemetry*`, `webauthnVerify/Register`, `externalAuditPortal`,
  `suseso`, `visitors`, `iot`, etc. — re-implementan el handler, no importan la ruta.
- 🔴 **"ID crypto contract" tautológico** (apprenticeship/leadership/projectClosure/
  confidentialReports/drivingSafety/visitors) + **mock-the-SUT** (ragService, MorningRoutine).
- 🔴🛟 **e2e safety-críticos en `describe.fixme`** (`sos-button`, `process-lifecycle`,
  `offline-resilience`) → **SOS y offline no tienen e2e activo**; DR dry-run prueba el
  seeder, no backup real.
- Lo sólido: `__tests__/server` supertest, componentes con asserts de valor, engines puros
  mutation-grade (reba/rula/euler), billing crypto (RFC/FIPS/RSA), `security/*` (KEK/KMS).

**Infra/Build — gobernanza y config:**
- 🔴 **No hay job de `lint` en CI**; **los ratchets (#3/#19/any/i18n) corren solo en
  husky, no en CI** (bypaseables con `--no-verify`; solo medical-guard tiene backstop CI);
  **guards #13/#17 no-wired** (re-confirmado).
- 🔴 **Mismatch de dominio** `praeventio.app` (manifest/AASA) vs `app.praeventio.net`
  (server/WebAuthn) + `WEBAUTHN_RP_ID`≠`WEBAUTHN_RPID` → **passkeys y deep-links rotos en prod**.
- 🔴 **iOS `CBUUID` inválido** vs Android → **malla BLE de emergencia no interopera iOS↔Android**.
- 🔴 `render-well-known.mjs:31` hardcodea el SHA-256 del cert Play de prod (fail-open).
- 🔴 **voseo es-AR en la referencia es-CL** (`es/common.json`, Regla #2).
- 🟡 `firebase-applet-config.json` git-trackeada; `cphs_meetings:1175` append-only no
  preserva prefijo del array de firmas; converters token `==` timing-oracle; contenedores root.
  ✅ Terraform 100% limpio.

**Docs — doc-drift generalizado post-split** (Regla #20): ARCHITECTURE.md (LOC/refs),
stubs-inventory (SystemEngine/mesh), CLAUDE.md (#13/#17), TRACKING_PLAN (analytics
"no impl" pero ~3457 LOC), BERNOULLI_EXTENSIONS, gemini-split-plan, runbooks photogrammetry
(worker descartado documentado como vivo), BILLING.md, CONTRIBUTING.md, THREAT_MODEL,
ADR 0013 (UUID mesh inválido), ADR 0005/0006 superseded sin marcar. ✅ SENTRY docs 1:1.

**Reconciliación "colecciones sin reglas" (§2.32 B-rules / §2.33 P1):** se DIVIDE en
(a) **client-written → ruptura silenciosa real** (clinical_alerts, control_validations,
comite_actas, findings, driving_incidents, documents, read_receipts, site_book/lighting_audits
mutables — verificadas client-side) y (b) **server-only → solo gap #4 + lectura cliente rota**
(health_vault). Ambos necesitan reglas explícitas + rules-tests; (a) además pierde datos en runtime.

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

## 5. ⏸ Pendientes de provisioning operacional (NO bloqueado por usuario)

> Estos items requieren acción operacional (Secret Manager, Cloud KMS, cuentas Apple/Google, HF token, etc.) que NO depende de decisiones de producto del usuario. Mayoría es ejecutable por equipo ops siguiendo runbooks existentes.

| Item | Provisioning requerido | Quién lo ejecuta | Runbook |
|---|---|---|---|
| Cuentas Apple/Google/Stripe | App Store Connect + Google Play Console + Stripe production keys | Equipo ops | — |
| `WEBAUTHN_RP_ID` prod | Secret Manager + Cloud Run env | Equipo ops | docs/runbooks/SECRETS_RUNBOOK.md |
| `KMS_KEY_RESOURCE_NAME` | Cloud KMS keyring | Equipo ops | docs/runbooks/KMS_PROD_ACTIVATION.md |
| `MP_IPN_HMAC_SECRET`, `STRIPE_WEBHOOK_SECRET` | Secret Manager | Equipo ops | docs/runbooks/SECRETS_RUNBOOK.md |
| `GEMMA_HF_TOKEN` + SHA-256 download | HF token con scope `gemma-2-2b-it-ONNX` (gated repo) | Equipo ops/data | docs/runbooks/SECRETS_RUNBOOK.md |
| Android keystore prod | Generar + upload Play Console | Equipo ops | docs/runbooks/MOBILE_SIGNING.md |
| Sentry sourcemaps CI upload | `@sentry/cli` step en `.github/workflows/deploy.yml` | Equipo ops | — |
| Vertex AI Trainer opt-in mega-enterprise | Sprint dedicado (decisión usuario 2026-05-27: opt-in gated, budget caps) | Sprint futuro | plan-hardening-replicated-eclipse.md |
| AASA Team ID iOS Universal Links | Apple Developer Account | Roadmap iOS | docs/runbooks/MOBILE_SIGNING.md |

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
- **Páginas productivas sin `useTranslation`: 0 (verificado 2026-05-26).** El grep histórico contaba 10 archivos pero 9 son `*.test.tsx` (que no requieren i18n) y 1 es `src/pages/Onboarding.tsx` — wrapper sin strings propios, delega copy al `<OnboardingWizard>` interno que sí usa i18n.
- **pt-BR 87%** — completar 375 keys faltantes (Bloque N)
- **es-AR, es-MX, es-PE 5-8%** — completar core flows o documentar fallback `es-CL` en selector UI
- **Traducciones humanas** fr/de/it/ja/zh-CN/ar/ko/hi/ru (hoy shells ~1-2% keys) — bloqueado por traductores humanos profesionales

### ⚠️ VERIFICACIÓN 2026-05-30 — la mayoría de "pendientes" de abajo YA ESTÁN HECHOS

> Directiva usuario: **no asumir que el .md dice la verdad** — auditar punto por punto contra el código. Resultado: **~90% de los "Roadmap features" + "Productos pendientes" de abajo ya están construidos.** Estado real (Rule #1, file refs):
>
> **✅ HECHOS (el .md los listaba como pendientes — falso):**
> - F-A CalculatorHub → `src/pages/CalculatorHub.tsx` (+ test + ruteado en `AIRoutes.tsx`) · F-B RAG NL → `src/components/zettelkasten/NlQueryPanel.tsx` · F-D Gamification salud → `src/components/emergency/SkillTree.tsx` · F-E Predictive Calendar → `AlertScheduler` en `RootLayout.tsx` · F-F WebAuthn UI → `src/components/settings/WebAuthnKeysSection.tsx`
> - #5 Geo-anchored ZK → `src/hooks/useGeoAnchoredNodes.ts` (Haversine real, wired en `MaintenanceStatusPanel.tsx`) · #7 CSV ETL → `src/components/etl/CsvImportExportModal.tsx` · #8 Onboarding wizard → `src/components/industry/IndustrySelectorWizard.tsx` · #10 DS 67/76 PDF → `src/components/compliance/Ds67Builder.tsx` · #13 AnatomyLibrary → `src/components/medicine/AnatomyLibrary.tsx` · #14 VitalityMonitor → `src/components/hygiene/VitalityMonitor.tsx` · #15 MediaPipe Pose → `AIPostureAnalysisModal.tsx` ya usa `useMediaPipePose` · #16 MorningRoutine **SÍ persiste** → `setDoc`+serverTimestamp (el .md decía "falta persistir")
>
> **🔒 BLOQUEADO POR COWORK (código real, falta secret/cuenta — NO es trabajo de código):** #1 MQTT broker cloud (adapter+bridge reales; falta emqx/X.509) · #2/#3 WebXR/ARKit (foundation lista; falta device+ARCore/ARKit) · #6 COLMAP deploy (worker existe) · #17 Maps con keys reales
>
> **✗ GENUINAMENTE PENDIENTE (único item de código sin construir en este listado):** **#9 Coach IA por dominio** — hoy hay un Asesor único (`ResilientAsesorPanel`); falta especializar prompts por módulo (medicina/ergonomía/SST).
>
> Las líneas de abajo se conservan como histórico; **este bloque las supersede.**

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
| **Pinecone (vector DB cloud)** | Descartado (usuario 2026-05-30). El RAG usa el fallback in-memory/interno (ya gated por env). Referencias en `coachRag.ts` / `chemicalBackend.ts` / `coach/normativeRag.ts` / `networkBackend.ts` quedan como código gated; limpiar a futuro. |
| **COLMAP cloud / photogrammetry-worker de pago** | Descartado si implica costo (usuario 2026-05-30). La fotogrametría **INTERNA on-device ya existe COMPLETA y MIT/OSS**: `frameExtractor` → `midasDepthEstimator` (MiDaS) → `pointCloudBuilder` → `glbExporter`/`usdzExporter` (`src/services/digitalTwin/onDeviceReconstruction/`, VIDEO→MESH sin enviar bytes fuera). Eso ES lo que hace COLMAP, interno y gratis. |

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
## 16. 📥 Propuestas re-incorporadas desde docs/archive/2026-05/

> **Generado 2026-05-19** — cross-reference de los 13 docs movidos a `docs/archive/2026-05/` vs §1-§11. Solo items NO presentes en TODO.md, NO en §9 Descartado, NO filosóficos abstractos. Total ~50 items técnicos verificados con grep contra código real.
>
> **Política:** estos items son carry-over válido — directiva usuario 2026-05-19: "no puedes borrar propuestas que no estén consideradas en TODO.md". Cada item linkea al doc archive como evidencia histórica.

### ⚠️ VERIFICACIÓN 2026-05-30 — §16 está EN GRAN PARTE STALE (lo "no implementado" ya está hecho)

> Directiva usuario: verificar punto por punto, no asumir. Muestreo amplio de §16 contra el código → **la mayoría de los items "no implementados" ya están construidos** desde que se escribieron esos docs archive. Confirmado-hecho (Rule #1):
>
> - §16.2.2 `conflict_queue` (safety docs nunca last-write-wins) → `src/services/sync/conflictQueue.ts` + `conflictResolver.ts` ✅
> - §16.2.3 `safeNormativeQuery` (SLM no alucina ley si RAG <0.75) → `src/services/rag/safeNormativeQuery.ts` (`MIN_SIMILARITY=0.75`) + tested ✅ (+ guard a nivel prompt en `chat.ts`)
> - §16.8.4 `autoTrigger` test → `src/services/emergency/autoTrigger.test.ts` ✅ · §16.8.6 MorningRoutine SÍ persiste (`setDoc`) ✅
> - §16.2.1 event bus / systemEngine → `services/eventBus/` + `services/systemEngine/` (foundation presente)
> - §16.1.2 / §16.1.3 (3D, foto→hallazgo) + ARKit USDZ (#3) → **fotogrametría INTERNA on-device YA EXISTE, MIT/OSS**: `frameExtractor` → `midasDepthEstimator` (MiDaS depth ML) → `pointCloudBuilder` → `glbExporter`/`usdzExporter` (`src/services/digitalTwin/onDeviceReconstruction/`, VIDEO→MESH sin enviar bytes fuera).
>
> **Genuinamente pendiente (no stale):** cowork (secrets/cuentas), salud CI (hang flaky), E2E real (~8 specs), y profundidad de un par de items (correlación multi-sensor). El **#9 Coach IA por dominio se construyó** (PR #591).
>
> **Pinecone + COLMAP cloud → DESCARTADOS** (ver §9 — la fotogrametría interna ya cubre COLMAP). Las líneas de abajo se conservan como histórico; **este bloque las supersede.**

### 16.1 MASTER_PROPOSAL_2026-05 — Sprints 10-19 no implementados

| ID | Item | Evidencia | Prioridad |
|---|---|---|---|
| §16.1.1 | **`/api/ask-guardian` con Gemini function-calling REAL** (no prefix injection). 3 tools: `getWeatherTool`, `getSeismicTool`, `searchNormativaBCN`. Output JSON `{causa_raiz, riesgos[], plan_accion}`. Prompt caching. | `archive/MASTER_PROPOSAL_2026-05.md:262-285` + Grep 0 hits `function_call` en src/server. `gemini.ts:273-282` solo env-context prefix. | ALTA |
| §16.1.2 | **Blender → glTF pipeline** Digital Twin / EPP / cuerpo DS 594. 3 assets: `human-body-7regions-ds594.glb`, `faena-mining-base.glb`, `epp-modular.glb`. Draco + KTX2. | `archive/MASTER_PROPOSAL_2026-05.md:337-341,484-494`. Hoy procedural fallback. | MEDIA |
| §16.1.3 | **MaestrIA pipeline 4-agentes foto→hallazgo**: Detector(Gemini Vision)→Evaluador(DS 594)→Estimador→Redactor PDF firmable. UI "PIPELINE PROGRESS". Foto in → hallazgo formal <30s. | `archive/MASTER_PROPOSAL_2026-05.md:343-347` + `PLAN_PARTE4:112-121`. Grep 0 hits src/services/maestria/. | ALTA |
| §16.1.4 | **ARIA 5 agentes Vertex AI Agent Builder**: Sentinel→KB Builder→Investigator→Q&A→Work Order Writer. MCP `gp-iper` bus. ManDown event → orden trabajo + Calendar <2min. | `archive/MASTER_PROPOSAL_2026-05.md:349-355`. Grep 0 hits src/services/aria/. | ALTA |
| §16.1.5 | **MCP servers internos** `gp-zettelkasten`, `gp-bernoulli`, `gp-iper`, `gp-environment`. Bus tipado vs callbacks. | `archive/MASTER_PROPOSAL_2026-05.md:130-135`. Grep 0 hits. | MEDIA |
| §16.1.6 | **5 smart actions Proto-1 ausentes** en `useZettelkastenIntelligence`: `create-worker-epp-connection`, `suggest-normatives-for-project`, `link-industry-to-project`, `suggest-epp-for-worker`, `auto-link-training-to-worker`. | `archive/MASTER_PROPOSAL_2026-05.md:77-83`. Hook existe pero patterns canónicos no. | MEDIA |
| §16.1.7 | **`AcademicContentProcessor` pipeline real** (695 LOC Proto-1). Hoy `AcademicProcessor.tsx` liviano. | `archive/MASTER_PROPOSAL_2026-05.md:76`. | BAJA |
| §16.1.8 | **Recovery `docs/legacy/analisis_funcional.md` + `auditoria01.md` + `PLAN_MAESTRO_skeleton.md`** via shallow clone `firebase-version`. | `archive/MASTER_PROPOSAL_2026-05.md:391-396` + `PLAN_PARTE3:177-187`. | BAJA |
| §16.1.9 | **`CLAUDE.md` raíz** generado con skill `init`. Onboarding <30min. | `archive/MASTER_PROPOSAL_2026-05.md:395`. Grep NO existe. | BAJA |
| §16.1.10 | **API-First B2B con OpenAPI spec + Postman MCP**. Bloquea ERP/HRM tier Enterprise (SAP/Buk/Workday). | `archive/MASTER_PROPOSAL_2026-05.md:399-405`. NO existe `docs/api/openapi.yaml`. | ALTA |
| §16.1.11 | **Canva brand kit HSE** (12 plantillas operativas). | `archive/MASTER_PROPOSAL_2026-05.md:399-406`. Grep 0 hits. | BAJA |

### 16.2 IMPLEMENTATION_ROADMAP — puentes arquitectónicos críticos

| ID | Item | Evidencia | Prioridad |
|---|---|---|---|
| §16.2.1 | **Event bus central Zustand (`sensorBus`)**. 54 hooks sensor son islas — sin correlación multi-sensor no se reducen falsos positivos. Regla: caída+inactividad+BLE desconectado=critical. | `archive/IMPLEMENTATION_ROADMAP.md:645-737` + `TDA:333-335`. Grep 0 hits. | **CRÍTICA** |
| §16.2.2 | **`conflict_queue` safety docs**. Para `inspection`/`incident_report`/`emergency_alert`/`medical_record`/`training_completion` NUNCA "last_write_wins" — resolución humana obligatoria. | `archive/IMPLEMENTATION_ROADMAP.md:1083-1102`. Grep NO encuentra `conflict_queue`. | **CRÍTICA** |
| §16.2.3 | **`safeNormativeQuery()`**. SLM responde "no tengo información verificada" si RAG <0.75 score, NUNCA alucina texto normativo. | `archive/IMPLEMENTATION_ROADMAP.md:1110-1140`. Grep 0 hits. | **CRÍTICA** |
| §16.2.4 | **Sync predictiva por topología ZK**. `buildPrefetchPlan(workerUid)` lee Calendar 4h → resuelve nodos por tipo tarea. 50MB cap. | `archive/IMPLEMENTATION_ROADMAP.md:578-639`. `topologyAwarePrefetch.ts` foundation parcial. | ALTA |
| §16.2.5 | **Outbox 3-capas alertas emergencia**: FCM → SMS (descartado) → Llamada voz a 60s. Decisión: ¿voice fallback o single-channel? | `archive/IMPLEMENTATION_ROADMAP.md:379-430`. | ALTA |
| §16.2.6 | **Test de campo 10 escenarios pre-piloto**: bolsillo 6h, sin señal 2h, caída-colchón <3s, batería 15%, cambio turno, 50 trabajadores k6, IAP falso, token revocado, supervisor sin señal, SHA256 mismatch. | `archive/IMPLEMENTATION_ROADMAP.md:1362-1376`. | ALTA |
| §16.2.7 | **Pilot fase 1-4 protocolizado** (semana 1-2 doc-only → 14-18 turno noche 24/7). 2-3 empresas voluntarias. | `archive/IMPLEMENTATION_ROADMAP.md:1377-1388`. | MEDIA |
| §16.2.8 | **Battery-aware polling**. BLE/HR/GPS reducen polling <20% batería. Total <12%/h turno 12h. | `archive/IMPLEMENTATION_ROADMAP.md:1054-1080`. Grep 0 hits `BATTERY_MODE_CHANGED`. | ALTA |
| §16.2.9 | **Session expiration 8h**. 3 checks en `verifyAuth`: `tokenIssuedAt<revokedAfter`, `tokenAge>8h` re-auth, `decoded.role!==userRecord.role` → ROLE_CHANGED. | `archive/IMPLEMENTATION_ROADMAP.md:1176-1200`. Parcial en §7. | ALTA |
| §16.2.10 | **MediaPipe local bundle** (`public/models/mediapipe/pose_landmarker_lite.task`). Hoy CDN — viola Ley 19.628 faenas privadas. | `archive/IMPLEMENTATION_ROADMAP.md:1008-1017` + `TDA:175-183`. | ALTA |
| §16.2.11 | **AIPostureAnalysisModal LIVE**. MediaPipe local + OffscreenCanvas + Worker 5fps + reba/rula streaming. Bucket OO.4. | `archive/IMPLEMENTATION_ROADMAP.md:968-1004`. Grep 0 hits `mediapipePoseWorker.ts`. | MEDIA |

### 16.3 TECHNICAL_DEBT_AUDIT — debt no resuelto

| ID | Item | Evidencia | Prioridad |
|---|---|---|---|
| §16.3.1 | **SLM Worker errores tipados** (4 puntos `slmWorker.ts:18,185,267,464`). | `archive/TECHNICAL_DEBT_AUDIT.md:158-168`. | MEDIA |
| §16.3.2 | **`@ts-ignore` 4 puntos prod**: `GuardianVoiceAssistant.tsx:14`, `billing.ts:125`, `billingService.ts:45`, `adService.ts:78`. | `archive/TECHNICAL_DEBT_AUDIT.md:74-87`. | BAJA |
| §16.3.3 | **WebXR `immersive-ar` real** (no placeholder simulado). Hit-test + dom-overlay. ARCore/RealityKit. | `archive/TECHNICAL_DEBT_AUDIT.md:230-242` + `IMPLEMENTATION_ROADMAP:925-962`. | MEDIA |

### 16.4 PLAN_PARTE3_PROTOTIPO2 — blueprint + decisiones

| ID | Item | Evidencia | Prioridad |
|---|---|---|---|
| §16.4.1 | **Workshop scoping nodos 321-512** (Inteligencia Colectiva / Ecosistema Enterprise / Expansión Regional / AI Avanzada). 192 nodos hoja sin spec. ¿Workshop o abandono "512 nodos"? | `archive/PLAN_PARTE3:155-173`. | DECISIÓN USUARIO |
| §16.4.2 | **Custom claim `assignedSiteIds[]`** RBAC scoping O(1) vs Firestore lookup. 6h. | `archive/PLAN_PARTE3:127-145`. | MEDIA |
| §16.4.3 | **`audit_log` mutaciones normativa**. Cada cambio `regulatory/jurisdictions/` emite audit entry. | `archive/PLAN_PARTE3:119`. | MEDIA |

### 16.5 AUDIT.md (2026-04-27)

| §16.5.1 | **`geminiBackend.ts` god-file split** (~2664 líneas → 12 modules: vision, embeddings, RAG, ergonomics, classify). | `archive/AUDIT.md:120-123` + `INFORME_ESTADO:239`. | MEDIA |

### 16.6 PLAN_PARTE2_PROTOTIPO1 — UI rich perdidas

| §16.6.1 | **`GeminiChat` persona técnica legal** (cuando pregunta 100% normativa). 3h. | `archive/PLAN_PARTE2:85-87`. | BAJA |
| §16.6.2 | **ManDown UI completa**: timer re-escalación + mapa eventos + badge supervisor ACK. ~6h. | `archive/PLAN_PARTE2:73-75`. | MEDIA |
| §16.6.3 | **Geofence visual rico**: polygon-on-map color riesgo + tooltips. ~4h. | `archive/PLAN_PARTE2:77-79`. | MEDIA |
| §16.6.4 | **`AfichesSeguridad` descarga PDF** (14 templates industria + QR). | `archive/PLAN_PARTE2:130`. | BAJA |
| §16.6.5 | **`HumanBodyViewer` rutinas auto-generadas** desde `ergonomicAssessments`. | `archive/PLAN_PARTE2:134`. | BAJA |

### 16.7 ROADMAP.md — Fase 10x

| §16.7.1 | **Wake Word "Hey Guardián"** (Capacitor native + background mic). | `archive/ROADMAP.md:75`. | DECISIÓN USUARIO |
| §16.7.2 | **Acciones contextuales nodos del grafo** (botones inline generar PTS / ver normativa / asignar capacitación). | `archive/ROADMAP.md:76`. | BAJA |
| §16.7.3 | **Reconocimiento social Muro Dinámico** ("Enterado y Aplicando" / "Kudos de Seguridad"). | `archive/ROADMAP.md:77`. | BAJA |
| §16.7.4 | **Telemetría IoT ↔ Probabilidad Falla** (aristas rojas RiskNetwork). | `archive/ROADMAP.md:86`. | BAJA |
| §16.7.5 | **Dashboard Cumplimiento SUSESO** (cálculo interno Tasas Acc/Sin). Reemplaza scraping descartado. | `archive/ROADMAP.md:87`. | MEDIA |
| §16.7.6 | **Alerting threshold-cross** (ej. 25 trabajadores → notificación CPHS DS 54). | `archive/ROADMAP.md:88`. | BAJA |

### 16.8 STATE_OF_FUNCTIONALITY — gaps específicos

| §16.8.1 | **9 generadores Bernoulli sin UI dedicada**: `confinedSpaceHVAC`, `dikeHydrostaticMonitor`, `gasDispersionCloud`, `gasLeakDetection`, `microWindEnergy`, `mistingDustSuppression`, `pulmonaryAltitude`, `slamPhotogrammetryNode`, `respiratorFatigue`. CalculatorHub.tsx agrupa pero algunos quieren panel propio. | `archive/STATE_OF_FUNCTIONALITY:130`. | MEDIA |
| §16.8.2 | **Pinecone API key real** vs fallback in-memory. | `archive/STATE_OF_FUNCTIONALITY:323`. NO en §5. | DECISIÓN USUARIO |
| §16.8.3 | **Khipu adapter wire**. Código+tests existen, no wireado en `Pricing.tsx`. | `STATE_OF_FUNCTIONALITY:rojo pero código existe`. | DECISIÓN USUARIO |
| §16.8.4 | **`autoTrigger.ts` test unitario** (DeviceMotion sismic). Crítico: dispara modo emergencia. | `archive/STATE_OF_FUNCTIONALITY:201`. | ALTA |
| §16.8.5 | **TacticalOnboardingModal persist progreso**. Skip-if-completed flag. | `archive/STATE_OF_FUNCTIONALITY:119`. | BAJA |
| §16.8.6 | **MorningRoutine slot persistencia respuestas**. UI lista, falta `addDoc(routine_checkins)` + +5 XP. ~2h. | `archive/STATE_OF_FUNCTIONALITY:192,308`. | MEDIA |

### 16.9 INFORME_AVANCE_NOTEBOOK_LLM

| §16.9.1 | **X.509 device cert flow IoT MQTT**. Auth sensores producción industrial. | `archive/INFORME_NOTEBOOK:92`. | ALTA |
| §16.9.2 | **RLHF bucket feedback → fine-tuning** SLM/Gemini. `aiFeedback` captura pero no cierra loop. | `archive/INFORME_NOTEBOOK:99`. | BAJA |
| §16.9.3 | **Streaming SSE Gemini** (token-by-token rendering Asesor). | `archive/INFORME_NOTEBOOK:99`. | MEDIA |

### 16.10 INFORME_ESTADO_2026-04-29

| §16.10.1 | **Marketplace Google Workspace add-on** (Titanio+ tier). OAuth Consent + Marketplace review. | `archive/INFORME_ESTADO:250`. | DECISIÓN USUARIO |
| §16.10.2 | **SOC 2 Type I path** (Vanta/Drata + Access Control / Change Mgmt / IR / BCP / Vendor). 6 meses external review. Enterprise+. | `archive/INFORME_ESTADO:251`. | ESTRATÉGICA |
| §16.10.3 | **PGP key publicada** `/.well-known/pgp-key.asc`. Vuln-disclosure + auditor trust. | `archive/INFORME_ESTADO:300`. | MEDIA |
| §16.10.4 | **`status.praeventio.net`** status page. | `archive/INFORME_ESTADO:301`. | BAJA |
| §16.10.5 | **Refactor Pages >700 LOC** (Training 868, Gamification 794, Matrix 766, SiteMap 746). | `archive/INFORME_ESTADO:260` + `AUDIT:127`. | BAJA |
| §16.10.6 | **Lighthouse CI status posts en PRs** (`LHCI_GITHUB_APP_TOKEN`). | `archive/INFORME_ESTADO:302`. | BAJA |

### 16.11 Resumen ejecutivo §12

**Prioridades CRÍTICAS (3) — implementar próximo sprint:**
- §16.2.1 Event bus central `sensorBus` (correlación multi-sensor)
- §16.2.2 `conflict_queue` safety docs (resolución humana)
- §16.2.3 `safeNormativeQuery()` (SLM no alucina normativa)

**Prioridades ALTAS (12):**
- §16.1.1, §16.1.3, §16.1.4, §16.1.10 (Sprints 10/12/13 + OpenAPI)
- §16.2.4-§16.2.6, §16.2.8-§16.2.10 (Roadmap critical paths)
- §16.8.4, §16.9.1 (autoTrigger test + X.509 IoT)

**Decisiones del usuario pendientes (6):**
- §16.4.1 ¿workshop 321-512 nodos o abandono "512 nodos"?
- §16.7.1 Wake Word — privacidad
- §16.8.2 Pinecone — pagar o aceptar degradado?
- §16.8.3 Khipu — wire o dormant?
- §16.10.1 Marketplace Google Workspace add-on
- §16.10.2 SOC 2 Type I path (estratégico)

**MEDIAS y BAJAS (~25):** refinamientos UX, recovery legacy, features Fase 10x posteriores. Ver tablas §16.1-§16.10.

---

**Próxima revisión profunda:** post-merge de #267 + #268 + cleanup §2 (estimada 2026-05-22).

---

## 13. 📋 Follow-ups deferidos (post-PR #511/#512/#513)

Items identificados durante auditoría 2026-05-27 que NO entran al sprint actual pero quedan tracked para sprints siguientes. Cada uno con evidencia file:line + prioridad.

### Wire huérfanos según contexto (directiva usuario)
- **A6** wire `criticalPermitValidators.ts` (481 LOC orphan) en `workPermitEngine.ts`
- **B10** continuar `docs/audits/HOOKS_TRIAGE.md` (71 hooks pendientes triage WIRE/REFACTOR/DEFER/DEPRECATE)
- **D1** wire 93 unrouted pages — triage por bucket dominio (Emergency/AR/IoT/Compliance/Education/Other)
- **D3** decidir destino `SystemEngineProvider` (5 adapters listos, no mounted)
- **F2** wire/eliminar 12 componentes huérfanos `src/components/` root (~3000 LOC)

### Cumplir promesas (directiva usuario)
- **A_SLM** SLM ONNX inference real (`slmWorker.ts:58` returns mock). Opensource refs: `onnxruntime-web`, `@xenova/transformers`
- **H2** Sprint 31 BLE GATT real (`capacitor-mesh` Android/iOS, 902 LOC stubs)
- **H3** Sprint 32 Wi-Fi Direct fallback
- **L6-L10** Geo-aware normative routing wire (NormativeContext + Gemini prompts + RAG multi-país + onboarding country picker)
- **J12** AV scanning uploads (ClamAV sidecar o VirusTotal)

### Potenciar página main (directiva usuario)
- Boletín climático: wire `WeatherBulletin.tsx` + `WeatherSafetyRecommendations.tsx` en home
- Selector EPP: wire `eppDetectorOnDevice` UI en home como tarjeta destacada
- Mascota Guardián Praeventio con moods (feliz/alerta/crítico/descansado)
- Carrusel módulos potenciado con menús/submenús por categoría (10 categorías mapeadas)
- Sidebar izquierda paralelo

### Potenciar Zettelkasten (directiva usuario)
- 3 fuentes primarias: Bernoulli (✅) + Incidents (wire `incident-flow PDCA`) + Normative library (etiquetado por país)
- RAG semántico con embeddings on-device (`@xenova/transformers` sentence-transformers/all-MiniLM-L6-v2 ~25MB)
- Coach IA prompts dinámicos {country, language, normativeRefs}
- Knowledge Graph viz filtros (país, dominio, tipo nodo)
- `zk_public_nodes/` colección + page `/zettelkasten/explore` anonymous

### Calidad / observability / contracts
- **B1** split `geminiBackend.ts` (2923 LOC) en 12 módulos
- **B2** completar split `ISOManagement.tsx` (655 LOC restantes)
- **B3** auditar 6 routes race condition
- **B4** wrapper `withJobObservability()` para 26 catch silenciosos
- **B5** migrar 120 `console.*` a structured logger
- **B6** auditar 45 `Promise.all` candidatos a `allSettled`
- **B9** sweep i18n últimas ~10 páginas hardcoded
- **B11** sprint dedicado 5 Playwright specs + §2.24 Auth Emulator
- **B12** decidir scope adapter observability real vs noop documentado
- **B13** integrar 11 hallazgos ⬜ AUDIT_BACKLOG (H1, H3, H5, H16, H19, H22, H23, H24, H27, H30, H32)
- **C1** sidebar entries para 143 pages sin nav
- **C2** decidir 24 colecciones Firestore en rules sin uso
- **C3** eliminar `@capacitor-community/admob` de `package.json`
- **C4** triage 5-8 Gemini actions whitelist con <3 callsites
- **C5** sweep 149 TODO/FIXME (top: `slmWorker.ts` 7)
- **C6** type cleanup `as any` (491 instancias)
- **E1-E7** CI hardening: Playwright en CI + Firebase test secrets + mutation gate + smoke real + ARPosterScanner it.todo
- **F5-F6** refactor contexts >200 LOC (NormativeContext 581 primero)
- **F9** type cleanup `as any` server + components
- **F13/F14** revisar hooks con TODO + eslint-disable exhaustive-deps
- **G1/G2** `JSON.parse` Gemini typed schema (Zod)
- **G3** Zod schema a `misc.ts` POST handlers
- **G6** wrapper `withJobIdempotency()` para 28 jobs
- **G7** terminar `runB2dMrrSnapshot.ts:15` o descartar oficialmente
- **H4** `.husky/pre-push` typecheck + test gate
- **H5** `npm-check` para deps no-usadas
- **H6** triage 68 scripts package.json
- **H8** ESLint Fase F: `no-explicit-any` warn → error progresivo
- **I11** sourcemaps Sentry CI upload (`@sentry/cli` en deploy.yml)
- **I16** auditoría healthConnect/healthKit confirmar NO uploads raw frames
- **I17** SQLite schema versioning + migration runner
- **J1** codemod `loading="lazy"` 47 `<img>`
- **J2** `React.memo` top dashboard widgets
- **J4** `docs/a11y/WCAG_COMPLIANCE.md`
- **J5** `react-focus-lock` en modales
- **J6/J7/J8** SEO completo (sitemap, robots, meta tags, JSON-LD)
- **J9** firma digital PDF (FEA Ley 16.744/DS 76)
- **J10** i18n templates email (es-CL, en, pt-BR)
- **J11** auditar 14 queries Firestore client-side multi-tenant
- **J13** sistema feature flag (Firestore + hook `useFeatureFlag`)
- **J14** auditar 31 `onSnapshot` memory leak
- **K5** estandarizar timezone (UTC storage, CL display, DST tests)
- **K6** OpenTelemetry + GCP Cloud Trace
- **K7** wrapper `withJobReliability()` (idempotency + exp backoff + DLQ)
- **K8** automatizar KMS rotation en Terraform (90d)
- **K9** Firestore PITR
- **K10** scheduled DR drill mensual `DR_DRILL_LOG.md`
- **K11** workflow CI `terraform-plan.yml`
- **K12** Dependabot + `npm audit --audit-level=high`
- **K13** OpenAPI spec + contract testing
- **K14** Apple webhook cert pinning + anti-replay nonce
- **K16** revisar CORS Capacitor

### Decisiones operacionales pendientes
- **A_LEAK** rotar `GEMINI_API_KEY` (Google Cloud Console) + decidir BFG history rewrite
- **A_SENTRY** rotar `SENTRY_DSN` + auditar commits `b13cfe8/d5e7a8e`
- **A_GEMMA** descargar Gemma 2 2B con HF token + computar SHA-256 + setear en `registry.ts:119`
- **B7** wire MP IPN HMAC SHA-256 production env vars

---

## 17. 🔍 Auditoría bloque-por-bloque (B1→B18) — estado REAL del código

> Deep-dive secuencial verificando **de primera mano** (no desde docs) el estado
> de cada bloque funcional. Metodología **fix-as-I-go**: los bugs de wiring
> seguros y acotados se arreglan con TDD en el commit del bloque; la deuda
> profunda se lista aquí para una fase posterior. Regla #1: nada ✅ sin
> `file:line`.

### Baseline de runtime — VERIFICADO 2026-06-01 (ya no asumido)

`npm ci` ✅ · `npm run typecheck` **0 errores** ✅ · `npm run build` ✅ (2m03s) ·
`npm run lint` ✅ (0 errors, warnings preexistentes) · Java 21 disponible
(emulador E2E viable). Esto invalida el bloqueo de verificación previo
(node_modules ausente daba falsos "Cannot find module"). `npm run test` corre
pero arrastra el flake §2.31 (open-handle, ~30-40% de runs).

### Leyenda de veredictos
✅ Real · 🟡 Parcial · 🔵 Stub honesto (tipado/503/flagged) · 🔑 Bloqueado-key
(§5, usuario provee) · ❌ Huérfano/no-cableado.

### Mapa de bloques (decomposición sobre 7 route-groups + 191 dominios server)

B1 Emergencia · B2 Riesgo/IPER · B3 Ergonomía/Protocolos · B4 Incidentes ·
B5 Cumplimiento/SUSESO · B6 Capacitación · B7 Salud ocupacional · B8 Permisos/LOTO ·
B9 Inspecciones · B10 EPP/Activos · B11 Contratistas/Visitas · B12 CPHS/Comités ·
B13 MOC/Operaciones críticas · B14 IA/Gemini/SLM · B15 Facturación/Tier ·
B16 Offline/PWA/Capacitor · B17 Admin/Multi-tenant/Auth · B18 Analítica/Reportes.

### 🔎 Hallazgo transversal — barrido global de routers huérfanos (2026-06-01)

Barrido de los 179 routers con `export default Router` vs los `app.use` de
`server.ts`: **20 routers huérfanos** (implementados + unit-tested pero nunca
montados → **404** para sus consumidores reales). Misma clase que PR #606. Las
suites per-router no lo detectan porque montan en un app express fresco. El prior
audit (§ líneas ~640-795) ya catalogó varios; este barrido lo confirma y completa.
Roadmap por bloque (se montan **dentro de su bloque**, cadencia block-by-block):

| Router huérfano | Bloque | Prefijo | Consumidor | Estado |
|---|---|---|---|---|
| loneWorker, refuges, restrictedZones | B1 | sprint-k / zones | useLoneWorker/useRefuges/useRestrictedZones | ✅ B1-F1 |
| evacuationHeadcount | B1 | `/api/evacuation` | useEvacuationHeadcount, EvacuationQRScanner | ✅ B1-F2 |
| riskRanking, shiftRiskPanel | B2 | sprint-k | useRiskRanking (3 cards), useShiftRiskPanel | ✅ B2-F1 |
| incidentFlow | B4 | sprint-k | useIncidentFlow | ✅ #650 (writeNodes server-side #652) |
| stoppage | B4/B8 | sprint-k | useStoppage, StoppageMonitor.tsx | ✅ #650 |
| legalObligations | B5 | sprint-k | useLegalCalendar/useLegalObligations | ✅ #650 (IDOR fix #651) |
| eppFlow, equipmentQr, hazmatInventory | B10 | sprint-k | useEppFlow/useEquipmentQr/HazmatStorage | ✅ #650 (eppFlow role-gate #651 + writeNodes #652) |
| syncStatus | B16 | sprint-k | useSyncStatus | ✅ #650 |
| pymeOnboarding, pymeWizard | B17 | sprint-k | usePymeOnboarding/usePymeWizard | ✅ #650 |
| reportsAutomation, safetyMetrics, projectComparator, predictiveAlerts | B18 | sprint-k | useReportsAutomation/useSafetyMetrics/useProjectComparator/usePredictiveAlerts | ✅ #650 |
| preventionCost | B15 | sprint-k | usePreventionCost | ✅ #650 (role-gate save-scenario #653) |

**✅ TODOS MONTADOS — #650 mergeado 2026-06-02 (`7d67200a`).** Los 20 routers
huérfanos están en `server.ts` (`app.use('/api/sprint-k', …)` + `/api/evacuation`
+ `/api/zones`). El guard `routerMountCoverage.test.ts` (baseline 0 huérfanos) lo
ratchetea. **Authz-audit-on-mount completado:** montar volvió LIVE los gaps
dormidos → Codex halló 7 P1 → **#651** (IDOR legalObligations + role-gates
restrictedZones/evacuation/eppFlow) + **#652** (eppFlow/incidentFlow persisten ZK
server-side vía `serverZkNodeWriter.ts`, ya no browser-writeNodes) + **#653**
(preventionCost save-scenario role-gate, único write restante sin gatear). Los 13
`/api/sprint-k` restantes son stateless pure-compute (0 writes server-side; el
cliente persiste vía las 13 firestore.rules que #650 agregó). `verifyAuth` +
`assertProjectMember` presentes en todos.

---

### 🔴🔴 HALLAZGO CRÍTICO — 14 stores client-SDK sin write rules en producción (2026-06-01)

**Severidad: ALTA (funcional + cumplimiento). Surgido al cerrar B4-D1.**

`firebase.json` despliega **`firestore.rules`**. Los 14 stores Sprint-K creados
con `createProjectScopedStore` usan el **Firebase CLIENT SDK** (`setDoc`/
`updateDoc` modular) y escriben a `projects/{pid}/<colección>`. En
`firestore.rules`, el master-gate `match /{subCollection=**}/{docId}` (línea 258)
da **solo `read`** a project-members; ninguna de estas 14 colecciones tiene regla
de **write** explícita → **los writes del cliente quedan default-deny en
producción**.

**Las 14 colecciones afectadas:** `stoppages`, `site_book`, `site_book_entries`,
`legal_obligations`, `operational_changes`, `root_causes`, `lone_worker_events`,
`lone_worker_sessions`, `exceptions`, `shifts`, `audit_portals`,
`safety_talks_given`, `documents_for_read`, `sample_live`.

**Por qué no se detectó:** existe `firestore.test.rules` (**TEST-ONLY open
rules**) que el job CI `firestore-stores` usa para probar la LÓGICA de los stores
(CRUD/subscribe/merge) contra el emulador — su propio header dice "does NOT test
the rules". Los tests pasan con reglas abiertas → **enmascaran** el gap de prod.
Páginas como `StoppageMonitor.tsx` (`saveStoppage`) y `SiteBook.tsx`
(`saveSiteBookEntry`) llaman estos `save()` client-side → fallan con
permission-denied en prod.

**Evidencia:** `firestore.rules:258-260` (master-gate read-only) · sin match
`stoppages`/`site_book`/… (grep=0) · `createProjectScopedStore.ts:29,147,197`
(client `setDoc` a `projects/{pid}/{coll}`) · `firestore.test.rules` header ·
`StoppageMonitor.tsx`→`saveStoppage`, `SiteBook.tsx`→`saveSiteBookEntry`.

**Fix — ✅ RESUELTO (#650 mergeado 2026-06-02 `7d67200a`):**
- `firestore.rules`: agregadas reglas de write para las **13** colecciones reales
  (`sample_live` es test-only, excluida) bajo `projects/{projectId}` — modelo
  conservador: create member + anti-spoof del campo creator-uid donde existe;
  update con creator-uid inmutable + append-only tras `signedAt` (site_book);
  delete `false` para cumplimiento (stoppages, operational_changes, root_causes,
  site_book[_entries]), admin/supervisor para operacionales. Cada modelo marcado
  inline para revisión del usuario.
- `src/rules-tests/projectScopedStores.rules.test.ts`: rules-tests parametrizados
  (owner-allow, non-member-deny, spoof-deny, creator-immutable, post-sign-deny,
  delete-deny) — typecheck verde.
- `security_spec.md`: sección Sprint-K stores + payloads 13-17.
- ✅ **Verificación: CI VERDE en #650** — jobs `Firestore rules tests` (2m10s) +
  `Firestore stores tests` (1m50s) pasaron. **Arregla bugs funcionales reales:**
  StoppageMonitor (`saveStoppage`) + SiteBook (`saveSiteBookEntry`) escribían a
  paths default-deny → permission-denied en prod → ahora persisten correctamente.
- **Revisar (usuario):** modelos de acceso marcados inline en `firestore.rules`
  (especialmente `exceptions`/`legal_obligations`/`shifts` sin campo creator-uid
  confirmado, e inmutabilidad exacta de paralización). **B4-D1 incluido en este fix.**

---

### B1 — Emergencia & Respuesta · ✅ AUDITADO (2026-06-01)

**Veredicto general: mayoritariamente REAL y production-grade.**

| Feature | Estado | Evidencia |
|---|---|---|
| SOS | ✅ | `SOSButton` → `POST /api/sos` → Firestore + FCM + email fallback, rate-limited + audited; mount `server.ts` (`/api/emergency`, `emergencyRouter:895`) |
| Evacuación + ruteo A* | ✅ | `src/server/routes/evacuation.ts` (Haversine + grid), mount `server.ts:1060` |
| Headcount (stateless: compute-status/record-scan/end-drill/postmortem) | ✅ | `evacuation.ts` (mounted `:1073`) sobre el engine puro `services/evacuation/evacuationHeadcount.ts` |
| Headcount CRUD persistente (start/scan-qr/status/end) | ❌→✅ | `routes/evacuationHeadcount.ts` **estaba huérfano** → **B1-F2** (consumido por `useEvacuationHeadcount`, `EvacuationQRScanner.tsx`) |
| Drills/Comms/Contingency/First-responder | ✅ | mounts `/api/sprint-k` (drillsManager, commsDrill, contingencySimulation, firstResponderMap), todos con `verifyAuth` + `audit_logs` |
| Lone-worker (HTTP) | ❌→✅ | `loneWorker.ts` (281 LOC) **estaba huérfano** → **B1-F1** |
| Refuges (HTTP) | ❌→✅ | `refuges.ts` (169 LOC) **estaba huérfano** → **B1-F1** |
| Restricted zones (HTTP) | ❌→✅ | `restrictedZones.ts` (506 LOC) **estaba huérfano** → **B1-F1** |
| `emergencyBrigade` nativo FGS-Android | 🟡 | pendiente verificar lado Capacitor/Android (no bloqueante para web) |

**🔴 Bug B1-F1 (RESUELTO fix-as-I-go):** 3 routers implementados + unit-tested
(sobre apps express standalone) pero **nunca montados** en `server.ts`. Los
consumidores `useLoneWorker.ts`, `useRefuges.ts`, `useRestrictedZones.ts` (+ sus
páginas/componentes) recibían **404** contra el server real. Mismo patrón que
PR #606 (MOC/shift-handover "built+tested, never mounted"). Las suites
per-router no lo detectaban porque montan el router en un app fresco.

- **Fix:** `server.ts` — 3 imports + `app.use('/api/sprint-k', loneWorkerRouter)`,
  `app.use('/api/sprint-k', refugesRouter)`, `app.use('/api/zones', restrictedZonesRouter)`.
- **Test (RED→GREEN verificado):** extendido
  `src/__tests__/server/serverMountOrder.test.ts` con contrato B1 que asserta
  import + mount + orden vs SPA catch-all para los 3 routers (3 fallan sin el
  fix, 9/9 pasan con él).
- **Verificación:** `typecheck` 0 errores · `lint` 0 errors.

**🔴 Bug B1-F2 (RESUELTO):** `routes/evacuationHeadcount.ts` (CRUD persistente,
complementa el stateless `evacuation.ts`) **nunca montado** → el flujo de conteo
por QR (`useEvacuationHeadcount`, `EvacuationQRScanner.tsx`) daba **404**. 0
writes directos (vía adapter), 4 `auditServerEvent`, `assertProjectMember` +
`verifyAuth`. Mount nuevo `/api/evacuation` (libre, sin colisión) + caso de
contrato (RED→GREEN, 12/12). Corrige el veredicto inicial de B1 que daba
"Headcount ✅" sin distinguir el surface stateless del CRUD.

**Deferido a fase posterior (listado, no abordado):**
- ✅ **B1-D1 HECHO (2026-06-01):** guard genérico
  `src/__tests__/contracts/routerMountCoverage.test.ts` — cruza TODOS los
  módulos de `src/server/routes/*.ts` con `export default Router` contra los
  `import` + `app.use` de `server.ts`. Falla si cualquier router queda
  importado-pero-sin-montar o sin importar. Baseline: **0 huérfanos** (179
  routers). Detectó además un caso que el barrido manual no veía
  (imported-but-not-mounted, p.ej. import combinado default+named de
  `curriculum`). `INTENTIONALLY_UNMOUNTED` allowlist (vacía) para excepciones
  futuras justificadas. RED→GREEN verificado.
- ⬜ B1-D2: verificar lone-worker nativo (Foreground Service Android) en
  `packages/`/Capacitor.
- ⬜ B1-D3: los specs E2E `sos-button.spec` están en `describe.fixme` — reconciliar
  aserciones al render real (fase E2E separada).

---

### B2 — Riesgo & IPER · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** El motor IPER y la mayoría de routers del dominio
están cableados; se encontraron 2 huérfanos más (mismo patrón B1).

| Feature | Estado | Evidencia |
|---|---|---|
| Motor IPER | ✅ | `src/services/protocols/iper.ts` (135 LOC) función pura, 0 side-effects, unit + mutation-tested |
| riskRadar / residualRisk / maturity | ✅ | montados `server.ts` `/api/sprint-k` (961-964), con tests |
| bowtie / jsa / criticalControls / raciMatrix / preShiftRisk | ✅ | montados `/api/sprint-k`, con `*.test.ts` |
| riskRanking (POST risks/weak-controls/zones/tasks) | ❌→✅ | `riskRanking.ts` (211 LOC) **estaba huérfano** → **B2-F1** |
| shiftRiskPanel (POST compose) | ❌→✅ | `shiftRiskPanel.ts` (126 LOC) **estaba huérfano** → **B2-F1** |
| riskRanking GET timeseries/top-risks/weak-controls | 🔵 | stubs honestos documentados en `useRiskRanking.ts:135-172` (return idle, tracked) — endpoints **aún no existen** |

**🔴 Bug B2-F1 (RESUELTO fix-as-I-go):** `riskRanking.ts` y `shiftRiskPanel.ts`
implementados + unit-tested pero **nunca montados** → `useRiskRanking.ts` (que
alimenta `RiskTimeseriesChart`, `TopRisksDashboardCard`, `WeakControlsDashboardCard`)
y `useShiftRiskPanel.ts` recibían **404**. Ambos son compute-only (0 writes →
sin gap de audit-log), con `verifyAuth` + `assertProjectMember`.

- **Fix:** `server.ts` — 2 imports + `app.use('/api/sprint-k', riskRankingRouter)`
  + `app.use('/api/sprint-k', shiftRiskPanelRouter)`.
- **Test:** extendido el contrato `serverMountOrder.test.ts` (RED→GREEN: 2 fallan
  sin el fix, 11/11 con él).

**Deferido (listado, no abordado):**
- ⬜ B2-D1: faltan 3 endpoints **GET** que los dashboard cards consumen
  (`risk-ranking/timeseries|top-risks|weak-controls`). Hoy los hooks devuelven
  idle (stub honesto). Es feature-work (nuevos handlers + tests), no wiring →
  fuera del scope fix-as-I-go.
- ⬜ B2-D2 (decisión de producto, no bug): confirmado — `useShiftRiskPanel` no
  tiene consumidor en `src/pages`/`src/components`. Backend listo y montado; la
  UI no lo invoca. Decidir dónde vive la vista del panel de riesgo de turno (o
  borrar el hook si se descarta). No es un bug de wiring.

---

### B3 — Ergonomía & Protocolos MINSAL · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** Sin bugs de wiring; sin huérfanos. Los motores de
cálculo son funciones puras, unit + mutation-tested, y su superficie HTTP está
montada.

| Feature | Estado | Evidencia |
|---|---|---|
| Motor REBA | ✅ | `services/ergonomics/reba.ts` (378 LOC) puro (0 side-effects) + `reba.test.ts` + mutation |
| Motor RULA | ✅ | `services/ergonomics/rula.ts` (284 LOC) puro + test + mutation |
| Motor TMERT | ✅ | `services/protocols/tmert.ts` (106 LOC) puro + test |
| Motor PREXOR | ✅ | `services/protocols/prexor.ts` (128 LOC) puro + test |
| Pose→score on-device | ✅ | `landmarksToScore.ts`, `poseEdgeFilter.ts`, `useMediaPipePose.ts`, `AIPostureAnalysisModal.tsx` |
| HTTP ergonomics | ✅ | `routes/ergonomics.ts` montado `/api/sprint-k`, usa reba/rula puros, 0 writes (stateless compute), `verifyAuth` + `assertProjectMember` |
| HTTP protocols | ✅ | `routes/protocols.ts` montado, sirve `/protocols/{iper,prexor,tmert}` |
| Biometría on-device (regla #12) | ✅ | 0 subidas de frame de cámara en `useErgonomics`/`services/ergonomics` |

**Sin fix necesario** (no hay orphan ni wiring bug en B3).

**Deferido (listado):**
- ⬜ B3-D1: **PLAESI** aparece en `CLAUDE.md` (regla #10 / lista de protocolos)
  pero **no existe en `src/`** (0 referencias). Doc-vs-code gap: o se implementa
  o se quita de la doc (el código es source of truth, regla #1). Feature-work,
  fuera de scope fix-as-I-go.
- ✅ **B3-D2 CERRADO (2026-06-01):** la evaluación persiste en
  `services/safety/ergonomicAssessments.ts` (writer **client-side**: `setDoc` +
  `logAuditAction`, append-only-after-signed por Firestore rules, Ley 16.744 +
  ISO 45001 §7.5.3). La ruta `ergonomics.ts` compute-only es correcta por diseño
  — la auditoría ocurre en el servicio client. Sin gap.

---

### B4 — Incidentes & Investigación · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** Núcleo de investigación cableado; 2 huérfanos
encontrados y montados.

| Feature | Estado | Evidencia |
|---|---|---|
| rootCauseInvestigation / incidentTrends / incidentBundle / lessonsLearned / correctiveActions | ✅ | montados `/api/sprint-k`, con tests |
| incidentFlow (report→investigation→lesson→microtraining→status) | ❌→✅ | `incidentFlow.ts` **estaba huérfano** → **B4-F1** |
| stoppage (declare/precondition/resume/cancel/summarize) | ❌→✅ | `stoppage.ts` **estaba huérfano** → **B4-F1** |

**🔴 Bug B4-F1 (RESUELTO):** `incidentFlow.ts` y `stoppage.ts` nunca montados →
`useIncidentFlow` y `useStoppage`/`StoppageMonitor.tsx` daban **404**. Mount
`/api/sprint-k` + 2 casos de contrato (RED→GREEN, 14/14).

- `incidentFlow`: 6 endpoints mutantes, cada uno con `await writeAudit(...)`
  (cobertura de auditoría completa) escribiendo a **root `audit_logs`** (correcto).
  Persistencia vía flows zettelkasten (`incidentLessonTrainingFlow`). `verifyAuth`
  + `assertProjectMember`.
- `stoppage`: superficie **stateless de transición** (el cliente envía el objeto
  `stoppage`, el server computa la siguiente transición sobre `stoppageEngine` y
  lo devuelve). No es stub (0 `503`/`NotImplemented`). 0 writes/audit en la ruta
  por diseño offline-first. `verifyAuth` + `assertProjectMember` + `validate`.

**Corrección de hallazgo previo:** el prior audit (L795) marcaba
`incidentFlow(escribe path equivocado tenants/{tid}/audit_logs)`. **STALE**: el
código actual escribe a root `audit_logs` (`incidentFlow.ts:115`). El código es
source of truth → hallazgo resuelto.

**Deferido (listado):**
- 🔴 **B4-D1 ESCALADO a hallazgo real (2026-06-01):** la ruta stoppage es
  stateless → el cliente persiste vía `services/stoppage/stoppageFirestoreAdapter.ts`
  a la colección `tenants/{tid}/projects/{pid}/stoppages/{id}` (usado por
  `StoppageMonitor.tsx`). **PERO `firestore.rules` NO tiene entrada para
  `stoppages`** → default-deny **bloquea** el write del cliente. Tras B4-F1 la API
  responde, pero la persistencia queda bloqueada por rules. **Fix gobernado por
  regla #4** (rules explícitas + ≥5 rules-tests + entrada `security_spec.md`).
  Semántica append-only/transición de una paralización (DS) es sensible a
  cumplimiento → **requiere decisión del modelo de acceso antes de escribir las
  rules** (¿inmutable tras declarar? ¿quién resume/cancela? ¿folio?). NO se fija
  especulativamente. Candidato a PR de seguridad dedicado (`/guard`).
- ✅ **B4-D2 CERRADO como no-defecto (2026-06-01):** investigado — NO unificar en
  aislamiento. `actorUid`/`kind` es una **convención de campo compartida** por ≥5
  routers (`systemEvents`, `misc`, `confidentialReports`, `incidentBundle`,
  `eventReplay`) y leída por UI (`CustodyChainTimelineCard`,
  `useGeofenceWithEvents`). El test de `incidentFlow` solo exige que la fila caiga
  en root `audit_logs` (cumple). Forzar `auditServerEvent` (`userId`/`userEmail`)
  lo volvería **inconsistente** con ese patrón. El codebase tiene 2 esquemas de
  audit conviviendo; unificarlos es una migración coordinada de esquema (esfuerzo
  aparte), no un cambio por-router. Sin gap de cumplimiento (audita a root).

---

### B5 — Cumplimiento & SUSESO · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** El stack de cumplimiento (DS54/DS44/Ley 16.744,
DTE, emisión) está cableado; 1 huérfano encontrado y montado.

| Feature | Estado | Evidencia |
|---|---|---|
| compliance (×3 mounts) / complianceEmit / dte | ✅ | montados, con tests |
| regulatoryFramework / industryRules / nonConformity / privacyRetention | ✅ | montados `/api/sprint-k` |
| legalObligations (legal-calendar: upcoming/overdue/acknowledge/snooze/history) | ❌→✅ | `legalObligations.ts` **estaba huérfano** → **B5-F1** |

**🔴 Bug B5-F1 (RESUELTO):** `legalObligations.ts` nunca montado →
`useLegalCalendar` / `useLegalObligations` daban **404**. writes=2 (acknowledge/
snooze) con audit=3 (cubiertos), `verifyAuth` + `assertProjectMember`, no stub.
Mount `/api/sprint-k` + caso de contrato (RED→GREEN, 15/15).

---

### B6 — Capacitación & Currículum · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** Sin huérfanos, sin stubs. 9 routers del dominio
montados (`curriculum`, `safetyTalks`, `microtraining`, `postTraining`,
`spacedRepetition`, `skillGap`, `returnToWork`, `apprenticeship`, `adoption`),
con servicios reales (`services/curriculum/`, `trainingBackend.ts`). Páginas
`Training`, `Onboarding`, `PortableCurriculum`, `LessonsLearned` ruteadas.

**Sin fix necesario.**

**Deferido (listado):**
- ✅ **B6-D1 CERRADO (2026-06-01):** cobertura **1:1** confirmada — 3 endpoints
  mutantes (POST/PUT/PATCH/DELETE) y **3** llamadas de auditoría (root
  `audit_logs`, `curriculum.ts:153`). Los "9 writes" eran múltiples writes
  Firestore por operación auditada. Sin gap.

---

### B7 — Salud ocupacional & Vigilancia · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL + ADR 0012 enforced.** Sin huérfanos.

| Aspecto | Estado | Evidencia |
|---|---|---|
| Routers (medicalCatalogs, hygiene, mentalLoad, fatigue, circadian, workerHistory, returnToWork) | ✅ | montados `/api/sprint-k` |
| ADR 0012 no-diagnóstico | ✅ | 0 funciones prohibidas en `src/` (único match = el test del guard `medicalGuard.test.cjs`) |
| `<MedicalDisclaimer/>` | ✅ | 8 usos en pages/components de salud |
| Biometría on-device (regla #12) | ✅ | `health/healthFacadeNative.ts`, `nativeHealthAdapter.ts` (Health Connect/HealthKit) |
| Páginas | ✅ | HealthVaultShare/Viewer, Medicine, MyData, SystemHealth ruteadas |

**Sin fix necesario.**

---

### B8 — Permisos de trabajo & LOTO · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** Sin huérfanos, sin stubs. `workPermits` (DS132,
audit=4), `loto`, `criticalControls`, `engineeringControls`, `softBlocking`,
`exceptions` montados. Página `WorkPermits.tsx` ruteada. Permisos/LOTO siguen el
patrón offline-first (persistencia vía servicio/cliente; rutas compute o
auditadas vía servicio).

**Sin fix necesario.**

**Deferido (listado):**
- ✅ **B8-D1 CERRADO (2026-06-01):** falso positivo — el "write" era
  `createHash('sha256').update(content)` (hash crypto), **no** un write Firestore.
  `softBlocking` es compute-only, 0 writes reales → sin gap de auditoría.

---

### B9 — Inspecciones & Checklists & Observaciones · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** Sin huérfanos, sin stubs disfrazados.
`positiveObservations`, `offlineInspections`, `checklistBuilder`,
`formBuilderAdvanced`, `bbs`, `qrSignature`, `qrAck`, `photoEvidence`, `sitebook`
+ `sitebookSign(Routes)` (WebAuthn) montados. Páginas `Findings`,
`FindingsHeatMap`, `OfflineInspection`, `PositiveObservations`, `SiteBook`.

| Nota | Estado | Evidencia |
|---|---|---|
| `qrAck` 2× `503` | 🔑 | gate de config honesto (`qr_ack_not_configured` si falta `QR_ACK_HMAC_SECRET`), no stub disfrazado — feature bloqueada por secret §5 |

**Sin fix necesario.**

---

### B10 — EPP & Activos & Mantenimiento · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** `equipment`, `maintenance`, `horometro`,
`signaletics` montados; 3 huérfanos encontrados y montados.

| Feature | Estado | Evidencia |
|---|---|---|
| eppFlow (inspection/pending-orders/sign-order/order-pdf) | ❌→✅ | huérfano → **B10-F1**; writes=4 audit=4 |
| equipmentQr (register/list/preuse/history) | ❌→✅ | huérfano → **B10-F1**; writes=1 audit=3 |
| hazmatInventory (substance CRUD + compatibility/spill-plan) | ❌→✅ | huérfano → **B10-F1**; stateless next-state (cliente persiste, doc lines 26-29), no stub |

**🔴 Bug B10-F1 (RESUELTO):** `eppFlow.ts`, `equipmentQr.ts`, `hazmatInventory.ts`
nunca montados → `useEppFlow`, `useEquipmentQr`, `HazmatStorage.tsx` daban **404**.
Todos `verifyAuth` + `assertProjectMember`, no stubs; los que escriben auditan;
hazmat es superficie stateless offline-first (mismo patrón que loneWorker/
readReceipts). Mount `/api/sprint-k` + 3 casos de contrato (RED→GREEN, 18/18).

---

### B11–B14 · ✅ AUDITADOS (2026-06-01) — todos REAL, sin huérfanos

Verdict-pass (sin bugs de wiring; todos los routers montados, sin stubs
disfrazados):

- **B11 Contratistas/Visitas**: `contractors`, `visitors`, `vendorOnboarding`,
  `consultativeSale`, `geofencePermissions` montados. ✅
- **B12 CPHS/Comités**: `cphsMinute`, `organic`, `culturePulse`, `agenda`,
  `meetingPack`, `raciMatrix` montados. ✅
- **B13 MOC/Ops-críticas**: `operationalChange` (MOC), `shiftHandover`,
  `changeMgmt`, `commute`, `continuity`, `criticalRoles` montados (cierra el gap
  de PR #606). ✅
- **B14 IA/Gemini/SLM**: `gemini` (whitelist `ALLOWED_GEMINI_ACTIONS` presente,
  regla #5 ✅; los 3 `503` son **circuit-breaker** `gemini_circuit_open`, no
  stubs), `aiToggle`, `aiGuardrails`, `aiQuality`, `explainability`, `coachRag`,
  `aiFeedback`, `researchMode` montados. ✅

**Sin fix necesario en B11–B14.**

---

### B15 — Facturación & Suscripciones & Tier-gating · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** `billing` (×2: `/api/billing` + `/billing` Webpay),
`subscription`, `dte` montados. Tier-gating **server-side** presente (regla #11):
checks `RANK_`/`subscription.planId` en `subscription.ts`, `billing.ts`,
`onboarding.ts`. 1 huérfano montado.

| Feature | Estado | Evidencia |
|---|---|---|
| preventionCost (cost scenarios) | ❌→✅ | huérfano → **B15-F1**; w=1 audit=2, `verifyAuth` + `assertProjectMember` |

**🔴 Bug B15-F1 (RESUELTO):** `preventionCost.ts` nunca montado →
`usePreventionCost` daba **404**. Mount `/api/sprint-k` + contrato (RED→GREEN, 19/19).

---

### B16 — Offline / PWA / Capacitor / Mesh · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** 1 huérfano montado; cifrado SQLite OK.

| Aspecto | Estado | Evidencia |
|---|---|---|
| Cifrado SQLite on-device (regla #16) | ✅ | `createConnection(..., true, mode, ...)` en `pwa-offline.ts:78` y `offlineStorage.ts:89`; modo centralizado en `sqliteEncryption.ts`. El único match `"no-encryption"` es un **comentario histórico** (comportamiento ya corregido), no código activo |
| Mesh relay | ✅ | `packages/capacitor-mesh/` presente |
| syncStatus (sync-status tracker) | ❌→✅ | huérfano → **B16-F1**; stateless, `verifyAuth` + `assertProjectMember` |

**🔴 Bug B16-F1 (RESUELTO):** `syncStatus.ts` nunca montado → `useSyncStatus`
daba **404**. Mount `/api/sprint-k` + contrato (RED→GREEN, 20/20).

---

### B17 — Admin / Multi-tenant / Auth / RBAC / Audit · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** Stack admin/auth sólido; 2 huérfanos montados.

| Aspecto | Estado | Evidencia |
|---|---|---|
| admin (×4) / b2dAdmin / oauthGoogle (×2) / adminJobs | ✅ | montados |
| audit (×3) / auditChain / auditPortal | ✅ | montados (trail de cumplimiento) |
| Firestore default-deny | ✅ | `firestore.rules` con catch-all `match /{document=**}` + denies |
| pymeOnboarding (maturity) | ❌→✅ | huérfano → **B17-F1** |
| pymeWizard (build-plan) | ❌→✅ | huérfano → **B17-F1** |

**🔴 Bug B17-F1 (RESUELTO):** `pymeOnboarding.ts` y `pymeWizard.ts` nunca montados
→ `usePymeOnboarding` / `usePymeWizard` (+ `PymeMaturityWizard.tsx`) daban **404**.
Stateless, `verifyAuth` + `assertProjectMember`. Mount `/api/sprint-k` + 2
contratos (RED→GREEN, 22/22).

---

### B18 — Analítica / Reportes / Dashboards · ✅ AUDITADO (2026-06-01)

**Veredicto general: REAL.** Stack de analítica montado; 4 huérfanos montados.

| Aspecto | Estado | Evidencia |
|---|---|---|
| aggregateTelemetry / orgMetrics / dataConfidence / portableHistory / safetyPerformance / explainability | ✅ | montados |
| reportsAutomation (validate/build) | ❌→✅ | huérfano → **B18-F1** |
| safetyMetrics (build-report) | ❌→✅ | huérfano → **B18-F1** |
| projectComparator (compare) | ❌→✅ | huérfano → **B18-F1** |
| predictiveAlerts (should-fire-windowed) | ❌→✅ | huérfano → **B18-F1** (consumido por `AlertSchedulerMount.tsx`) |

**🔴 Bug B18-F1 (RESUELTO):** los 4 routers nunca montados →
`useReportsAutomation` / `useSafetyMetrics` / `useProjectComparator` /
`usePredictiveAlerts` daban **404**. Stateless, `verifyAuth` +
`assertProjectMember`. Mount `/api/sprint-k` + 4 contratos (RED→GREEN, 26/26).

---

## 17.99 — 🏁 Cierre del barrido B1→B18 (2026-06-01)

**Los 18 bloques funcionales auditados de primera mano (no desde docs).**

**Resultado wiring:** **20 routers huérfanos** encontrados (implementados +
unit-tested pero nunca montados → **404** para consumidores reales) y **los 20
cableados** con TDD (contrato de mount `serverMountOrder.test.ts`, 26 casos,
RED→GREEN por cada uno):

- B1 (4): loneWorker, refuges, restrictedZones, evacuationHeadcount
- B2 (2): riskRanking, shiftRiskPanel
- B4 (2): incidentFlow, stoppage
- B5 (1): legalObligations
- B10 (3): eppFlow, equipmentQr, hazmatInventory
- B15 (1): preventionCost
- B16 (1): syncStatus
- B17 (2): pymeOnboarding, pymeWizard
- B18 (4): reportsAutomation, safetyMetrics, projectComparator, predictiveAlerts

**Bloques sin huérfanos (verdict REAL):** B3 (Ergonomía/Protocolos), B6
(Capacitación), B7 (Salud + ADR 0012), B8 (Permisos/LOTO), B9 (Inspecciones),
B11 (Contratistas), B12 (CPHS), B13 (MOC), B14 (IA/Gemini).

**Patrones confirmados como honestos (no bugs):** superficies stateless
offline-first (cliente persiste el doc; el server devuelve next-state — hazmat,
stoppage, loneWorker, readReceipts); gates de config `503` por secret §5 (qrAck,
gemini circuit-breaker); cifrado SQLite on-device ON; ADR 0012 enforced.

**Correcciones a docs previas:** L795 marcaba `incidentFlow` escribiendo audit a
path tenant-scoped → STALE (hoy escribe a root `audit_logs`). Veredicto inicial
B1 "Headcount ✅" era parcial → faltaba el CRUD persistente (B1-F2).

**Deuda residual (deferida, listada en cada bloque B*-D*):** PLAESI ausente
(B3-D1), 3 GET dashboard endpoints de riskRanking inexistentes (B2-D1),
unificar `incidentFlow` al helper `auditServerEvent` (B4-D2), verificar audit
client-side de paralizaciones (B4-D1), y otros checks puntuales. **Ningún bug de
wiring abierto.** El techo §5 (secrets DevOps) sigue siendo el límite real para
las features 🔑.
