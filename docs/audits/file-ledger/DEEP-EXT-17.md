# DEEP-EXT-17 — Auditoría exhaustiva de tests (Lote #17)

**Alcance:** `ledger.json` filtrado por `category==="I-TEST"`, ordenado por `path`, slice `[880:935]` (55 archivos).
**Rango:** `src/services/exceptions/exceptionFirestoreAdapter.test.ts` → `src/services/heatmap/findingsHeatmapBuilder.test.ts`.
**Método:** lectura línea por línea de cada test + verificación del fake/mock subyacente (`src/test/fakeFirestore.ts`).
**Convenciones:** 🔴 falso-verde grave / 🟡 débil o engañoso / 🔵 ruido (assert trivial, redundante, tautológico).

---

## Resumen ejecutivo (6-10 líneas)

El lote es, en su gran mayoría, de **alta calidad**: funciones puras (REBA térmico, ROI, hazmat, glossary, focusBlocks, geofence, heatmap), adaptadores que corren contra un `fakeFirestore` fiel en memoria (NO Admin SDK, NO silent-pass), y adaptadores externos (NASA/USGS/EONET) con `fetch` inyectado vía DI. Los tests de salud (`healthConnectAdapter`, `occupationalContext`, `vaultShare`, `nativeHealthAdapter`) son ejemplares: aserciones ADR 0012 reales, invariantes on-device verificadas estructuralmente, cifrado verificado por magic-bytes. **El único patrón sistemático de falso-verde** está en los **tests de split del módulo Gemini** (`gemini/*.test.ts`): además del bloque legítimo "sin API_KEY → throws", incluyen bloques "contract" que solo afirman `fn.constructor.name === 'AsyncFunction'`, `fn.length >= N` (aridad) o `['PTS','PE','AST'].toContain('PTS')` — aserciones **tautológicas** que pasan con cualquier implementación (incluso una que devuelva basura). No prueban comportamiento. El `geminiBackend.test.ts` central, en cambio, sí mockea el SDK en el límite y cubre parse/fallback/slice de verdad. Hallazgos menores adicionales: un `describe` mal etiquetado en `createProjectScopedStore.firestore.test.ts`.

**Conteo:** 🔴 0 · 🟡 3 · 🔵 9

---

## Hallazgos

### 🟡 Tests "contract" tautológicos en el split de Gemini (patrón sistemático)

Estos bloques `describe('… — contract')` / `'contract checks'` no ejercen ninguna lógica del SUT; afirman propiedades estructurales del lenguaje (tipo de función, aridad) o literales hard-coded. Pasarían aunque la función estuviera vacía o devolviera datos incorrectos. Solo el bloque "sin API_KEY" de cada archivo aporta señal real.

- 🟡 `src/services/gemini/safetyDocs.test.ts:31-36` — `it('reportType es type-safe (PTS/PE/AST)')` afirma `['PTS','PE','AST'].toContain('PTS')` sobre un **array literal del propio test**. Cero acoplamiento al código fuente; es un test que se prueba a sí mismo. El comentario lo admite ("Compilation gate — TypeScript narrowing already enforces it"). Es el caso más claro de la categoría.
- 🟡 `src/services/gemini/chat.test.ts:29-41` — `'3 funciones son async'` (`fn.constructor.name`) y `'getChatResponse acepta default detailLevel + history'` (solo `fn.length >= 2`, aridad). Ninguno verifica comportamiento; el segundo ni siquiera invoca la función.
- 🟡 `src/services/gemini/personPlans.test.ts:49-64` — `'generateActionPlan acepta defaults'` solo afirma `fn.length >= 1` + `'5 funciones son async'`. Tautológico.

Réplicas del mismo anti-patrón (mismo razonamiento, agrupadas) — clasificadas 🔵 por ser ruido repetido del mismo molde:
- 🔵 `src/services/gemini/emergency.test.ts:30-39` — `'3 funciones son async'`.
- 🔵 `src/services/gemini/operations.test.ts:63-77` — `'7 funciones son async'`.
- 🔵 `src/services/gemini/risk.test.ts:40-51` — `'4 funciones son async'` (+ `typeof === 'function'`).
- 🔵 `src/services/gemini/suggestions.test.ts:20-24` — `'ambas funciones son async'`.
- 🔵 `src/services/gemini/vision.test.ts:32-46` — tres `it` `'… es función async'` (`typeof` + `constructor.name`).

> Nota: los bloques "sin API_KEY → throws" de TODOS estos archivos sí son válidos (ejercitan el guard de configuración real). El problema es exclusivamente el `describe('contract')` añadido como relleno de cobertura.

### 🔵 Etiqueta de `describe`/`it` engañosa (no es falso-verde, pero confunde)

- 🔵 `src/services/firestore/createProjectScopedStore.firestore.test.ts:102-118` — `it('subscribe: emite snapshot cuando un write externo cambia la col')` en realidad NO prueba `subscribe`; siembra vía admin y luego hace `store.list()` (round-trip por lectura puntual, no live snapshot). La aserción es real y correcta, pero el nombre promete un test de subscripción que no ocurre. El test de subscribe live real está en el segundo `describe` (líneas 185-211), que sí lo cubre.

### 🔵 Aserción redundante / de baja entropía (válidas pero ruido)

