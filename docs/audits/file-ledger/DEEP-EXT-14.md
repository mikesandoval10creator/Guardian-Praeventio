# DEEP-EXT-14 — Auditoría exhaustiva de tests (Lote #14)

**Ámbito:** `category==="I-TEST"`, ordenado por `path`, slice `[715:770]` (55 archivos).
**Método:** lectura línea por línea de cada archivo. Caza de falsos-verdes:
rules-tests con Admin SDK / silent-pass, datos sintéticos del gate, asserts
equivocados, over-mocking, "ID crypto contract" tautológico, reimplementación
disfrazada, "wire-up contract" (solo `.stack`), `validate→next` sin 400,
asserts triviales/vacíos, skip/todo/fixme/`it()` vacío, snapshot-only, tests que
pasarían con impl incorrecta.
**Fecha:** 2026-06-03. **Doc-only, sin commit.**

---

## Veredicto global

Lote de **calidad muy alta**. El bloque `billing/*` es ejemplar: vectores RFC
(TOTP/HOTP RFC 4226/6238), known-answers FIPS 180-4 (sha256), keypairs RSA reales
para OIDC (firma + verificación + alg=none + tamper + clock-tolerance), HMAC real
con tamper/drift/length-mismatch, y baterías Stryker-targeted en `webpayAdapter`
(matriz code×status, masking PCI, env-routing capturado vía Options). Los motores
puros (`ergonomics`-style: bowtie, stowage, capacity, normativeAlerts) usan
aritmética exacta y casos límite. Inyección de dependencias limpia (fakes de
Firestore en memoria, seams `__set*ForTests`) — **no** se detectó Admin SDK en
contexto de rules-test, ni silent-pass, ni `validate→next` sin 400, ni
skip/todo/it-vacío, ni snapshot-only.

Hallazgos: **0 🔴 · 1 🟡 · 6 🔵.** Ninguno invalida un test; todos son
debilidades de cobertura/aserción, no falsos-verdes reales.

---

## 🟡 Medios

### 🟡-1 `appleTransactionValidator.test.ts` — la verificación criptográfica del JWS nunca se ejercita
`src/services/billing/appleTransactionValidator.test.ts:85-89` (y todos los casos
de `verifyJws`)
El seam `__setAppleSeamForTests` reemplaza `verifyJws` con una función que
**siempre** devuelve `{ payload, verifiedChain: false }`. Toda la suite valida la
lógica de mapeo (bundle/product/expired/revoked, status→reason) pero **ninguna
prueba ejerce la verificación real de la cadena JWS de Apple**, ni asserta que
`verifiedChain` sea exigido. Una regresión que aceptara un JWS con firma inválida
(o que ignorara `verifiedChain`) pasaría verde. Es el único módulo de pago donde
la firma se mockea por completo (contrastar con `khipuAdapter`/`mercadoPagoIpn`
que usan `node:crypto` real). Módulo: billing/IAP Apple. Recomendación: añadir un
caso negativo que pruebe que `verifiedChain:false` o firma inválida se rechaza, o
un round-trip con firma ES256 real (como hace `mercadoPagoIpn` con RSA).

---

## 🔵 Menores

### 🔵-1 `commsDrillEngine.test.ts` — OR-assertion no fija el umbral 80%
`src/services/commsDrill/commsDrillEngine.test.ts:63-71`
El test "80% confirmation → satisfactory" asserta
`expect(['satisfactory','deficient']).toContain(r.verdict)`. Acepta dos veredictos
opuestos, así que **no pinea el boundary** entre satisfactory y deficient: una
impl que clasificara mal ese tramo seguiría verde. El nombre del test promete más
de lo que verifica. Módulo: commsDrill.

### 🔵-2 `mercadoPagoIpnProduction.test.ts` — caso "legacy" tautológico
`src/services/billing/mercadoPagoIpnProduction.test.ts:185-201`
El test "detecta y verifica formato legacy `sha256=`" usa una firma falsa
(`'sha256=' + 'a'.repeat(64)`) que **nunca** puede coincidir y asserta `false`. El
propio comentario admite que solo verifica el *routing* por prefijo, no la
verificación legacy. Un verificador legacy roto que devolviera `false` para todo
pasaría igual. Es defendible (la verificación legacy real se prueba en
`mercadoPagoIpn.test.ts`), pero el assert no distingue "ruteó al legacy y falló la
firma" de "ruteó a ningún sitio". Módulo: billing/MP IPN.

### 🔵-3 `posterCatalog.test.ts` — `getPosterTitle` con `t` es tautológico
`src/services/ar/posterCatalog.test.ts:258-269`
Ambos casos de `getPosterTitle` asertan `=== p.title`, incluso pasando una función
`t`. El test del segundo caso reconoce explícitamente "por ahora ignora t — solo
verificar no-throw". Cuando la i18n se cablee, este test no detectará si `t` se
usa o no. Documenta un stub (aceptable), pero hoy no aporta señal de
comportamiento. Módulo: ar/posters.

