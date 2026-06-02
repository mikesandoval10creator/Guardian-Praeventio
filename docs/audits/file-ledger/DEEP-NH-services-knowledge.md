# DEEP — needs-human: servicios conocimiento/IA-infra · 2026-06-02

**Archivos revisados:** 96 (filtro `category==="FEAT-services" && block===""` en
`ledger.json`, subdirectorios: zettelkasten, systemEngine, euler, ai-no-core,
eventBus, eventStore, coach, mcp, openapi, knowledge, capacity, consistency,
adminBurden, etl, excelImporter/excelImport, controlComparator. `semantic` NO
existe como dir — sin archivos). Code-first, cada archivo abierto; `file:line`
reales. No se infirió del nombre.

> Método de wiring: para cada subsistema se rastreó el grafo de imports reales
> (descartando coincidencias en comentarios y colisiones de nombre). Varios
> "0 consumers" iniciales resultaron falsos (import vía barrel / variable local
> homónima); los marcados 🏚️ aquí se confirmaron con grep de `import` real.

---

## 1. Lo que YA HACE (por subsistema, con bloque sugerido)

### Zettelkasten — el grafo de conocimiento (cross-cutting / B14-IA + B2)
- **Fuente canónica: hay 3 escrituras, pero UNA sola ruta viva.** El cliente
  llama `writeNodes()`/`writeNodesDebounced()` (`persistence/writeNode.ts`) →
  `POST /api/zettelkasten/nodes` (montado `server.ts:922`). El route hace
  **dual-write SÍNCRONO**: doc legacy en `zettelkasten_nodes`
  (`routes/zettelkasten.ts:242`) + doc canónico en `nodes/{tid}_{pid}_{zkId}`
  vía el core puro `materializeNode` (`routes/zettelkasten.ts:276,288`). El
  fallo del canonical NO bloquea (`zettelkasten.ts:289-296`, warn). El
  server-side writer (`serverZkNodeWriter.ts:130`) usa el MISMO core puro.
  ⇒ La colección `nodes` es la lectura del cliente; `zettelkasten_nodes` es la
  histórica. El materializer puro (`canonical/materializer.ts`) es real,
  determinista, idempotente y bien testeado.
- **El trigger standalone `materializeNode` está MUERTO (behind flag).**
  `src/server/triggers/zettelkastenMaterializer.ts:15-17` documenta "no se
  importa en server.ts hasta MATERIALIZER_ENABLED=true"; confirmado: 0 matches
  de `zettelkastenMaterializer`/`MATERIALIZER_ENABLED` en `server.ts`. Como el
  route ya hace dual-write inline, este trigger es **redundante** (la
  materialización ya ocurre). Ver §4.
- **Bernoulli generators (14 archivos `bernoulli/*`): REALES y consumidos.**
  `CalculatorHub.tsx:45`, `VisionAnalyzer.tsx:13`, `StructuralCalculator.tsx:9`,
  `BioAnalysis.tsx:23`, `HazmatStorageDesigner.tsx:12`, `PublicDemo.tsx:36`.
  Cada uno → `writeNodesDebounced`. Bloque: **B14-IA** (motor de nodos) con
  ramas a B2/B3/B10.
- **edges.ts + edgeStoreFirestore.ts + backlinks.ts: wireados.** `edges.ts`
  (5 consumers), `edgeStoreFirestore.ts` (route horometro + backlinks),
  `backlinks.ts` cableado al endpoint `POST /backlinks`
  (`routes/zettelkasten.ts:79,462`). `resilientRetrieval.ts`: real, consumido
  por `useResilienceHealth`, `resilientAiAdapters`, `asesorAdaptersFactory`.
- **climateRiskCoupling.ts: REAL y muy cableado** (job `dailyClimateRiskScan`,
  `GanttProjectView`, `admin.ts`, `useCalendarPredictions`,
  `environmentBackend`, families). Bloque: **B18-Analítica / cross-cutting**.
