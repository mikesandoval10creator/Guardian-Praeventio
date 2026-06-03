# DEEP-EXT-18 — Auditoría EXHAUSTIVA de TESTS (Lote #18)

Deriva: `ledger.json` → `category==="I-TEST"`, ordenado por `path`, slice `[935:990]`
(55 archivos: `src/services/hvac/…` → `src/services/multiProject/projectComparator.test.ts`).
Metodología: lectura línea-por-línea de cada archivo. Caza de falsos-verdes.

Leyenda: 🔴 crítico (test no protege / pasaría con impl rota) · 🟡 medio (assert débil,
over-mock, tautología parcial) · 🔵 bajo (smoke/shape-only auto-declarado, nota informativa).

---

## Resumen ejecutivo (6-10 líneas)

El lote #18 es de **alta calidad**: la inmensa mayoría son tests de funciones puras
(calc engines, validadores, RAG scoping, mesh packet/relay, LOTO, JSA, IPER-adjacentes)
con builders explícitos, asserts sobre valores concretos y casos límite reales (clamps,
inmutabilidad, determinismo, boundary). No se encontró ningún rules-test con Admin SDK,
ni silent-pass, ni `it()` vacío, ni `.skip/.todo/.fixme`, ni snapshot-only, ni reimplementación
disfrazada. Los fakes (Firestore in-memory, mqtt mock, mesh transport) ejercen lógica real
del SUT y producen aserciones significativas — no son over-mock vacío. Hallazgos: **0 🔴**,
**2 🟡** (una tautología `≥0` y un assert excesivamente laxo de drop-ratio), **4 🔵**
(2 smoke import-only auto-declarados, 1 stub-disfrazado correctamente pineado, 1 desalineación
título-vs-objeto en un smoke). Ningún hallazgo invalida la protección efectiva de su módulo.

---

## 🟡 Medios