### 🔵-4 `posterCatalog.test.ts` — filtro `onlyWithEmbedding` no-op auto-declarado
`src/services/ar/posterCatalog.test.ts:87-92`
`filterPosters({ onlyWithEmbedding:true })` solo asserta
`length >= 0` (siempre verdadero), con comentario "No-op para seed actual — al
menos garantizar que no rompe". No verifica que excluya posters sin embedding.
Cobertura vacía del branch. Módulo: ar/posters.

### 🔵-5 `prompts.test.ts` — schema/length-only, no verifica comportamiento
`src/services/coach/prompts.test.ts:27-95`
Suite de integridad de esquema: thresholds de longitud (`>80`, `>=2 examples`,
`>=3 citations`) y regex de citación. Útil contra "vaciar accidentalmente un
prompt", pero **no** verifica que el prompt produzca el comportamiento esperado
del coach (no es testeable sin LLM). Es content-shape, no behavior — legítimo en
su alcance pero con poder de mutación bajo (cambiar el texto de un prompt sin
tocar longitud/citas pasa). Módulo: coach.

### 🔵-6 `operationalChangeWorkflow.test.ts` — default-to-live en datos legacy
`src/services/changeMgmt/operationalChangeWorkflow.test.ts:396-400`
El test fija que un change con `status:undefined` (legacy) se trata como
`in_effect` (live). Es back-compat documentado, pero un default **a estado vivo**
es la dirección insegura (un registro corrupto/incompleto se considera activo).
No es un fallo del test —el test pinea correctamente la decisión— pero conviene
señalar que la decisión de diseño merece revisión de seguridad. Módulo:
changeMgmt/MOC.

---

## Notas de cobertura (sin hallazgo, positivas)

- `Math.random()` en helpers de test (`bbsObservationEngine.test.ts:14`,
  `bowtieAnalysisBuilder.test.ts:18`, etc.) → excepción permitida (regla #15 solo
  prohíbe en `src/server/` e ID-gen de prod).
- `webauthnChallenge.test.ts` cubre race condition concurrente, cross-uid
  isolation, replay, TTL boundary — excelente.
- `webpayAdapter.test.ts` (1591 LOC) es referencia de mutation-testing: cada
  assert documenta el mutante Stryker que mata; captura las `Options` del SDK para
  no dejar sobrevivir mutantes de env-routing.
- Adaptadores Firestore (`auditPortalFirestoreAdapter`, `operationalChangeFirestoreAdapter`)
  usan `createFakeFirestore` en memoria — son unit tests, **no** rules-tests; no
  aplica la prohibición de Admin SDK.
- `tamperProofChain.test.ts`, `idempotency.test.ts`, `tierEvaluation.test.ts`,
  `dwgDocumentValidator.test.ts` (FIPS known-answer) y `totp*.test.ts` (RFC
  vectors) son de calidad alta sin reservas.

---

## Archivos auditados (55)

ar/arPlatformPolicy · ar/arQuickLookFallback · ar/arSceneOrchestrator ·
ar/posterCatalog 🔵 · ar/posterMatcher · ar/usdzConverter · ar/webXrCapabilities ·
audit/expressBundleBuilder · audit/tamperProofChain ·
auditPortal/auditPortalFirestoreAdapter · auditPortal/externalAuditPortal ·
auth/customClaims · auth/projectMembership · auth/totp · auth/totpEnrollment ·
auth/webauthnChallenge · auth/webauthnCredentialStore · b2d/apiKeyService ·
battery/batteryAdvisor · behaviorObservation/bbsObservationEngine ·
billing/appleTransactionValidator 🟡 · billing/currency · billing/googlePlayValidator ·
billing/iapAdapter · billing/idempotency · billing/invoice · billing/khipuAdapter ·
billing/mercadoPagoAdapter · billing/mercadoPagoIpn ·
billing/mercadoPagoIpnProduction 🔵 · billing/mpJwksCache · billing/webpayAdapter ·
billing/webpayMetrics · bowtie/bowtieAnalysisBuilder · bundlePerf/bundleSizeAnalyzer ·
cad/dwgDocumentValidator · cad/dxfAdapter · calendar/legalObligations ·
calendar/predictions · capacity/normativeAlerts · capacity/tierEvaluation ·
cargo/stowageOptimizer · changeMgmt/operationalChangeFirestoreAdapter ·
changeMgmt/operationalChangeService · changeMgmt/operationalChangeWorkflow 🔵 ·
checklistBuilder/checklistBuilder · circadian/circadianRhythmService ·
clientReporting/monthlyClientReport · clientReporting/monthlyClientReportBuilder ·
climateAwareScheduling/climateAwareScheduling · coach/normativeRag ·
coach/personaSelector · coach/prompts 🔵 · comms/communicationMap ·
commsDrill/commsDrillEngine 🔵