- **families/* (5 registries): wireados** vía `incidentPostmortem.ts` y
  `ergonomicLegalTrigger.ts` + climateNodeRegistry. Bloque B14/B2.

### SystemEngine — bus reactivo Firestore (cross-cutting / infra)
- **REAL y completamente cableado.** Server trigger montado
  (`server.ts:406-407,928` → `setupSystemEngineTrigger` + `/api/system-events`);
  cliente `SystemEngineProvider` montado en `AppProviders.tsx:140`; 2 policies
  vivas registradas (`SystemEngineProvider.tsx:53-54`: `geofenceToSos`,
  `tierChangeReactivity`). `decisionEngine.ts` (Promise.allSettled, aislamiento
  de policy), `executor.ts` (fire-and-forget, bindings parciales),
  `subscriber.ts` (onSnapshot + onLocalEmit), `eventLog.ts`, `eventTypes.ts`:
  todos reales. Bloque: **cross-cutting/infra**.
- **adapters/* (9 archivos): mount-points placeholder por diseño.** Importados
  SOLO por `SystemEngineProvider.tsx`. Varios son no-op intencionales
  (`sensorContextAdapter.ts` cuerpo vacío con header explicando que
  FallDetection ya escala por su cuenta; idem theme/language/normative). Reales
  como estructura, pero sin lógica de emisión hoy (placeholders honestos). Ver §4.

### AI infra (no-core) — adapters + RAG (B14-IA)
- **Adapter facade REAL y crítico.** `ai/index.ts` (selección vertex/gemini/
  noop + residencia LATAM strict), `vertexAdapter.ts` (southamerica-west1,
  cierra finding H4), `aiAdapter.ts` (tipos). Consumidos por `b2d/suite.ts`,
  `runWithGuardrails.ts`, `geminiAdapter.ts`, `ml/vertexTrainer.ts`. Bloque B14.
- **`resilientAiAdapters.ts` REAL:** consumido por `asesorAdaptersFactory.ts` →
  `ResilientAsesorPanel.tsx`. Tier1 SLM offline / Tier2 ZK / Tier3 Gemini.
- **`eppDetectorOnDevice.ts` REAL** (TFLite on-device, 3 consumers incl.
  `VisionAnalyzer`, `gemini/vision.ts`). Bloque B10-EPP.
- **`contextualAssistant.ts`**: pure, robusto, pero **0 importadores reales**
  (la referencia en `recommendationExplainer.ts:14` es comentario). 🏚️.

### Coach / Capacity / Consistency / ControlComparator / KnowledgeBase / AdminBurden / ETL / Excel
Todos con route + hook + (a veces) page → REALES y reachable:
- `consistency/consistencyAuditor.ts`: route `consistency.ts`, job
  `runConsistencyAudit`, hook `useConsistency`, page `ConsistencyAudit.tsx`,
  menú sidebar. **B17-Admin**.
- `controlComparator/*`: route `controlComparator.ts` + hook
  `useControlComparator`. **B18 / B2**.
- `knowledgeBase/knowledgeBaseService.ts`: route + page `KnowledgeBase.tsx`.
  **B6-Capacitación / cross-cutting**.
- `capacity/{normativeAlerts,tierEvaluation}.ts`: hooks `useProjectCapacity`.
  **B15-Billing / B5-Cumplimiento**.
- `adminBurden/*`: route `adminBurden.ts` + hook `useAdminBurden`. **B17-Admin**.
- `etl/{csvAdapter,schemas}.ts`: `CsvImportExportModal` (Findings/Training/
  Cuadrillas). **B17-Admin / cross-cutting**.
- `excelImporter/*` (index, recordValidator, xlsxReader, deduplicator): route
  `import.ts:43`. **B17-Admin**. (legacy `excelImport/` ver §2).
- `coach/normativeRag.ts`: route `coachRag.ts` (`server.ts:1109`) +
  legal/medicine/chemical backends + `coach/prompts.ts`. **B14 / B5**.
- `coachBackend.ts`: cableado a `gamification.ts`. **B6 / B14**.

### MCP / OpenAPI — interoperabilidad (infra)
- **MCP REAL** (read-only ZK server). Entrypoint `bin/mcp-server.mjs` + scripts
  `mcp:dev`/`mcp:start` (package.json:17-18). `zettelkastenServer.ts` define
  `ZkReadAdapter`/MCP_TOOLS (reusado por `zkRagContextBuilder` y
  `server/mcp/zkFirebaseReadAdapter.ts`); `zettelkastenStdioAdapter.ts` +
  `stdioBoot.ts` son el shim stdio. **infra**.
- **OpenAPI REAL y montado** (`server.ts:60,745` → `/api/openapi.json` +
  `/api/openapi.html` Swagger UI). `bootstrap.ts`+`registry.ts`+`specGenerator.ts`
  consumidos por `routes/openapi.ts:14-17`. **infra**.

---

## 2. Lo que está PENDIENTE (huérfanos/stubs/deuda)

**Huérfanos confirmados (0 importadores reales en producción):**
1. **`src/services/euler/*` — 10 módulos, ~4053 LOC, TODOS huérfanos.**
   El barrel `euler/index.ts` re-exporta graphConnectivity, criticalLoad,
   odeIntegrator, polyhedronAchievements, eulerianPath, fftAnalyzer,
   eulerLagrange, inviscidFlow, zettelkastenTopology. Grep de imports en
   producción: 0 (el `criticalLoad` en `StructuralCalculator.tsx:173` es una
   propiedad de `bucklingResult`, NO el módulo). Solo se importan en sus propios
   `.test.ts`. Pareja matemática de Bernoulli prometida en
   `docs/sprints/EULER_INTEGRATION_SPEC.md` pero **nunca conectada a
   CalculatorHub ni a nada**. Es el huésped más grande del lote. 🏚️
2. **`src/services/eventBus/{eventBus,integrations}.ts` — ~549 LOC, huérfanos.**
   In-process pub/sub. 0 consumers reales (`src/store/eventBus.ts` es OTRO
   store homónimo que NO lo importa). `integrations.ts` (wrappers
   faena/loneWorker/fatigue → emit) tampoco se importa. "Nadie escucha". 🏚️
3. **`src/services/ai/contextualAssistant.ts` (227 LOC)** — 0 importadores. 🏚️
4. **`src/services/ai/zkRagContextBuilder.ts` (343) + `zkRagResponseValidator.ts`
   (176)** — par RAG, 0 callers de sus exports. Solo cross-referenciados en
   comentarios. 🏚️
5. **`src/services/coach/personaSelector.ts` (273)** — `selectPersona`/
   `getPersonaMetric` con 0 consumers. 🏚️
6. **`src/services/zettelkasten/{smartActions,contextualActions,centrality}.ts`
   (~840 LOC)** — engines puros bien hechos (DS 594/DS 54 citados,
   nunca-auto-aplicar), pero 0 importadores del módulo (el `smartActions` que
   usa `useZettelkastenIntelligence`/`SmartConnectionsPanel` es una variable
   local homónima, no el servicio). 🏚️
7. **`src/hooks/useCoachRag.ts`** (fuera de ledger pero parte de la cadena) —
   0 componentes lo consumen, aunque el route `coachRag` SÍ está montado. 🟡
8. **`src/services/excelImport/excelImporter.ts` (219, legacy Sprint K v1)** —
   superseded por `excelImporter/` (plural). 0 imports reales; el header del
   nuevo dice "el legacy permanece" pero nada lo usa. 🏚️

**Deuda / placeholders honestos (no stubs disfrazados):**
- `systemEngine/adapters/*`: 6-7 adapters son no-op intencionales (mount-points
  para refactors futuros). Documentados en sus headers. 🟡
- `zettelkastenMaterializer.ts` trigger: vivo en tests, muerto en runtime
  (flag), y **redundante** con el dual-write inline del route. 🟡

**Riesgos:** ninguno P0/P1 de seguridad detectado. `materializeNode` dual-write
es failure-soft (correcto). No se hallaron `NotImplementedError`, `mock`,
`Math.random()` ni `void audit(...)` en el lote.

---

## 3. Tabla por archivo

Estados: ✅ real+cableado · 🟡 real pero parcial/placeholder/no-consumido ·
🏚️ huérfano (0 importadores prod) · 🔵 infra/cross-cutting · 🔑 seguridad ·
🔴 roto.

| Archivo | LOC | Estado | Bloque | Propósito + hallazgo file:line |
|---|---|---|---|---|
| zettelkasten/canonical/materializer.ts | 269 | ✅ | B14 | Core puro `nodes`←`zettelkasten_nodes`; usado por route:276 + serverZkNodeWriter:130 |
| zettelkasten/persistence/writeNode.ts | 291 | ✅ | B14 | Cliente POST + offline queue + debounce; SHA-256 id determinista (writeNode.ts:87) |
| zettelkasten/types.ts | 83 | ✅ | B14 | Tipos compartidos RiskNodePayload |
| zettelkasten/edges.ts | 292 | ✅ | B2/B14 | Aristas tipadas bidireccionales; 5 consumers |
| zettelkasten/edgeStoreFirestore.ts | 45 | ✅ | B14 | EdgeStore Firestore compartido (horometro + backlinks) |
| zettelkasten/backlinks.ts | (≈) | ✅ | B14 | Wireado a POST /backlinks (zettelkasten.ts:79,462) |
| zettelkasten/resilientRetrieval.ts | 345 | ✅ | B14 | Fallback multi-source; useResilienceHealth + asesor |
| zettelkasten/climateRiskCoupling.ts | 637 | ✅ | B18 | Clima→RiskNode; job dailyClimateRiskScan + 6 consumers |
| zettelkasten/centrality.ts | 132 | 🏚️ | B14 | Degree centrality + archive candidates; 0 importadores |
| zettelkasten/smartActions.ts | 320 | 🏚️ | B14 | 5 smart actions DS594/DS54; 0 importadores del módulo |
| zettelkasten/contextualActions.ts | 388 | 🏚️ | B14 | Acciones contextuales por NodeKind; 0 importadores |
| zettelkasten/families/* (5) | ~355 | ✅ | B14/B2 | Registries; incidentPostmortem + ergonomicLegalTrigger |
| zettelkasten/bernoulli/* (14) | ~1100 | ✅ | B14 | Generadores; CalculatorHub:45 + 5 más |
| systemEngine/decisionEngine.ts | 79 | ✅ | 🔵 | event→policies→actions; aislamiento allSettled |
| systemEngine/executor.ts | 124 | ✅ | 🔵 | dispatch a contexts; fire-and-forget |
| systemEngine/subscriber.ts | 103 | ✅ | 🔵 | onSnapshot system_events + onLocalEmit |
| systemEngine/eventLog.ts | 270 | ✅ | 🔵 | FS+IDB outbox + idempotency ring |
| systemEngine/eventTypes.ts | 169 | ✅ | 🔵 | Zod discriminated union |
| systemEngine/policies/* (3) | ~203 | ✅ | 🔵 | 2 policies vivas registradas (Provider:53-54) |
| systemEngine/adapters/* (9) | ~143 | 🟡 | 🔵 | Mount-points; varios no-op intencionales (sensor vacío) |
| systemEngine/README.md | 165 | ✅ | 🔵 | Doc fiel a la implementación |
| ai/index.ts | 167 | ✅ | B14 | Facade vertex/gemini/noop + residencia strict |
| ai/aiAdapter.ts | 136 | ✅ | B14 | Interfaz adapter (tipos) |
| ai/vertexAdapter.ts | 324 | ✅🔑 | B14 | Vertex real southamerica-west1; cierra H4 (vertexAdapter.ts:46) |
| ai/resilientAiAdapters.ts | 387 | ✅ | B14 | Tiers SLM/ZK/Gemini; asesorAdaptersFactory |
| ai/eppDetectorOnDevice.ts | 364 | ✅ | B10 | TFLite on-device; 3 consumers |
| ai/colorBasedEppDetector.ts | 348 | 🟡 | B10 | Usado solo por eppDetectorOnDevice (cadena interna) |
| ai/contextualAssistant.ts | 227 | 🏚️ | B14 | 0 importadores reales |
| ai/zkRagContextBuilder.ts | 343 | 🏚️ | B14 | RAG context; 0 callers de exports |
| ai/zkRagResponseValidator.ts | 176 | 🏚️ | B14 | Validador RAG; 0 callers |
| coach/normativeRag.ts | 386 | ✅ | B14/B5 | route coachRag + legal/med/chem backends |
| coach/personaSelector.ts | 273 | 🏚️ | B14 | selectPersona; 0 consumers |
| coachBackend.ts | 38 | ✅ | B6/B14 | getSafetyCoachResponse; gamification.ts |
| capacity/normativeAlerts.ts | 283 | ✅ | B5 | Alertas Ley16.744/DS54; useProjectCapacity |
| capacity/tierEvaluation.ts | 155 | ✅ | B15 | Capacidad/tier puro; useProjectCapacity |
| consistency/consistencyAuditor.ts | 347 | ✅ | B17 | route+job+hook+page+menú |
| consistency/consistencyStateBuilder.ts | 226 | ✅ | B17 | Builder consumido por consistency |
| controlComparator/controlComparator.ts | 314 | ✅ | B18 | route+hook |
| controlComparator/controlFailureLibrary.ts | 670 | ✅ | B2 | Biblioteca fallas; 2 consumers |
| etl/csvAdapter.ts | 355 | ✅ | B17 | CSV import/export; CsvImportExportModal |
| etl/schemas.ts | 312 | ✅ | B17 | 6 esquemas entidad |
| knowledgeBase/knowledgeBaseService.ts | 180 | ✅ | B6 | route + page KnowledgeBase |
| adminBurden/adminBurdenTracker.ts | 213 | ✅ | B17 | route+hook |
| adminBurden/automationSuggester.ts | 150 | ✅ | B17 | route+hook |
| excelImporter/index.ts | 52 | ✅ | B17 | route import.ts:43 |
| excelImporter/recordValidator.ts | 278 | ✅ | B17 | Validador filas |
| excelImporter/xlsxReader.ts | 316 | ✅ | B17 | SheetJS thin layer |
| excelImporter/deduplicator.ts | 125 | ✅ | B17 | Dedupe filas |
| excelImport/excelImporter.ts | 219 | 🏚️ | B17 | Legacy v1; 0 imports reales (superseded) |
| mcp/zettelkastenServer.ts | 340 | ✅ | 🔵 | ZkReadAdapter + MCP_TOOLS read-only |
| mcp/zettelkastenStdioAdapter.ts | 168 | ✅ | 🔵 | Shim stdio (bin/mcp-server.mjs) |
| mcp/stdioBoot.ts | 62 | ✅ | 🔵 | Boot stdio |
| openapi/bootstrap.ts | 457 | ✅ | 🔵 | Registry bootstrap (routes/openapi.ts:17) |
| openapi/registry.ts | 92 | ✅ | 🔵 | Registro Zod |
| openapi/specGenerator.ts | 227 | ✅ | 🔵 | Genera OpenAPI 3.1 (server.ts:745) |
| eventBus/eventBus.ts | 360 | 🏚️ | 🔵 | Pub/sub in-process; 0 consumers reales |
| eventBus/integrations.ts | 189 | 🏚️ | 🔵 | Wrappers SST→emit; 0 consumers |
| eventStore/inMemoryEventStore.ts | 231 | ✅ | 🔵 | Event store CQRS; incidentSystem.ts:19 |
| eventStore/types.ts | 172 | ✅ | 🔵 | Tipos EventStore; cqrs/incidents |
| euler/index.ts + 10 módulos | ~4053 | 🏚️ | B14 | Barrel Euler; 0 consumers prod (solo tests) |
| triggers/zettelkastenMaterializer.ts* | 130+ | 🟡 | B14 | *(fuera de filtro) Flag-gated, NO en server.ts, redundante con dual-write |

---

## 4. Para decisión del usuario (❓/⚠️)

1. ⚠️ **`src/services/euler/*` (~4053 LOC, 10 módulos) está 100% huérfano.**
   El spec (`EULER_INTEGRATION_SPEC.md`) prometía cablearlo a CalculatorHub
   como "pareja de Bernoulli", pero ninguna fase llegó a conectarse.
   ❓ ¿Wirear (al menos `criticalLoad`/`zettelkastenTopology`) o archivar/borrar?
   Es la mayor superficie de código muerto del lote.

2. ⚠️ **`eventBus/{eventBus,integrations}.ts` (~549 LOC) no tiene listeners.**
   Su propio header dice que coordina faena/loneWorker/fatigue, pero
   `integrations.ts` no se importa en ningún lado y el `store/eventBus.ts`
   homónimo es independiente. ❓ ¿Cablear los wrappers o borrar el subsistema?
   (El SystemEngine Firestore-bus ya cubre la coordinación cross-domain real.)

3. ❓ **Doble materialización ZK.** El route hace dual-write inline
   (`zettelkasten.ts:288`) Y existe un trigger `zettelkastenMaterializer.ts`
   flag-gated que haría lo mismo vía onSnapshot. ¿Se quería migrar al trigger
   (y quitar el inline) o el trigger es deuda a borrar? Hoy conviven 2 diseños
   para el mismo efecto; activar el flag duplicaría escrituras.

4. ❓ **Cadena RAG del coach a medio cablear.** `coach/normativeRag.ts` está
   vivo (route+backends), pero `ai/zkRagContextBuilder.ts`,
   `ai/zkRagResponseValidator.ts`, `ai/contextualAssistant.ts`,
   `coach/personaSelector.ts` y el hook `useCoachRag.ts` están huérfanos.
   ¿Fueron reemplazados por `normativeRag` (borrar) o falta enchufarlos al
   panel de coach?

5. ❓ **ZK smart-engines huérfanos** (`smartActions`, `contextualActions`,
   `centrality`, ~840 LOC, bien hechos y con normas citadas). ¿Conectar a
   `RiskNetwork`/`SmartConnectionsPanel` (parecían diseñados para eso) o archivar?

6. ❓ **`excelImport/excelImporter.ts` legacy** — confirmar que el nuevo
   `excelImporter/` lo reemplaza y borrar la v1 (219 LOC).

7. 🟡 **systemEngine `adapters/*` no-op**: intencionales y documentados, pero
   son superficie que invita a confusión. ¿OK dejarlos como mount-points o
   consolidar en uno?
