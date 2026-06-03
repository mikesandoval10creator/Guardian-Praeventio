# DEEP-EXT-23 — Auditoría exhaustiva de tests (Lote #23 — ÚLTIMO de tests)

**Alcance:** `ledger.json` → `category==="I-TEST"`, ordenado por `path`, slice `[1210:1247]` (37 archivos — la cola final del corpus de tests).
**Método:** lectura línea por línea de cada archivo, cazando falsos-verdes (rules-tests con Admin SDK / silent-pass, datos sintéticos del gate, asserts equivocados, over-mocking, "ID crypto contract" tautológico, reimplementación-disfrazada, "wire-up contract" solo-`.stack`, validate→next sin 400, asserts triviales/vacíos, skip/todo/fixme/`it()`-vacío, snapshot-only, tests que pasarían con impl incorrecta).
**Veredicto global:** Lote **mixto**. La mitad (utils puros, engines ZK, PDFs con captura de calls, offlineStorage IDB round-trip, eventBus, rut, haversine, deterministicRandom, randomId, sqliteEncryption) son tests **sólidos** con asserts de valor concreto. La otra mitad son **infra de tests** (fakeFirestore, setup, fixtures e2e) y **specs e2e/DR** donde se concentran TODOS los hallazgos. **0 hallazgos 🔴** (ninguna tautología cripto/ID, ningún rules-test con Admin SDK silenciado). **6 hallazgos 🟡** (overclaim de cobertura en e2e/DR + smoke-only PDF). Varias notas 🔵.

**Atestación: 37/37 archivos leídos línea por línea.**

- `*.firestore.test.ts` con Admin SDK saltándose reglas: **0** (no hay rules-tests en este lote; el setup de emulador `firestore-emulator-setup.ts` es infra legítima con cert dummy + REST clear-endpoint).
- `it.only`/`it.skip` individuales: **0**.
- `describe.fixme` (suites enteras deshabilitadas): **3** archivos (offline-resilience, process-lifecycle, sos-button) — declarados honestamente, pero deshabilitan cobertura safety-crítica.
- `test.skip` condicional (gate por env `E2E_FULL_STACK`/`E2E_SW_TESTS`/firebase-config): patrón normal de e2e, no es hallazgo.
- snapshot-only / `it()`-vacío / asserts vacíos: **0**.

---

## 🟡 Hallazgos medios (cobertura sobre-vendida / overclaim)

### 🟡-1 `tests/dr/dr-runbook-dryrun.spec.ts:201-214` — "Zero data loss" es tautológico
**Módulo:** DR runbook dry-run.
**Por qué:** El test `'simulates regional failure + failover + restore inside RTO budget'` afirma verificar "Zero data loss in critical collections" comparando `post === preCounts[col]`. Pero la "restauración" (Fase C/D) hace `clearAll()` + `seed()` **desde la misma fuente determinística** (`seed-dr-dataset.cjs`, mismo `makeRng(0xdr20260505)`, mismos doc IDs). Borrar y reescribir el dataset idéntico hace que los counts coincidan **siempre** — no prueba ningún backup/import real. El propio header (l.30-37) y el comentario de Fase C (l.181-189) lo admiten ("'Restore' here is re-seed from deterministic source, not import of a managed export"). El nombre del test y la aserción "Zero data loss" sobre-venden: lo único validado es que el seeder es determinístico y que un re-seed local cabe en <5 min. Pasaría aunque la lógica real de `gcloud firestore import` estuviera rota.
**Severidad:** No es falso-verde de unidad (la honestidad está en los comentarios), pero la promesa customer-facing ("RTO <5min, RPO=0") NO está cubierta por este test. Es un smoke de determinismo del seeder disfrazado de drill de DR.

### 🟡-2 `tests/e2e/sw-models-cache.spec.ts:38-92` y `:94-160` — testean la Cache API, no la regla Workbox del SW
**Módulo:** Service Worker `/models/*` runtime cache (promesa "SLM funciona offline en faena").
**Por qué:** Ambos tests insertan el blob manualmente vía `caches.open('slm-models').put()` desde el contexto de página (l.57-67, l.111-121) y luego verifican que `cache.match()`/`fetch()` lo devuelven. Eso prueba que **la Cache API del browser funciona**, no que la regla Workbox `urlPattern: /\/models\/.*\.(onnx|...)/` con `CacheFirst` esté wireada. El SW nunca cachea nada en estos tests — el blob ya estaba puesto a mano. El segundo test (`'SW intercept ... con CacheFirst (cache hit no toca red)'`) lo confiesa (l.140-143): "No podemos confirmar fromServiceWorker en page-level request". El header dice ser "regression guard si el SW pierde esa regla en algún refactor" (l.13-16) pero **ambos tests pasarían aunque la regla Workbox se borre por completo**. El assert `networkHits <= 1` (l.144) también es laxo.
**Severidad:** Overclaim directo del objetivo declarado. El gate real (que la regla `/models/*` exista) queda sin cobertura e2e.

