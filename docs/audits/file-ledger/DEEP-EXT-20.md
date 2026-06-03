# DEEP-EXT-20 — Auditoría exhaustiva de tests (Lote #20)

**Alcance:** `ledger.json` → `category==="I-TEST"`, ordenado por `path`, slice `[1045:1100]` (55 archivos).
**Método:** lectura línea por línea de cada test, cazando falsos-verdes (rules-tests con Admin SDK / silent-pass, datos sintéticos del gate, asserts equivocados, over-mocking, "ID crypto contract" tautológico, reimplementación-disfrazada, "wire-up contract", validate→next sin 400, asserts triviales/vacíos, skip/todo/fixme, snapshot-only, tests que pasarían con impl incorrecta).
**Veredicto global:** Lote de **alta calidad**. La inmensa mayoría son tests de funciones puras / engines / adapters con asserts de valor concreto y rejection-paths reales. **1 hallazgo 🔴 real** (tautología auto-mock), **6 hallazgos 🟡** (debilidades menores), y varias notas 🔵 de patrones aceptables.

Archivos revisados: 55/55. Sin `.skip`/`.todo`/`it.only`/`it()`-vacío. Sin snapshot-only. Sin rules-tests con Admin SDK silenciados (el único `*.firestore.test.ts` es un round-trip legítimo contra emulador).

---

## 🔴 Hallazgos críticos (falso-verde real)

### 🔴-1 `ragService.test.ts:170-186` — guard "GEMINI_API_KEY absent" es tautología auto-mock
**Módulo:** `services/ragService` (RAG / embeddings).
**Por qué:** El test `'guard: throws GEMINI_API_KEY error when key is absent (source-validated)'` NO ejercita el guard real (`ragService.ts:62`). En su lugar hace:
```ts
const generateSpy = vi.spyOn(ragService, 'generateEmbedding').mockRejectedValueOnce(
  new Error('GEMINI_API_KEY is not configured'),
);
await expect(ragService.generateEmbedding('test')).rejects.toThrow('GEMINI_API_KEY is not configured');
```
Es decir, **mockea la función bajo prueba para que lance, y luego verifica que la función mockeada lanza**. Pasaría aunque el guard fuera borrado del código fuente. Clásico "ID crypto contract" tautológico. El propio comentario (l.176-178) admite "We assert the error message is correct by mocking the throw". El guard de key-ausente queda SIN cobertura efectiva (la limitación real es que `API_KEY` se captura a module-load via `vi.hoisted`, l.36 — pero la solución elegida es un assert vacío de valor).
**Severidad:** Funcionalmente cubre 0 del comportamiento. El nombre "(source-validated)" es engañoso.

---

## 🟡 Hallazgos medios (debilidad / cobertura sobre-vendida)

### 🟡-1 `scheduler/distributedLease.test.ts:170-180` — "race" no es race
**Módulo:** `services/scheduler`. El test `'only one of two simultaneous acquires wins'` se vende como prueba de carrera (read-then-write conflict), pero el fake DB serializa transacciones por defecto (`serialize=true`, l.36/92). El propio comentario (l.171-172) lo admite. La rama `setSerialize(false)` que existe para "romper el lock" y exponer interleaving real (l.103-106, comentada en el header l.13-16) **nunca se usa**. El verdadero camino de conflicto concurrente (dos `get()` viendo el doc libre antes de cualquier `set()`) queda sin cubrir. Pasa con un impl que solo funcione bajo serialización estricta.

### 🟡-2 `scheduler/distributedLease.test.ts:125` — `Math.random()` en nonce dep
Permitido en tests (directiva 15 exenta archivos de test), pero el nonce no es determinístico, lo que hace el "race test" aún menos reproducible. Nota menor.

### 🟡-3 `sii/dteGenerator.test.ts:40-42` — hash verificado contra sí mismo
**Módulo:** `services/sii`. `expectedHash = sha256(result.xml)` y luego `expect(result.hash).toBe(expectedHash)`. Solo prueba que el impl hashea su propio output (tautológico para el campo `hash`). Mitigado porque el mismo test ancla el contenido XML concreto (`<IVA>3800</IVA>`, etc.), así que un impl que produzca XML incorrecto fallaría en esas líneas. Riesgo bajo, pero el assert de `hash` per se no aporta.

### 🟡-4 `routing/routeClimateAssessment.test.ts:9-21` — mock stubea método no usado
El `vi.mock` del nasaPowerAdapter expone `fetchClimate`/`fetchAggregated`/`clearCache`, pero el SUT solo usa `fetchAggregated`. `fetchClimate` queda como stub muerto; el `beforeEach` (l.68) resetea `fetchAggregated`+`fetchEvents` pero no `fetchClimate`. Inofensivo (over-mock cosmético), no genera falso-verde porque las assertions son sobre `result.status`/`failedSources` reales.

### 🟡-5 `roleViews/roleViewBuilder.test.ts` — cobertura de severidad parcial
**Módulo:** `services/roleViews`. Tests sólidos pero el bloque `worker` no verifica `severity`/orden de cards, solo presencia/`count`. Un impl que devuelva cards de worker con severidad equivocada pasaría. Debilidad de cobertura, no falso-verde.

