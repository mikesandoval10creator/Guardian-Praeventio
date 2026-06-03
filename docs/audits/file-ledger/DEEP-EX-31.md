# DEEP-EX-31 — Pasada exhaustiva línea-por-línea (Lote #31)

**Deriva:** `ledger.json` → `category` empieza con `FEAT` && `block === "B14-IA"`,
ordenado por `path`, slice `[55:110]`.
**Universo:** 175 archivos `FEAT`/`B14-IA`; este lote cubre los siguientes 55
(índices 55–109), continuación directa de `DEEP-EX-30.md` (slice `[0:55]`).
**Foco:** núcleo IA/Gemini/SLM — server ZK routes/triggers, adapters AI
(gemini/vertex/resilient), guardrails, el split `src/services/gemini/*`, los
backends `geminiBackend.ts` / `chemicalBackend.ts` / `networkBackend.ts`, coach
RAG, explainability, digital-twin lifecycle, motores Euler. Hallazgos NUEVOS
(no repite `DEEP-B14-IA.md`: whitelist 84 acciones 1:1, circuit breaker,
aiFeedback replay-guard, asesorDomainFocus ADR 0012; ni `DEEP-EX-30.md`:
medicalAnalysisBackend fuera del guard, wisdomCapsule 5xx/audit, materializer
doc-drift, GuardianVoiceAssistant Math.random, tier-fallback).

## Atestación 55/55

Los 55 archivos del slice fueron leídos línea-por-línea. Server routes/triggers/
services (`zettelkasten.ts`, `serverZkNodeWriter.ts`, `zettelkastenMaterializer.ts`)
completos. El dispatcher `/api/gemini` (`gemini.ts:380-462`) se releyó para
resolver reachability/whitelist de cada export. Cruces verificados:
`ALLOWED_GEMINI_ACTIONS` (`gemini.ts:119-205`, 84 acciones), `geminiService.ts`
(client wrappers + arg-arrays), `geminiBackend.ts` (`export *` chain l.1450-1466),
`scripts/precommit-medical-guard.cjs`, `ARCHITECTURE.md:110`. Los 10 motores
`src/services/euler/*` se escanearon por patrón de riesgo (`Math.random`,
`JSON.parse`, `fetch`, `firestore`, `admin.`, `GoogleGenAI`, `process.env`) —
**0 I/O, puros y determinísticos**, confirmados limpios.

## Hallazgos

