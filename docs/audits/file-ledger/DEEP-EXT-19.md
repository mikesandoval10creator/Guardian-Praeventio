# DEEP-EXT-19 — Auditoría exhaustiva de tests (Lote #19)

**Ámbito:** `category==="I-TEST"`, ordenado por `path`, slice `[990:1045]` (55 archivos).
**Método:** lectura línea por línea de cada archivo. Caza de falsos-verdes:
rules-tests con Admin SDK / silent-pass, datos sintéticos del gate, asserts
equivocados, over-mocking, "ID crypto contract" tautológico, reimplementación
disfrazada, "wire-up contract" (solo `.stack`), `validate→next` sin 400,
asserts triviales/vacíos, skip/todo/fixme/`it()` vacío, snapshot-only, tests que
pasarían con impl incorrecta.
**Fecha:** 2026-06-03. **Doc-only, sin commit.**

---

## Veredicto global

Lote de **calidad muy alta**, dominado por motores puros (`pricing/*`,
`protocols/*`, `physics/*`, `pdca/*`, `organic/*`, `portfolioLessons`,
`projectComparator`, `nonConformity`, `privacy*`) con aritmética exacta y
baterías de boundary. Los calc engines de protocolo (`iper` 5×5 exhaustivo,
`prexor` con dosis/Leq y tasas de intercambio DS 594, `tmert` con clasificación
norm-strict y nota de removal honesto del flag amplificador) están
mutation-hardened. El bloque observability es ejemplar: `sentryAdapter` y
`sentryInstrumentation` mockean `@sentry/*` para asertar cada call-site y
matan mutantes Stryker nombrados (REDACT_KEYS paramétrico con guard
anti-set-vacío, heurística `isSentrySetupError` por rama). `pinSign` prueba
PBKDF2 real, lockout, HMAC tamper. Adaptadores Firestore usan fakes en memoria
(`createFakeFirestore` / stubs ad-hoc) — son unit tests, **no** rules-tests; no
aplica la prohibición de Admin SDK. `orchestratorService` y `quotaTracker` son
anti-stub fuertes (no fabrican telemetría; idempotencia/aislamiento multi-tenant).

No se detectó: Admin SDK en rules-test, silent-pass, `validate→next` sin 400,
skip/todo/fixme/`it()` vacío, snapshot-only, ni reimplementación disfrazada.

Hallazgos: **0 🔴 · 1 🟡 · 8 🔵.** Ninguno invalida un test ni es falso-verde
real; todos son debilidades de aserción/cobertura o nombres engañosos.

---

## 🟡 Medios

### 🟡-1 `observability.test.ts` — la rama "credencial presente" no se asserta nunca (conditional-skip)
`src/services/observability/observability.test.ts:41-49, 84-90, 220-231, 233-247, 334-351`
Varios tests envuelven el assert real en `if (sentryAdapter.isAvailable) {...} else {...}`
o `if (!process.env.SENTRY_DSN)`. En CI sin DSN solo se ejercita la rama "no
disponible → noop"; la rama positiva (`ERROR_TRACKER=sentry` AND DSN → name
`'sentry'`) **nunca se verifica** porque el entorno de test no tiene DSN, y el
test pasa por la rama `else` igual. Peor: `233-247` y `343-351` colocan el assert
de fall-back *dentro* de `if (!isAvailable)`, de modo que en un entorno **con**
credencial el `it()` corre sin ejecutar ningún `expect` (test que aserta nada).
Es deliberado para mantener determinismo, pero el resultado es que el camino de
selección positiva de adapter queda sin cobertura en cualquier entorno. La
cobertura real de Sentry vive en `sentryAdapter.test.ts` (que sí mockea el SDK),
así que el riesgo neto es bajo, pero estos `it()` dan una falsa sensación de
cubrir la selección de adapter. Módulo: observability/facade.

---

## 🔵 Menores

### 🔵-1 `postTrainingAssessmentEngine.test.ts` — el nombre "cap a 90 días" no prueba el cap de 90
`src/services/postTraining/postTrainingAssessmentEngine.test.ts:173-176`
El `it('cap a 90 días')` asserta `nextReviewDelayDays('easy',10)===56` y
`('medium',10)===32` — ambos por debajo del cap de 90. El límite real de 90 días
**nunca se ejercita**; una regresión que rompiera el clamp a 90 (p.ej. devolviendo
120) pasaría verde porque ningún caso alcanza ese tramo. Nombre engañoso +
boundary no pineado. Módulo: postTraining.