### 🟡-3 `tests/e2e/sos-button.spec.ts:23` — suite SOS (safety-crítica) en `describe.fixme`
**Módulo:** SOSButton long-press → `emergency_alerts` + tel: fallback.
**Por qué:** Toda la suite está `test.describe.fixme(...)` → **no corre**. Es el flujo más safety-crítico del producto (botón de emergencia). El FIXME (l.12-22) es honesto y explica que el root-cause de auth/proyecto está arreglado y queda pendiente reconciliar las aserciones feature-level. Pero a efectos de cobertura real, SOS NO tiene e2e activo.

### 🟡-4 `tests/e2e/process-lifecycle.spec.ts:21` — suite lifecycle completa en `describe.fixme`
**Módulo:** StartProcess → Close → XP grant.
**Por qué:** `test.describe.fixme(...)` → no corre. El flujo canónico Proyecto→Cuadrilla→Proceso→XP queda sin e2e activo. FIXME honesto (l.16-20), misma situación que 🟡-3.

### 🟡-5 `tests/e2e/offline-resilience.spec.ts:21` — suite offline-sync (safety-crítica) en `describe.fixme`
**Módulo:** Hallazgo creado offline → IndexedDB queue → reconexión → sync Firestore.
**Por qué:** `test.describe.fixme(...)` → no corre. El propio header (l.11-14) la llama "el test más crítico para safety en faena". El FIXME (l.15-20) admite que falta reconciliar el form + las aserciones de sync con el render vivo (el label "Descripción" drifteó). La resiliencia offline — núcleo de la propuesta de valor — NO tiene e2e activo. (La capa unitaria SÍ está cubierta por `offlineStorage.test.ts`, ver 🔵.)

### 🟡-6 `src/utils/pricingOcPdf.test.ts:41-81` — "smoke-only" con nombres que prometen verificación de contenido
**Módulo:** generador PDF de cotización (pricing OC).
**Por qué:** Es un smoke test auto-declarado (l.4-8) pero varios `it()` prometen verificar contenido que **nunca inspeccionan**: `'honra folio + generatedAt custom'` (l.41) y `'incluye companyName + companyRut cuando se proveen'` (l.73) solo aseveran `bytes.byteLength > 2000`. Pasarían aunque el impl ignore por completo `folio`, `companyName` o `companyRut`. El único test que toca contenido (l.32-39) comprueba el data-URI MIME, no el folio. Compárese con sus pares del lote (`ds109/ds67/ds76/aptitudeCertificate.test.ts`) que capturan `textCalls` y aseveran los campos reales — patrón que este archivo **no** sigue pese a tratarse del mismo tipo de generador jsPDF. Debilidad de cobertura, no falso-verde (no afirma valores falsos), pero los nombres engañan.

---

## 🔵 Notas (patrones aceptables / sólidos, sin acción)

