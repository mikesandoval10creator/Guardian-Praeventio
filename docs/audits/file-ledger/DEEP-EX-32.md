# DEEP-EX-32 — Pasada exhaustiva línea-por-línea (Lote #32)

**Deriva:** `ledger.json` → `category` empieza con `FEAT` && `block === "B14-IA"`,
ordenado por `path`, slice `[110:165]`.
**Universo:** 175 archivos `FEAT`/`B14-IA`; este lote cubre `[110:164]` (55 archivos
— el slice `[110:165]` rinde 55 entradas porque 164 es el último índice).
**Foco:** RAG server-side, runtime/loader/integrity SLM, cripto KEK/HMAC, worker
proxies ONNX, zettelkasten (edges/canonical/bernoulli). Hallazgos NUEVOS — no
repite `DEEP-B14-IA.md` (que ya catalogó loader/onnxAdapter/coexistencia-dos-
runtimes/`tinyllama` fuera de registry) ni `DEEP-EX-30.md` (medicalAnalysisBackend
ADR-0012, wisdomCapsule, consolidateZettelkasten, voice Math.random).

## Atestación 55/55

Los 55 archivos del slice fueron leídos. Núcleo de riesgo
(`safeNormativeQuery.ts`, `ragService.ts`, `slmRuntime.ts`, `loader.ts`,
`slmAdapter.ts`, `onnxAdapter.ts`, `slmWorker.ts`, `slmIntegrityCheck/Guard.ts`,
`registry.ts`, `hmac.ts`, `kekRotationOrchestrator.ts`, `encryptedOfflineQueue.ts`,
`guardianOffline.ts`, `orchestrator.ts`, `edgeStoreFirestore.ts`,
`materializer.ts`) leído completo línea-por-línea; el resto (bernoulli físicos,
zettelkasten puros, worker protocol/proxy, tokenizer, sampling, types, reconciliation)
leído íntegro o escaneado exhaustivamente por patrón de riesgo (`Math.random`,
`JSON.parse`, `InferenceSession.create`, `expectedSha`, `apiKey`/`GEMINI_API_KEY`,
`fetch(`, `dangerouslySetInnerHTML`, `addDoc`/`.set(`, `tenantId`/`req.user`,
prompts diagnósticos). Cruces verificados con `firestore.rules`
(`vector_store`, `community_glossary`, `tenants/{tid}/zettelkasten_edges`,
`zettelkasten_nodes`), consumidores reales (`SLMProvider.tsx`, `AsesorChat.tsx`,
`AppProviders.tsx`), y los hallazgos previos de `DEEP-B14-IA.md`.

## Hallazgos