- 🔵 `src/services/external/recommendationBuilder.test.ts:63-64` — tras `expect(rec.severity).toBe('caution')` añade `expect(['info','caution','high']).toContain(rec.severity)`, redundante con la línea anterior. El primer assert ya es estricto; el segundo no aporta.
- 🔵 `src/services/gemini/chat.test.ts:31-33` (contado arriba en el bloque, se anota la naturaleza `constructor.name` como de baja entropía general del lote).

---

## Archivos revisados SIN hallazgos (sólidos)

Funciones puras / lógica determinística con asserts estrictos y casos límite reales:

- `exceptions/exceptionFirestoreAdapter.test.ts` — adapter contra `fakeFirestore` fiel (filtros, expireOverdue, status).
- `expirations/expirationScanner.test.ts` — buckets por severity, ventanas custom, `RangeError` en config inválida.
- `explainability/recommendationExplainer.test.ts` — confidence HIGH/MEDIUM/LOW, dedupe citations, particiones.
- `exposure/exposureFirestoreAdapter.test.ts`, `exposure/exposureRegistry.test.ts`, `exposure/thermalStressCalculator.test.ts` — orden desc, límites regulatorios, WBGT/wind-chill/aclimatización.
- `external/eonet/eonetAdapter.test.ts`, `external/nasaPower/nasaPowerAdapter.test.ts`, `external/usgs/usgsEarthquakeAdapter.test.ts` — `fetch` inyectado, retry/backoff, cache TTL, Zod schema fail, validación de coords.
- `fatigue/fatigueMonitor.test.ts` — umbrales DS 594 (12h), turnos nocturnos, descanso <11h.
- `financialAnalytics/{eppBudgetTracker,purchaseOrderSuggester,roiCalculator}.test.ts` — Heinrich 1:4, verdicts, urgencias, payback Infinity.
- `firestore/createProjectScopedStore.test.ts` (mocks del SDK + asserts de path/merge/clamp/defensivo), `createProjectScopedStore.firestore.test.ts` (emulator real), `resilientReader.test.ts` (retry, backoff exponencial, fallback, unretriable codes).
- `firstResponderMap/firstResponderMap.test.ts` — scoring por cercanía, SIF cert, capacidad, gaps de cobertura.
- `fiveS/fiveSAudit.test.ts`, `focusBlocks/focusBlocks.test.ts`, `foregroundService/guardianForegroundService.test.ts` — máquina de estados con plugin DI, heartbeat staleness.
- `formBuilderAdvanced/advancedFieldEngine.test.ts` — tokenizer, sandboxing (rechaza `fetch`/`eval`/bare ident), topo-sort, ciclos.
- `gamification/{daysWithoutIncident,positiveXp}.test.ts` — fake DB con where+orderBy+limit, idempotencia de medallas.
- `gemini/asesorDomain.test.ts` (dominios distintos + ruta→dominio), `gemini/governance.test.ts` (pricing, circuit, quota), `gemini/parsing.test.ts` (parseGeminiJson + backoff 429/503), `gemini/pii.test.ts` (redacción + breadcrumb best-effort).
- `geminiBackend.test.ts` — SDK mockeado en el límite; happy/empty/malformed JSON, fallbacks tipados, slicing de prompt, guard sin key.
- `geofence/permissionUXDecision.test.ts` (matriz iOS/Android, pureza, no-mutación), `geofence/polygonUtils.test.ts` (haversine, point-in-polygon, área).
- `glossary/glossaryEngine.test.ts`, `governance/deviationNormalizationRadar.test.ts` — scoring, feedback idempotente, patrones §285/§286 con severidad ordenada.
- `hazmat/{hazmatExposureCalculator,hazmatExtensions,hazmatInventory,hazmatSegregation}.test.ts` — GRE 2024, fail-closed, matriz IMDG simétrica, NFPA.
- `health/{healthConnectAdapter,healthFacade,healthFacadeNative,nativeHealthAdapter,occupationalContext,shiftWindow,vaultRecord,vaultShare}.test.ts` — ADR 0012 (sin campos diagnósticos), invariante on-device (no insertRecords), ShiftWindow ADR 0010, cifrado verificado por magic-bytes PVB1 + ausencia de cleartext, HMAC constant-time, secreto nunca persistido.
- `heatmap/findingsHeatmapBuilder.test.ts` — grid clustering, severity dominante con desempate, determinismo.

---

## Recomendaciones

1. **Eliminar o reemplazar los bloques `describe('… — contract')` del split de Gemini** (`chat`, `emergency`, `operations`, `personPlans`, `risk`, `safetyDocs`, `suggestions`, `vision`). Las aserciones `constructor.name === 'AsyncFunction'`, `fn.length`, y arrays literales no detectan ninguna regresión. Si se quiere cobertura de comportamiento, replicar el patrón de `geminiBackend.test.ts` (mockear `@google/genai` en el límite y afirmar parse/fallback). De lo contrario, basta el bloque "sin API_KEY".
2. **Renombrar** el `it` de `createProjectScopedStore.firestore.test.ts:102` para reflejar que prueba `list` round-trip, no `subscribe`.
3. Menor: quitar el assert redundante de `recommendationBuilder.test.ts:64`.

**Veredicto del lote:** sano. Ningún 🔴 (sin rules-tests con Admin SDK, sin silent-pass, sin reimplementación-disfrazada, sin validate→next sin 400). La deuda es cosmética/de relleno, concentrada en el molde repetido del split Gemini.