### 🔵-2 `dpiaTemplate.test.ts` — smoke-only: la lógica de branch no se verifica
`src/services/privacy/dpiaTemplate.test.ts:83-94` (y 73-81)
"renders each residual risk level (smoke)" solo asserta `byteLength>500`. El PDF
con 3 niveles residuales distintos pasaría idéntico que uno que ignorara el nivel
por completo: el único contenido verificado en toda la suite es el `tenantId`
(65-71). Una impl que no renderizara `high`/`medium`/`low` no sería detectada.
Aceptable como humo de no-throw, pero sin poder de mutación sobre la lógica de
render. Módulo: privacy/DPIA.

### 🔵-3 `resilienceHealthMonitor.test.ts` — nombre del test contradice el assert
`src/services/observability/resilienceHealthMonitor.test.ts:127-136`
El `it('todos healthy → healthy')` bajo `overallPolicy:'strict'` en realidad
asserta `overallStatus==='degraded'` (porque los checkers ausentes cuentan como
`unknown`). El assert es correcto para el comportamiento, pero el nombre miente —
un lector confiaría en que prueba el camino "all healthy → healthy", que sí está
cubierto aparte (213-224). Cosmético. Módulo: observability/resilience.

### 🔵-4 `proximityModeDetector.test.ts` — OR-assertions no pinean el boundary de modo
`src/services/proximitySensor/proximityModeDetector.test.ts:51-65, 67-75`
Dos casos asertan `['in_pocket','in_helmet_mount']).toContain(mode)` y aceptan
dos modos distintos para el patrón "paseo". El clasificador podría confundir
pocket↔helmet y seguir verde. Documentado como dependiente de boundary, pero no
fija la frontera entre los dos modos. Módulo: proximity.

### 🔵-5 `dataRetentionPolicy.test.ts` — `sensor_telemetry` acepta dos acciones opuestas
`src/services/privacyRetention/dataRetentionPolicy.test.ts:76-82`
`expect(['archive_immutable','purge']).toContain(d.action)` admite archivar o
purgar para el mismo record — son decisiones opuestas (preservar vs destruir). El
test no fija cuál es la correcta para 90d-retention con record antiguo; una
regresión que invirtiera el umbral archive/purge pasaría. Módulo: privacyRetention.

### 🔵-6 `iper.test.ts` / `prexor.test.ts` — recomendaciones "no-crítico" solo asertan longitud
`src/services/protocols/iper.test.ts:122-125`; `src/services/protocols/prexor.test.ts:135-139`
"trivial recommends monitoring" y "bajo recommends maintaining" solo verifican
`recommendation.length>0`, no que el texto mencione monitoreo/mantención. Una
recomendación equivocada (pero no vacía) para nivel bajo pasaría. Los niveles
críticos sí pinean keywords (`/detener|programa/`), así que el hueco es solo en
el extremo bajo. Módulo: protocols.