| # | Sev | Archivo:línea | Hallazgo |
|---|-----|---------------|----------|
| 1 | 🔴 | `src/services/slm/loader.ts:55-147` + `slmAdapter.ts:22,118,124` → `worker/slmWorker.ts:224-240` | **Bypass de integrity SHA-256 en la ruta SLM viva (asimetría supply-chain).** Existen DOS familias de carga de modelos. La moderna (`slmRuntime.ts`, Sprint 47/54) es *integrity-first*: `assertModelIntegrity`/`verifyBundleIntegrity` + `assertVerifiableInProduction` (fail-closed sin hash en prod) ANTES de `ort.InferenceSession.create`. La vieja —`slmAdapter.ts` (consumida por `components/slm/SLMProvider.tsx`)— hace `loadModel(model,…)` de `loader.ts`, que descarga `fetch(model.url)` (HuggingFace CDN, l.89), cachea en IndexedDB y devuelve bytes **sin computar ni comparar `expectedSha256`**. Esos bytes llegan a `slmWorker.init → InferenceSession.create` (`slmWorker.ts:237`) sin ninguna verificación. `DEEP-B14-IA.md` ya catalogó loader/onnxAdapter pero enmarcado en "coexisten dos runtimes / tinyllama fuera de registry"; el ángulo NUEVO es que la ruta `SLMProvider→slmAdapter→loader→slmWorker` ejecuta pesos de un CDN externo **sin el integrity guard que el módulo hermano sí aplica** — exactamente el control que `registry.ts`/`slmIntegrityGuard.ts` fueron construidos para garantizar (riesgo de modelo comprometido/MITM/cache poisoning en faena minera con red corporativa). |
| 2 | 🟡 | `src/services/slm/onnxAdapter.ts:544-561` (`fetchOrLoadCached`) | **Segundo cargador sin integrity (riesgo menor — same-origin).** `OnnxSlmAdapter` (consumido por `AsesorChat.tsx`, `AppProviders.tsx`, `useSlmOffline.ts`) fetchea `this.modelUrl` (default `/models/slm/tinyllama-1.1b-q4.onnx`, same-origin) y lo pasa a `InferenceSession.create` (`:329`) sin `expectedSha256`. `modelUrl` es overrideable vía config (`:88,257`), así que un caller podría apuntarlo fuera de origen. Severidad menor que #1 porque el default es asset propio del bundle, pero rompe la invariante "todo load pasa por integrity" de §2.9 que `slmRuntime.ts` documenta como contrato C.9. |
| 3 | 🟡 | `src/services/ragService.ts:223-271` (`queryCommunityKnowledge`) | **Cache de salida Gemini persistida como "conocimiento comunitario" sin audit ni validación (RAG self-poisoning + write sin audit_logs #3).** En cache-miss el server llama `geminiFallback()` y persiste la respuesta cruda del LLM en `community_glossary` vía **Admin SDK** (`glossaryCollection.add`, l.257), keyed por `industry`+embedding, para servirla textualmente en hits futuros (`results.docs[0].data().response`, l.249). (a) Ninguna escritura de estado escribe `audit_logs` (conv. #3). (b) `firestore.rules:604` restringe writes de cliente a admin/supervisor, pero el Admin SDK bypasea reglas: una alucinación de Gemini queda cacheada y se re-sirve a otros usuarios de la misma industria como respuesta autoritativa, sin el guardrail de score mínimo que `safeNormativeQuery.ts` (este mismo lote) implementó precisamente para evitar texto normativo inventado. Cache envenenable indirectamente vía cualquier prompt que llegue a Gemini. |
| 4 | 🟡 | `src/services/ragService.ts:186-217` (`searchRelevantContext`) | **Fallback hardcoded que `safeNormativeQuery.ts` fue creado para eliminar — todavía en uso.** Cuando el RAG no está inicializado, `searchRelevantContext` retorna el string fijo `"Contexto legal: Ley 16.744…"` (l.189) y ante error `"Error al recuperar contexto legal."` (l.215). El módulo hermano `rag/safeNormativeQuery.ts` documenta en su cabecera (l.3-7) que ese fallback "permite que el modelo invente texto que luego cita como autoridad" y existe para reemplazarlo con `{ ok:false, reason:'rag_not_ready' }`. Doc-vs-código/migración incompleta: si los callers de `/ask-guardian` aún usan `searchRelevantContext` en vez de `safeNormativeQuery`, el riesgo de alucinación normativa sigue abierto. Verificar qué consume cada uno. |
| 5 | 🔵 | `src/services/slm/registry.ts:101-121` (`gemma-2-2b`) | **Modelo gated con `expectedSha256: null` — mitigado, se documenta para descartar.** Gemma queda con hash `null` porque el repo HF es gated. Es correcto y fail-closed: `slmRuntime.assertVerifiableInProduction` rechaza el load en prod sin hash, y `listModelsWithVerifiedHash()` lo excluye. Sin acción — anotado para que no se confunda con #1: por la ruta `slmRuntime` Gemma es seguro; el problema de #1 es la ruta `loader`/`slmAdapter` que NO consulta ese hash para NINGÚN modelo. |
| 6 | 🔵 | `src/services/slm/worker/slmRuntimeWorkerCore.ts:80`, `slmRuntimeWorkerProtocol.ts:202`, `slm/sampling.ts:135`, `kekRotationOrchestrator.ts:153` | **`Math.random()` — todos dentro de la excepción de conv. #15, se documentan.** `newModelHandle` (handle efímero in-memory del worker, Map key, NO persistido a Firestore), `requestId` del protocolo worker (correlación in-flight), RNG de nucleus sampling (estocástico por diseño, inyectable para tests), y el lock id inter-tab de KEK rotation (no-secreto, ya razonado en su comentario l.137-156). Ninguno es server-side ni ID persistido. `reconciliationAutoTrigger.ts:194-198` usa `crypto.randomUUID` con fallback `Math.random` SOLO si no hay crypto — correcto. Sin acción. |
| 7 | 🔵 | `src/services/slm/slmIntegrityCheck.ts:1-86` (cabecera) | **Mojibake en comentarios (cosmético).** El header tiene UTF-8 corrupto (`â†’`, `âœ…`, `âŒ`, box-drawing roto) por re-encoding. No afecta runtime (solo comentarios) pero degrada legibilidad de un módulo de seguridad. Limpieza recomendada. |

## Limpios (sin hallazgos)

- **`rag/safeNormativeQuery.ts`** — guardrail anti-alucinación ejemplar:
  threshold COSINE 0.75, fail-closed (`rag_not_ready`/`no_verified_match`/
  `query_too_short`) con `userMessage` canónico, deps inyectables, sin fallback
  hardcoded. Es el patrón correcto que #3/#4 deberían adoptar.
- **`slmRuntime.ts`** (1032 LOC) — integrity-first, fail-closed §2.9
  (`SlmUnverifiedModelError` en prod sin hash), cache-first con re-verificación
  contra bytes cacheados, `externalData` para modelos split, AbortSignal +
  timeout, `release()` anti-leak iOS. Sólido.
- **`slmIntegrityGuard.ts` / `slmIntegrityCheck.ts`** — dual policy (graceful
  staging) + strict (throw). SHA-256 Web Crypto, fail-closed prod, bundle-wide
  verify. `registry.ts` con SHA-256 reales pineados desde HF LFS oid + companions.
- **`hmac.ts`** — HMAC-SHA256 per-session, key en `sessionStorage` (no
  localStorage/IndexedDB), threat model TM-T03 explícito, `subtle.verify`
  constant-time, base64url, length-check anticipado. Limpio.
- **`kekRotationOrchestrator.ts`** — rewrap de envelopes (no re-encripta payload),
  lock inter-tab con TTL + verify, idempotencia por detección de decrypt-con-newKek,
  progreso. DEKs reales viven en kmsEnvelope/node:crypto (no acá).
- **`encryptedOfflineQueue.ts`** — `JSON.parse(plaintext)` (l.404) en try/catch →
  `BAD_RECORD`; decrypt en try/catch → tamper signal. Cliente, IndexedDB cifrado.
- **`guardianOffline.ts`** — RAG offline de emergencia: corpus same-origin estático,
  FAQ Jaccard, `buildAugmentedPrompt` solo con prompt-del-usuario + chunks, system
  prompt fijo, cache por hash local. Sin inyección de contenido externo no confiable.
- **`orchestrator.ts` (slm)** — `callOnlineBackend` con `apiAuthHeaders()`
  (Bearer/E2E), fallback a SLM en 4xx/5xx, parse defensivo de `{response|answer}`.
- **`orchestratorService.ts`** — clima/sísmico vía OpenWeather/USGS (cliente);
  Round 17/18 honest-empty-state (null en vez de telemetría ficticia). `nodeSeedService.ts`
  — seeds cliente a `nodes` (rules-governed). `researchMode/researchMode.ts` — causa
  raíz determinística (5-porqués/Ishikawa/Jaccard), sin LLM, sin I/O.
- **`physics/bernoulliEngine.ts` + `zettelkasten/bernoulli/*` (13 nodos)** — motores
  físicos puros (HVAC, dique, dispersión gas, hidrante, venturi minero, viento, etc.),
  sin fetch/random/persistencia/prompts. Pure functions deterministas.
- **`zettelkasten/{backlinks,centrality,contextualActions,edges,canonical/materializer}.ts`**
  — grafo puro + data-access. `edgeStoreFirestore.ts` escribe a
  `tenants/{tid}/zettelkasten_edges` vía Admin SDK; `firestore.rules:958-963`
  lo gobierna (read=miembro del tenant, create/update/delete=false server-only).
  `tenantId` es parámetro de servicio — la autorización vs token es responsabilidad
  del route layer (`server/routes/zettelkasten.ts` et al.), fuera de scope de estos
  servicios puros. `materializer.ts` construye claves `nodes/{tid}_{pid}_{zk}` sin
  random.
- **`cache/modelCache.ts`, `index.ts`, `tokenizer.ts`, `types.ts`, `sampling.ts`,
  `reconciliation.ts`, `reconciliationRunner.ts`, `reconciliationAutoTrigger.ts`,
  `offlineQueue.ts`, `worker/{slmWorker,slmRuntimeWorker,slmRuntimeWorkerCore,
  slmRuntimeWorkerProtocol,slmRuntimeWorkerProxy,createSlmRuntimeProxyForBrowser}.ts,
  workerProxy.ts`** — infraestructura SLM cliente; el worker core mapea
  `'integrity check failed'`/`SHA-256`/`SlmIntegrityError` → `integrity_failure`
  (la ruta `slmRuntime` SÍ propaga integridad). Sin riesgo de servidor/auth.

## Resumen

Cubiertos los 55 archivos del slice `FEAT`/`B14-IA[110:164]`. El núcleo de
seguridad nuevo de este lote es maduro: `safeNormativeQuery.ts` (guardrail
anti-alucinación con threshold y fail-closed), `slmRuntime.ts`/`slmIntegrityGuard.ts`
(integrity-first, fail-closed en prod), `hmac.ts` y `kekRotationOrchestrator.ts`
(cripto bien razonada). Hallazgo principal **🔴**: existe una **asimetría de
integridad** — la ruta SLM viva `SLMProvider→slmAdapter→loader.ts→slmWorker`
descarga pesos de HuggingFace CDN y los ejecuta en `InferenceSession.create`
**sin** computar/comparar `expectedSha256`, mientras el módulo hermano
`slmRuntime.ts` aplica ese guard rigurosamente; `loader.ts` y `onnxAdapter.ts`
fueron catalogados en `DEEP-B14-IA.md` pero por otra razón (consolidación /
`tinyllama` fuera de registry), no por el bypass de verificación. Acompañan tres
**🟡**: `ragService.queryCommunityKnowledge` cachea salidas crudas de Gemini en
`community_glossary` (Admin SDK, sin audit, re-servidas como autoritativas →
self-poisoning) y `searchRelevantContext` aún devuelve el fallback hardcoded
"Ley 16.744…" que `safeNormativeQuery` fue creado para erradicar (migración
incompleta), más el segundo cargador `onnxAdapter` sin integrity (riesgo menor,
same-origin). Los `Math.random()` detectados caen todos dentro de la excepción
de conv. #15 (handles efímeros de worker, sampling estocástico, lock no-secreto).
Sin prompt-injection, sin acciones Gemini no-whitelisted, sin `JSON.parse` server
sin try/catch, ni colecciones cliente sin regla en este lote.