### 🟡-6 `researchMode/researchMode.test.ts` — sin rejection-paths
**Módulo:** `services/researchMode`. Engine puro con 4 happy-path tests y cero casos límite (árbol vacío, nodos huérfanos, `parentId` inexistente, ciclos). Comparado con sus pares (`investigationMode`, `rootCauseClassifier`) que sí validan errores, este queda corto. Aceptable para engine puro pero sub-cubre.

---

## 🔵 Notas (patrones aceptables, sin acción)

- **`rootCause/rootCauseStore.firestore.test.ts`** — único `*.firestore.test.ts` del lote. Round-trip REAL contra emulador: siembra con Admin SDK y verifica con Admin SDK + `subscribe` real, usa `vi.waitFor` (no `setTimeout` fijo, l.96). **No** es un rules-test disfrazado con Admin SDK para saltarse reglas; es un adapter store-test legítimo. ✅
- **`security/{browserEnvelope,deviceKek,encryptedKvStore,kekRotationOrchestrator,kmsEnvelope,cloudKmsAdapter}.test.ts`** — crypto de primer nivel: WebCrypto/Node-crypto reales, round-trips, tamper-detection (flip de bit), wrong-KEK rejection, threat-model (KEK borrada → DECRYPT_FAIL). `cloudKmsAdapter` mockea el SDK GCP pero declara explícitamente que prueba WIRING, no cripto (comentario honesto l.1-27). ✅
- **`kmsEnvelope.test.ts:110-116`** — el "wrong KEK" usa `name:'in-memory-dev'` deliberadamente igual para NO disparar el guard de adapter-mismatch y forzar el fallo en la capa cripto; documentado (l.110-113). Bien pensado. ✅
- **`safety/{ergonomicAssessments,iperAssessments}.test.ts` (+legalTrigger, +xpHook)** — adapter Firestore mockeado pero con asserts exhaustivos de shape, audit-action keys, ordering setDoc→audit, no-audit-on-setDoc-reject, side-effect isolation (folio falla → save sobrevive). Cobertura de validación muy completa. ✅
- **`shiftHandover/*` + `sif/sifFirestoreAdapter`** — usan `createFakeFirestore` (fake in-memory) consultado a través del adapter real; patrón válido de adapter-test, no over-mock. ✅
- **`routingBackend.test.ts`** — Haversine re-implementado en el test como oráculo independiente (l.12-23) para no depender del impl; characterization tests honestos que documentan bordes (NaN propaga, endpoints no re-chequeados). ✅
- **`raciMatrix.test.ts` / `cloudKmsAdapter.test.ts`** — leve desajuste nombre-ledger vs import (`raciMatrixEngine.js`, `kmsAdapter.ts`) pero los archivos existen y resuelven; no es hallazgo.
- **Pure engines** (qrAck, qrSignature, residualRisk, retaliation, returnToWork, repeatingRiskRadar, riskRanking, roiScenario, roleOnboarding, criticalRouteScoring, driverRouteMatcher, gridAStar, sensorBus, signageValidator, sifPrecursorClassifier, osha, safetyPerformanceIndex, talkTopicSuggester, preShiftRiskComposer, reportsAutomation, reputationalAlerts, jurisdictions*, registry, privacyRegimeRegistry, mountainRefuges, readReceipts, noBlameInvestigation, investigationMode) — determinismo verificado, clamps, rejection-paths, ventanas temporales, asserts de valor concreto. Calidad consistente. ✅

---

## Resumen (6-10 líneas)
Lote #20 (55 archivos, slice [1045:1100], dominio `services/q*`→`services/sii`) es de **calidad alta y consistente**: engines puros con asserts de valor real, adapters con fakes in-memory consultados vía la API real, y una suite cripto (security/*) ejemplar con round-trips WebCrypto, tamper-detection y threat-model. Se encontró **1 falso-verde real** (🔴-1, `ragService.test.ts:170-186`): el "guard GEMINI_API_KEY" mockea la propia función bajo prueba para que lance y luego verifica que lanza — tautología pura que pasaría aunque se borre el guard del código. **6 debilidades 🟡** menores: el "race test" de `distributedLease` corre serializado (no expone el interleaving real), el `hash` de `dteGenerator` se verifica contra sí mismo (mitigado por asserts de XML), over-mock cosmético en `routeClimateAssessment`, cobertura parcial de severidad en `roleViewBuilder`, y `researchMode` sin rejection-paths. El único `*.firestore.test.ts` es un round-trip legítimo contra emulador (no rules-test con Admin SDK silenciado). No hay skips/onlys/snapshot-only/it-vacíos. Acción recomendada: reescribir 🔴-1 para ejercitar el guard real (vía `vi.resetModules` + import con env borrada, como ya hace `cloudKmsAdapter.test.ts`), y considerar activar `setSerialize(false)` en el race-test de lease.