| # | Sev | Archivo:línea | Hallazgo |
|---|-----|---------------|----------|
| 1 | 🔴 | `src/services/networkBackend.ts:41,168` (vía `gemini.ts:430` + whitelist `gemini.ts:153-154`) | **Identidad del autor spoofeable + sin `assertProjectMember` (conv. #3 + #6).** `syncNodeToNetwork(nodeData, authorUid)` y `syncBatchToNetwork(operations, authorUid)` están whitelisted y son alcanzables vía `/api/gemini`. El dispatcher hace `(geminiBackend[action])(...args)` con `args = req.body.args` **verbatim del cliente** — NO inyecta `req.user.uid`. El `authorUid` que se persiste en `metadata.authorId` (`networkBackend.ts:58`) es el valor que mande el cliente (`geminiService.ts:84` lo deriva de `auth.currentUser?.uid` pero el server confía ciegamente). Además `nodeData.projectId` es client-controlled y NUNCA pasa por `assertProjectMember` antes de los writes Admin-SDK que **bypassean las reglas** (`nodeRef.set` l.65, `targetRef.update` arrayUnion sobre IDs arbitrarios l.95-98, `vector_store` set l.70, batch `delete` l.184-186). Permite: inyección/sobre-escritura de nodos cross-tenant (incl. `nodeData.id` arbitrario), back-links a target IDs ajenos, y borrado de nodos+vector docs de otro proyecto. |
| 2 | 🔴 | `src/services/networkBackend.ts:77,130` | **RAG poisoning vía fallback `projectId \|\| 'global'` (nodo global sin gate).** Un `nodeData` sin `projectId` se escribe a `vector_store/{node-id}` con `projectId: 'global'` (l.77) — la colección que "El Guardián" consume para RAG. La auto-conexión luego consulta `nodes where projectId == 'global'` (l.130-132). Cualquier nodo huérfano de projectId queda **globalmente consultable/citable a través de todos los tenants** (RAG poisoning/leak). Combinado con #1 (projectId client-controlled, sin membership check) un atacante puede sembrar contenido en el corpus global del RAG deliberadamente. |
| 3 | 🟡 | `src/services/networkBackend.ts:41-205` | **Writes de estado sin `audit_logs` (conv. #3).** Ni `syncNodeToNetwork` ni `syncBatchToNetwork` escriben fila de auditoría. Operaciones de escritura sin traza: set `nodes/{id}`, set `vector_store/{node-id}`, `arrayUnion` bidireccional, y en batch el `delete` destructivo de `nodes` + `vector_store` (l.181-188). `grep audit_logs` = 0. El módulo es alcanzable por RPC autenticado (whitelisted) → toda mutación del grafo por esta vía es invisible al compliance trail. |
| 4 | 🟡 | `src/services/chemicalBackend.ts:89` (vía `gemini.ts` whitelist `analyzeChemicalRisk`) | **`JSON.parse(response.text)` sin try/catch (conv. #5).** `analyzeChemicalRisk` está whitelisted y resuelve a `chemicalBackend.ts` (no colisiona). Tras `if (!response.text) throw`, hace `JSON.parse(response.text)` crudo (l.89) sin try/catch ni fallback tipado. Usa `responseSchema` (JSON-mode) → improbable pero no imposible que el modelo devuelva no-JSON (fences, truncado por safety-block). El catch externo del dispatcher (`gemini.ts:454`) lo convierte en 500 con guard `NODE_ENV` (no filtra internals), pero la convención exige try/catch local con fallback tipado o 502. |
| 5 | 🟡 | `src/services/geminiBackend.ts:1042` vs `src/services/chemicalBackend.ts:98` | **Colisión de export `designHazmatStorage` — versión RAG sombreada (dead code + comportamiento divergente).** `designHazmatStorage` se declara localmente en `geminiBackend.ts:1042` (OGUC + DS 43, retorna **Markdown string**, sin RAG) Y se re-exporta vía `export * from './chemicalBackend.js'` (l.1459, versión DS 148/2003 + RAG citations, retorna **JSON**). En ESM la declaración local gana sobre el star-export, así que la acción whitelisted `designHazmatStorage` invoca la versión Markdown; la versión chemicalBackend (con `JSON.parse` sin try/catch en l.147) queda **inalcanzable/dead-code**. Dos normativas y dos shapes de retorno distintos para el mismo nombre — silencioso, sin warning de compilación. Riesgo de regresión: cualquiera que asuma la versión RAG está equivocado. |
| 6 | 🟡 | `src/services/gemini/{personPlans.ts:243, safetyDocs.ts:81,135, suggestions.ts:113, vision.ts:161, risk.ts:232}` | **`JSON.parse(response.text \|\| '…')` sin try/catch en 6 callsites whitelisted (conv. #5, patrón sistémico).** Todas las funciones (`generateCompensatoryExercises`/`generatePersonalizedSafetyPlan`/`generatePTS`/`generatePTSWithManufacturerData`/`suggestRisksWithAI`/`suggestNormativesWithAI`/`analyzeBioImage` y `analyzeRiskWithAIImpl`) están en `ALLOWED_GEMINI_ACTIONS` y son alcanzables. NO usan el helper seguro `parseGeminiJson` ni envuelven el parse. `risk.ts:232` es el peor: `JSON.parse(resultString)` donde `resultString` viene de `queryCommunityKnowledge` (cache community-knowledge, NO garantiza JSON aunque el fallback sí use JSON-mode). Contrasta con `operations.ts` que sí canaliza todo por `parseGeminiJson`. No-leak (catch del dispatcher) pero viola la convención y produce errores difíciles de atribuir. |
| 7 | 🟡 | `ARCHITECTURE.md:110` + headers `gemini/_shared.ts:1`, `gemini/chat.ts:3`, `gemini/embeddings.ts:3`, `ai/geminiAdapter.ts:23` | **Doc-drift de LOC de `geminiBackend.ts` (conv. #20).** El archivo real es **1466 LOC**, pero `ARCHITECTURE.md:110` dice "2923 LOC", los headers del split dicen "2924 LOC" (`chat.ts`, `embeddings.ts`, `operations.ts`), `_shared.ts:1` dice "3070 líneas", y `geminiAdapter.ts:23` dice "2664 LOC". Cuatro valores distintos, todos stale (el split ya extrajo ~14 backends). Exactamente el tipo de drift que la conv. #20 busca evitar. |
| 8 | 🔵 | `src/services/zettelkasten` POST `/nodes` (`zettelkasten.ts:288`) + `serverZkNodeWriter.ts:137` | **Canonical dual-write a `nodes/{path}` sin `assertProjectMember` sobre el tenantId resuelto, pero atenuado.** El POST `/nodes` SÍ valida `assertProjectMember(callerUid, projectId)` (l.206) antes de escribir, y el `tenantId` se resuelve del doc del proyecto (no del cliente, l.219-234) — correcto. Nota menor: si dos proyectos de tenants distintos compartieran `idempotencyKey` (improbable: SHA-256 incluye projectId vía `nodeIdFor`), el `set(..., {merge:true})` sobre `zettelkasten_nodes/{key}` (colección legacy plana, sin prefijo tenant) podría mezclar. Sin acción inmediata; documentado para descartar. La auditoría sí se escribe (l.299-315). Limpio en lo sustantivo. |
| 9 | 🔵 | `src/services/ai/index.ts:97-104` (`getAiAdapter`) | **Fallback silencioso vertex→gemini-consumer en routing process-wide.** `getAiAdapter()` con `preferred='vertex-ai'` y vertex no disponible cae a `gemini-consumer` (us-central1) **sin throw ni log** (l.99-102). El comentario lo reconoce y deriva a `getAiAdapterFor({strict})` para tenants con contrato de residencia. Es consistente con el diseño (la ruta estricta existe), pero un operador que setee `AI_ADAPTER=vertex-ai` proceso-wide creyendo forzar Santiago puede romper residencia LATAM silenciosamente si vertex no está configurado. Sin acción — el strict path cubre el caso contractual; documentado para descartar falso positivo. |

## Limpios (sin hallazgos)

- **Server ZK puro (auth + membership + Zod + error scoped):**
  `zettelkasten.ts` (`/nodes`, `/nl-query`, `/risk-control-suggestions`,
  `/backlinks` — todos `verifyAuth` + `assertProjectMember` + `validate(Zod)`,
  500 con guard `NODE_ENV`), `serverZkNodeWriter.ts` (actor stampeado del token
  por el caller, audit row por nodo), `zettelkastenMaterializer.ts` (pure I/O
  shim, ship-behind-flag, valida path tenant antes de materializar).
- **Adapters AI:** `aiAdapter.ts`, `geminiAdapter.ts` (key lazy + re-read),
  `vertexAdapter.ts` (residencia Santiago + classifyError TIMEOUT/QUOTA/UPSTREAM),
  `resilientAiAdapters.ts` + `resilientAiOrchestrator.ts` (5-tier, timeouts,
  canned con disclaimer), `asesorAdaptersFactory.ts`, `contextualAssistant.ts`
  + `zkRagContextBuilder.ts` + `zkRagResponseValidator.ts` (citation policy dura,
  multi-tenant isolation por tenantId obligatorio, anti-hallucination cross-check).
- **Guardrails:** `aiGuardrails.ts` (PII/ADR-0012/legal phrase detection),
  `citationValidator.ts`, `hallucinationGuard.ts`, `runWithGuardrails.ts`
  (fallback determinístico + log `ai_guardrail_blocked`), `versionedPrompts.ts`,
  `index.ts`, `aiQuality/aiAuditLog.ts` (BLACKLISTED_AI_ACTIONS gate +
  `assertHumanGatedAction`).
- **Toggle/drift:** `aiToggle/aiModeController.ts` (rules-only / fail-closed),
  `aiToggle/ruleDriftDetector.ts` — puros, sin LLM.
- **Coach:** `coach/normativeRag.ts` (in-memory + Pinecone fallback, NUNCA
  toca el kernel ZK), `coach/personaSelector.ts` (medical_advisor + ergonomist
  con guardrail "NO diagnóstico clínico"), `coach/prompts.ts` (5 personas con
  citation obligatoria; MEDICINE_PROMPT advisory, "NO afirmar EP sin estudio"
  — dentro de ADR 0012). **Nota:** `coach/prompts.ts` y `chemicalBackend.ts`
  NO los escanea `precommit-medical-guard.cjs` (scope solo `health/medicine/`);
  hoy quedan dentro de ADR 0012 pero son punto ciego del guard — mismo patrón
  que `medicalAnalysisBackend.ts` (DEEP-EX-30 #1).
- **Gemini split (parsing seguro vía `parseGeminiJson`):** `gemini/_shared.ts`,
  `gemini/chat.ts` (anti-injection `<user_input>` delimiters + asesorDomainFocus
  ADR 0012), `gemini/embeddings.ts` (`autoConnectNodes` JSON.parse SÍ con
  try/catch), `gemini/governance.ts` (circuit+quota, `tenantId='system'`
  bypass documentado), `gemini/operations.ts` (7 funciones, todas
  `parseGeminiJson`), `gemini/parsing.ts`, `gemini/pii.ts`.
- **Otros:** `explainability/recommendationExplainer.ts` (det vs LLM share,
  partition por actionability), `digitalTwin/lifecycle/objectLifecycleOrchestrator.ts`
  (puro, schedules DS 594/NCh, no persiste), `ar/arSceneOrchestrator.ts`
  (Haversine puro), `ml/vertexTrainer.ts` (STUB intencional con guard
  fail-loud + descartado en TODO.md §2.7 + isVertexTrainingAvailable; cumple
  anti-stub-disfrazado #13), `geminiService.ts` (client wrapper),
  `euler/*` (10 motores matemáticos puros — `criticalLoad`, `eulerLagrange`,
  `eulerianPath`, `fftAnalyzer`, `graphConnectivity`, `index`, `inviscidFlow`,
  `odeIntegrator`, `polyhedronAchievements`, `zettelkastenTopology`).

## Resumen ejecutivo

Dos 🔴 nuevos convergen en `networkBackend.ts`, ambos alcanzables vía el
dispatcher whitelisted `/api/gemini`: (1) `syncNodeToNetwork`/`syncBatchToNetwork`
reciben `authorUid` y `nodeData.projectId` **del cliente** y el server los usa
verbatim — identidad de autor spoofeable + writes/deletes Admin-SDK cross-tenant
sin `assertProjectMember` (conv. #3 + #6); (2) el fallback `projectId || 'global'`
siembra nodos en el corpus `vector_store` global del RAG sin gate, vector de
RAG-poisoning entre tenants. Sumado: ninguno escribe `audit_logs` (3🟡). En el
split Gemini hay un patrón sistémico de `JSON.parse` sin try/catch en 6 acciones
whitelisted (conv. #5, 4🟡/6🟡) y una colisión de export `designHazmatStorage`
que deja la versión RAG como dead-code con comportamiento divergente (5🟡).
Doc-drift de LOC de `geminiBackend.ts` (real 1466 vs 2923/2924/3070/2664 en
ARCHITECTURE.md + 4 headers, 7🟡). Los 10 motores Euler, todos los guardrails,
adapters y el server ZK (auth+membership+audit correctos) quedan limpios. La
prioridad de remediación es el par 🔴 de `networkBackend.ts`: inyectar
`req.user.uid` en el dispatcher para estas acciones y exigir membership sobre
`nodeData.projectId` antes de cualquier write Admin-SDK.