- **Engines ZK puros** (`resilientRetrieval`, `riskOrchestrator`, `smartActions`, `restrictedZonesEngine`) — excelentes: fall-through multi-source con timeout/null/empty/no-adapter, dedupe por id, override de orden, determinismo, citas normativas (DS 594/DS 54), training-gap por worker, mapeo zona→permit. Asserts de valor concreto y rejection-paths reales. ✅
- **`offlineStorage.test.ts`** — IDB round-trip real con `fake-indexeddb/auto` + `vi.resetModules()` por suite para resetear el singleton `idbPromise`. Cubre encriptación (round-trip transparente), filtro por projectId, upsert, limit/offset, cola offline, black-box locked-by-default + unlock, breadcrumbs (cap 50, orden desc, no-leak de userId, no-op en id inexistente). Cobertura amplia y honesta. ✅
- **PDFs DS** (`ds109`, `ds67`, `ds76`, `aptitudeCertificate`) — mockean jsPDF capturando `textCalls`/`saveCalls` y aseveran ensamblaje real de campos (RUT, CIE-10, % atribuible solo en `mixto`, labels de origen/severidad, filename determinístico, bloques opcionales presentes/ausentes). `hashRut` con estabilidad formato-independiente. Patrón de captura correcto. ✅
- **`susesoCertificate.test.ts`** — NO mockea jsPDF; genera binario real y verifica magic header `%PDF-`, determinismo de longitud, variantes DIAT/DIEP, firmado/sin firmar. ✅
- **`rut.test.ts`** — algoritmo SII módulo-11 con DVs conocidos (incl. rama K y body de 1 dígito), rechazos (DV malo, body >9, no-dígitos, sin DV), round-trips. Funciones puras. ✅
- **`haversine.test.ts`** — distancia canónica Santiago→NY con tolerancia, simetría, cruce de ecuador, corrección coseno en latitudes altas. ✅
- **`deterministicRandom.test.ts`** + **`randomId.test.ts`** — Mulberry32 determinista (misma seed→misma secuencia, no-mutación en shuffle, int inclusivo, throws en min>max/pick vacío); randomId ejercita ambas ramas (crypto.randomUUID vs fallback) vía `vi.stubGlobal`, incluyendo `randomUUID` no-función y crypto undefined. Mata el cluster de mutantes documentado. ✅
- **`sqliteEncryption.test.ts`** — verifica passphrase hex de 64 chars en primer run, no re-set en runs posteriores, passphrases distintas por device, y un contract-test que lee el `.ts` fuente para banear `import @capacitor/preferences` (l.74-88). Contract-via-source legítimo (regresión Codex P1). ✅
- **`eventBus.test.ts`** — pub/sub tipado + wildcard, replay del último evento a subscriber tardío (microtask), aislamiento de errores entre subscribers, unsubscribe, conteos/last-by-type, orden síncrono. ✅
- **`roles.test.ts`** — source-of-truth RBAC: helpers `isAdminRole`/`isSupervisorRole`/etc., invariantes estructurales (DOCTOR_ROLES ⊆ SUPERVISOR_ROLES, sin duplicados), rechazo de typos históricos (`medico`/`trabajador`). ✅
- **`pwa-offline.test.ts`** — pese al nombre "typing contract", aprueba: prueba coerción real de `localUpdatedAt` (epoch ms → ISO string) en columna y JSON payload, incluso legacy con número embebido, y `""` cuando no hay timestamp. Mocks SQLite/idb razonables. ✅
- **`forceGraphWorker.test.ts`** — helpers puros del worker: parse rechaza shapes inválidas (nodos no-array, id numérico, source numérico), simulación produce posiciones finitas para cada nodo, dim:3 emite z. Nota menor 🔵: el test `'produces independent results across runs (clean termination contract)'` (l.64) NO compara first vs second para independencia — solo aseveran ambos finitos+len 2. El nombre promete más de lo que verifica, pero el header lo admite ("the only guarantee we can give without locking a d3 version"). Aceptable.
- **`smoke.test.ts`** — trivial (arrays de roles no vacíos + `process.env` es objeto). Es un smoke deliberado de boot; sin valor de regresión pero no engaña. 🔵
- **Infra de tests** (`fakeFirestore.ts`, `firestore-emulator-setup.ts`, `setup.ts`, fixtures e2e `auth.ts`/`seed.ts`/`server.ts`) — no son tests sino helpers. `fakeFirestore` implementa where/orderBy/limit/runTransaction in-memory (declara "no aislamiento real"); `firestore-emulator-setup` usa cert dummy + REST clear-endpoint contra emulador (correcto, no toca prod); `auth.ts` mintea custom token vía Auth Emulator con `email_verified:true` y gatea prod en boot; `server.ts` boota Express con `E2E_MODE=1`/`NODE_ENV=test` y espera `/health`. Infra legítima. ✅
- **e2e activos sólidos** — `accessibility.spec.ts` (axe-core real, assert duro cero serious/critical con allowlist documentada de color-contrast, landmark+h1), `landing.spec.ts` (9 badges, tiers, CTAs, footer), `landing-i18n.spec.ts` (pin en-US + assert de cero leakage español). Estos SÍ corren (gate firebase-config/E2E_FULL_STACK) y aseveran contenido real. ✅
- **`fall-detection-toggle.spec.ts`** — único spec auth-gated NO en fixme: toggle real → `aria-checked` flip → persistencia tras reload vía idb-keyval, con `expect.poll`. ✅

---

## Resumen (6-10 líneas)
Lote #23 (37 archivos, slice `[1210:1247]`, cola final del corpus de tests: `utils/*`, engines ZK, workers, infra de test y `tests/e2e/*` + `tests/dr/*`) **cierra la auditoría sin un solo 🔴**: no hay tautologías cripto/ID, ni rules-tests con Admin SDK silenciados, ni asserts vacíos/snapshot-only/`it.only`. La capa unitaria es **sólida y consistente** (RUT módulo-11, haversine, RNG determinista, randomId dos-ramas, PDFs DS con captura de `textCalls`, offlineStorage IDB round-trip, sqliteEncryption con contract-via-source). Todos los **6 hallazgos 🟡 se concentran en e2e/DR**: (1) el dry-run de DR afirma "Zero data loss" pero borra+re-siembra el mismo dataset determinístico — tautológico, no prueba backup/import real; (2) los SW-cache tests prueban la Cache API del browser, no la regla Workbox `/models/*`, y pasarían aunque la regla se borre; (3-5) tres suites e2e safety-críticas (SOS, process-lifecycle, offline-sync) están enteras en `describe.fixme` y no corren — honestamente flagueadas pero sin cobertura activa; (6) `pricingOcPdf` es smoke-only con nombres que prometen verificar `folio`/`companyName` pero solo miden `byteLength`. Acción recomendada: reconciliar y des-fixmear las 3 suites e2e críticas (la auth/proyecto ya está arreglada según los FIXME), renombrar o reescribir el DR dry-run para no sobre-vender "Zero data loss", y alinear `pricingOcPdf` con el patrón de captura de `textCalls` de sus pares DS.