### 🔵-7 `networkBackend.test.ts` — código muerto en el fake admin (no afecta verdad del test)
`src/services/networkBackend.test.ts:67-92`
Define un primer `collection`/`queryChain` que nunca se usa (se reemplaza por
`collectionWithChain`); además usa `Math.random()` para auto-ids del fake (línea
69/84). Es archivo de test (excepción a la regla #15) y no invalida nada, pero el
fake duplicado es ruido confuso. El SUT real (filtrado de sugerencias: drop
already-connected, drop hallucinated, drop self) sí se prueba con
`./geminiBackend` stubbeado — boundary correcto, no over-mock. Módulo: network.

### 🔵-8 `bernoulliEngine.test.ts` — `venturiFlowRate` con assert débil "positivo finito"
`src/services/physics/bernoulliEngine.test.ts:20-24`
El caso de éxito de `venturiFlowRate` solo asserta `Number.isFinite(q) && q>0`,
sin valor esperado; una impl que devolviera un Q numéricamente erróneo (pero
positivo) pasaría. Mitigado: los casos ACH derivados (54-71) usan el mismo Q en
comparaciones de umbral y razón lineal, y `dynamicPressure`/`windLoad`/etc. tienen
valores exactos. Módulo: physics.

---

## Notas de cobertura (sin hallazgo, positivas)

- `protocols/iper` cubre la matriz 5×5 completa (25 casos) + colores + residual
  por efectividad de control con clamp + inputs inválidos (no-entero, fuera de
  rango). Referencia de exhaustividad.
- `protocols/prexor` valida dosis acumulada multi-medición, Leq con Q=3 dB (DS
  594) documentando divergencia con la spec Q=10, y boundaries inclusivos
  (50%, 100%, 1000%).
- `sentryInstrumentation.test.ts` es ejemplar en mutation-killing: REDACT_KEYS
  paramétrico con guard anti-`new Set([])`, cada rama de `isSentrySetupError`
  ejercida vía su único call-site, contrato shallow-vs-recursive pineado.
- `pinSign/pinSignService` prueba PBKDF2 real, lockout tras N fallos, expiración
  de ventana, HMAC tamper/secreto-distinto/secreto-débil — crypto real, sin mock.
- `quotaTracker` y `orchestratorService` son anti-stub fuertes: idempotencia por
  key, aislamiento multi-tenant, y rechazo de telemetría fabricada cuando falta
  API key (pinea valores legacy prohibidos: 24/45/55/1200/8, "Soleado", etc.).
- `pricing/tiers`, `pricing/aiTier`, `pricingCalculator`, `pricingSimulator` usan
  aritmética exacta de overage/IVA/ROI y guards de input no-finito.
- Adaptadores Firestore (`faenaOnboardingFirestoreAdapter`,
  `photoEvidenceFirestoreAdapter`, `positiveObservationsFirestoreAdapter`) usan
  fakes en memoria con merge/dedup/array-contains — unit tests, no rules-tests.
- `privacy/registry` cubre ruteo de jurisdicción APAC con anti-colisión
  TW↔CN explícita y matriz de derechos por régimen — alta señal.

---

## Archivos auditados (55)

multiRoleSummary/roleSummaryComposer · networkBackend 🔵 ·
nonConformity/nonConformityEngine · normativa/countryPacks ·
normativa/locationNormativa · notifications/fcmAdapter ·
observability/observability 🟡 · observability/piiRedactor ·
observability/quotaTracker · observability/resilienceHealthMonitor 🔵 ·
observability/sentryAdapter · observability/sentryInstrumentation ·
observability/slos · onboarding/faenaOnboardingBundle ·
onboarding/faenaOnboardingFirestoreAdapter · openapi/specGenerator ·
operationalState/faenaStateEngine · orchestratorService ·
orgMetrics/organizationalMetrics · organic/crewService · organic/processService ·
organic/taskService · pdca/pdcaCycle · pdca/pdcaCycleEngine ·
photoEvidence/photoEvidenceEngine · photoEvidence/photoEvidenceFirestoreAdapter ·
physics/bernoulliEngine 🔵 · pinSign/pinSignService ·
portfolioLessons/portfolioLessonsEngine ·
positiveObservations/positiveObservationsFirestoreAdapter ·
positiveObservations/positiveObservationsService ·
postTraining/postTrainingAssessmentEngine 🔵 · predictiveAlerts/alertScheduler ·
predictiveAlerts/calendarPreWarn · predictiveAlerts/windowedTrigger ·
pricing/aiTier · pricing/eppIndustryCatalog · pricing/iapSkus ·
pricing/jurisdictionLimits · pricing/subscriptionPlan · pricing/tiers ·
pricingCalculator/pricingCalculator · pricingSimulator/pricingSimulator ·
privacy/dpiaTemplate 🔵 · privacy/registry ·
privacyRetention/dataRetentionPolicy 🔵 · privacyShield/piiClassifier ·
projectClosure/projectClosureService · projectComparator/projectComparator ·
protocols/iper 🔵 · protocols/prexor 🔵 · protocols/tmert ·
proximitySensor/proximityModeDetector 🔵 · pymeOnboarding/pymeWizard ·
pymeWizard/pymeOnboardingWizard