### 🟡-1 — Tautología `>= 0` en cleanup de expirados
`src/services/mesh/meshRelayQueue.test.ts:242`
Módulo: mesh / store-carry-forward queue.
```ts
expect(cleanup.evictedQueue + cleanup.evictedSeen).toBeGreaterThanOrEqual(0);
```
El test se titula *"remueve packets expirados"* pero la única aserción es la suma de dos
contadores no-negativos ≥ 0, lo cual es **siempre verdadero**. Pasaría aunque `cleanup()`
no removiera nada (regresión silenciosa: si la lógica de expiración dejara de funcionar,
el test seguiría verde). El comentario reconoce el ruido ("Bonus: cleanup también limpia
seenIds antiguos") pero no fija un valor esperado. Debería afirmar `evictedQueue >= 1`
para el packet que efectivamente expiró, o `size()===0` tras el cleanup.

### 🟡-2 — Drop-ratio demasiado laxo deja pasar impl rota
`src/services/iot/edgeFilter.test.ts:159-169` ("100 samples → ≥90% dropped")
Módulo: iot / EdgeFilter aggregation.
```ts
expect(transport.packets.length).toBeLessThanOrEqual(10);   // 100 samples
const ratio = 1 - transport.packets.length / 100;
expect(ratio).toBeGreaterThanOrEqual(0.9);
```
El comentario dice que el comportamiento real es ~1-2 packets (≥98% drop), pero la cota
acepta hasta 10 packets. Una regresión que multiplicara por ~5 los packets emitidos
(p.ej. bucket de 12s en vez de 60s) aún pasaría el test mientras viola el contrato de
"1 packet/min worst case" descrito en el título. El umbral debería ser
`<= 2` (o `<= 3`) para alinearse con el invariante documentado.

---

## 🔵 Bajos / Informativos

### 🔵-1 — Smoke import-only (deferido a e2e, auto-declarado)
`src/services/mcp/stdioBoot.test.ts:7-17`
Solo verifica que el módulo carga y que `bootStdioMcpServer`/`assertSdkAvailable` son
funciones; `assertSdkAvailable()` no-throw. El boot stdio real se cubre por subproceso en
CI/e2e (comentario explícito líneas 3-5). Aceptable como smoke; no protege la lógica de boot.

### 🔵-2 — Smoke import-only con desalineación título-vs-objeto
`src/services/mcp/zettelkastenStdioAdapter.test.ts:12-31`
El `describe` se titula *"zettelkastenStdioAdapter smoke import"* y el primer `it`
sí importa el adapter; pero los 3 `it` restantes (`MCP_TOOLS`, `MCP_RESOURCES`,
`ZK_CITATION_POLICY`) afirman sobre exports de `./zettelkastenServer.js`, **no** del
adapter — ya cubiertos por `zettelkastenServer.test.ts`. Cobertura redundante;
el único valor neto es el load-test del adapter (línea 13-16). Bajo impacto.

### 🔵-3 — Stub-disfrazado correctamente pineado (rule #13 OK)
`src/services/ml/vertexTrainer.test.ts:24-38`
Prueba un servicio que devuelve mock data (`status:'queued'`, `mockedModelId`,
`note` matchea `/stub/i`). Cumple anti-stub-disfrazado: el test (a) pinea la shape del
placeholder, (b) verifica que con `VERTEX_TRAINING_ENABLED=true` sin BigQuery el path
real lanza `BIGQUERY_NOT_CONFIGURED` (líneas 53-68), y (c) `isVertexTrainingAvailable()`
refleja env. No es falso-verde — es un stub honesto con contrato pineado. Nota solo
para inventario.

### 🔵-4 — searchIncidents "tenant scoping" depende del path string del fake
`src/services/incidents/incidentRagService.test.ts:95-138`
El fake `findNearest` devuelve **todos** los docs de la colección sin filtrar por vector;
el aislamiento cross-tenant lo da exclusivamente la construcción del path
`incident_vectors/{tenantId}/items` en el SUT. El test SÍ verifica que se consulta el
path correcto (línea 133) y que no se leakean docs de `tenant-B` — lo cual es la propiedad
relevante. No es falso-verde (el SUT realmente construye el path desde tenantId), pero la
semántica de "similaridad" del findNearest no se ejercita. Informativo.

---

## Verificaciones negativas (lo que se buscó y NO se encontró)

- **Rules-tests con Admin SDK / silent-pass**: ninguno (no hay `.firestore.test` ni
  emulador en este lote; los adapters usan `createFakeFirestore` / stubs in-memory que
  ejercen filter/sort/array-contains reales — `fakeFirestore.ts` verificado).
- **`it()` vacío / `.skip` / `.todo` / `.fixme` / `.only`**: ninguno.
- **Snapshot-only**: ninguno.
- **Asserts equivocados / triviales (`toBeDefined` solitario, `expect(true)`)**: ninguno
  significativo; todos los `toBeDefined` van acompañados de asserts de contenido.
- **Reimplementación-disfrazada** (el test recalcula con la misma fórmula del SUT):
  ninguna; los valores esperados son constantes literales o derivaciones independientes
  documentadas (p.ej. JSA residual `12*0.36→4`, CO2 `420+864≈1284`, Mifflin `1780`).
- **"wire-up contract" solo `.stack` sin supertest / validate→next sin 400**: N/A
  (lote sin rutas HTTP). Los wire tests (firestoreBridge, reportIncident XP/index,
  meshRelayXp) afirman sobre datos escritos / args de mocks, no sobre mera existencia.
- **Over-mocking**: los mocks (jspdf, mqtt, firebase-admin, capacitor-mesh plugin,
  emergency module) reemplazan dependencias externas no-deterministas; el SUT y su lógica
  (hash SHA-256 real, state machine, dispatch, chunking) se ejercitan de verdad.
- **Tests que pasarían con impl incorrecta**: solo los 2 🟡 anteriores tienen esta
  debilidad (parcial); el resto fija valores/branches discriminantes.

## Notas de cumplimiento de directorio

- `src/services/medical/aptitudeCert*.test.ts` y `bodyRoutineGenerator.test.ts` viven bajo
  ruta escaneada por el medical-guard (ADR 0012). No referencian funciones de diagnóstico
  prohibidas (`inferDiagnosis`, `calificarComoLaboral`, etc.); prueban generación/firma de
  certificados de aptitud y rutinas ergonómicas (REBA/RULA). Sin violación.
- `pdfImmutableService.test.ts` cubre el contrato de inmutabilidad (hash SHA-256 sobre bytes
  reales del mock) — robusto: tamper-byte, normalización hex, determinismo, round-trip
  verify. Buen ejemplo de mock acotado + lógica criptográfica real.

---
**Veredicto del lote:** Sin falsos-verdes críticos. 2 asserts a endurecer (🟡-1, 🟡-2).
Doc-only; sin cambios de código, sin commit.
