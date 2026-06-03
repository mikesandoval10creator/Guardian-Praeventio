# DEEP-EX-33 — Pasada exhaustiva línea-por-línea (Lote #33)

**Deriva:** `ledger.json` → `category` empieza con `FEAT` && `block === "B14-IA"`,
ordenado por `path`, slice `[165:175]` (los últimos 10 de 175).
**Universo:** 175 archivos `FEAT`/`B14-IA`; este lote cierra el bloque (10
archivos finales — familia Zettelkasten v2: registries de nodos, persistencia,
retrieval resiliente, orquestador riesgo→EPP→training, smart actions).
**Foco:** capa de conocimiento (knowledge graph). Hallazgos NUEVOS (no repite
`DEEP-B14-IA.md` ni `DEEP-EX-30.md` — verificado: cero menciones previas de
`writeNode`/`resilientRetrieval`/`riskOrchestrator`/`smartActions`/registries).

## Atestación 10/10

Los 10 archivos del slice fueron leídos completos línea por línea. Cinco son
catálogos puros de datos (`climateNodeRegistry` 64 LOC, `index` barrel 47 LOC,
`ohsNormativaNodeRegistry` 121 LOC, `personalEppNodeRegistry` 61 LOC,
`physicsNodeRegistry` 57 LOC) + `types.ts` (82 LOC, solo tipos). Cuatro tienen
lógica: `persistence/writeNode.ts` (290), `resilientRetrieval.ts` (344),
`riskOrchestrator.ts` (227), `smartActions.ts` (319). Cruces verificados:
`src/server/routes/zettelkasten.ts` (confirma `verifyAuth` + `assertProjectMember`
+ audit en el endpoint POST — 13 hits), `lib/apiAuth.ts`, `utils/pwa-offline.ts`,
`constants.ts` (`EPP_BY_SECTOR`/`EPP_DEFAULT`). Patrones de riesgo barridos:
`JSON.parse`, `Math.random`, `dangerouslySetInnerHTML`, `apiKey`/`GEMINI`,
prompts diagnósticos, tenantId/role del cliente, fetch sin token, `void audit*`.

## Hallazgos

| # | Sev | Archivo:línea | Hallazgo |
|---|-----|---------------|----------|
| 1 | 🟡 | `src/services/zettelkasten/persistence/writeNode.ts:239,263` | **Pérdida silenciosa de nodos en el debounce.** `debounceKey()` agrupa solo por `${projectId}:${node.type}` y `cur.nodes.set(node.type, node)` deduplica por `node.type`. Si un mismo batch (o ráfaga <2s) trae **dos nodos distintos del mismo `type`** (p.ej. dos `scaffold-uplift` de andamios diferentes con `metadata`/`connections` distintos), el segundo **sobrescribe** al primero y solo uno vuela al servidor. El `idempotencyKey = nodeIdFor(...)` distingue los payloads (hashea metadata+connections), pero el Map del debounce los colapsa **antes** de llegar a `writeNodes`, anulando esa distinción. Para flujos de un único nodo-por-type-por-recálculo (el caso de los sliders Bernoulli) es inocuo, pero es un footgun no documentado: el comentario l.232 dice "último payload gana" sin advertir que asume 1 nodo/type. |
| 2 | 🟡 | `src/services/zettelkasten/resilientRetrieval.ts:130` | **Respuesta vacía autoritativa enmascarada como fallo.** En `trySource`, `if (result.length === 0) return { error: 'empty result', source }`. En el fast-path (l.172-185) esto hace que un source que respondió legítimamente "no hay match" (p.ej. Firestore one-shot que confirma cero nodos para el query) se trate como **error** y se caiga al siguiente source, terminando en el `seed` bundle estático (l.187-193, `degraded:true`). El usuario recibe nodos seed irrelevantes en vez de un "sin resultados" correcto. Distinguir "source caída" de "source respondió vacío" requeriría un sentinel separado; hoy se confunden. |
| 3 | 🔵 | `src/services/zettelkasten/persistence/writeNode.ts:163-164` vs `:27` | **Doble import de `apiAuthHeader`.** Importado estáticamente en l.27 (`import { apiAuthHeader } from '../../../lib/apiAuth'`) y **re-importado dinámicamente** dentro del handler en l.163 (`const { apiAuthHeader } = await import('../../../lib/apiAuth')`), que es el que realmente se usa. El import estático de l.27 queda sin uso (sombra del dinámico). Limpieza menor; sin impacto funcional. |
| 4 | 🔵 | `src/services/zettelkasten/persistence/writeNode.ts:20` | **Import muerto.** `import { auth } from '../../firebase'` nunca se referencia en el archivo (la auth se obtiene vía `apiAuthHeader()`). Dead code. |
| 5 | 🔵 | `src/services/zettelkasten/families/ohsNormativaNodeRegistry.ts:15` | **Drift de taxonomía DS 40 vs DS 44/2024.** El nodo tiene `id:'norma-DS-40'`, `source:'DS-40'` pero `title:'DS 44/2024 — Reglamento sobre prevencion de riesgos'`. CLAUDE.md fija el compliance target en "DS 44/2024" (deroga el antiguo DS 40). Los IDs derivados (l.72-73 `norma-DS-40-Art-14`, `norma-DS-40-Art-21`) heredan el slug legacy. Es coherente internamente pero el slug `DS-40` puede confundir joins con fuentes que usen `DS-44`. Catálogo puro, sin riesgo de runtime — solo deuda de nomenclatura. |
| 6 | 🔵 | `src/services/zettelkasten/riskOrchestrator.ts:105,119` | **Citas normativas imprecisas en `rationale`.** El comentario/`rationale` de la regla eléctrica cita "DS 109" (l.105) y la de hazmat cita "DS 78" (l.119, 123) como reglamentos de sustancias peligrosas; el cuerpo canónico de almacenamiento de sustancias peligrosas en el resto del repo es **DS 43** (cf. `ohsNormativaNodeRegistry.ts:20`). Estos textos llegan a la UI de "explicabilidad de recomendaciones", así que una cita errada es user-facing copy incorrecta (no bloqueante, pero contradice la regla de exactitud normativa). Verificar contra `src/data/normativa/`. |

## Limpios (sin hallazgos)

- **`families/climateNodeRegistry.ts`** — 50 nodos de datos puros + `interface
  FamilyNodeSpec`. `readonly`/`as const`. Sin lógica, sin IO, sin IDs aleatorios.
- **`families/index.ts`** — barrel agregador de los 8 registries. Imports/exports
  consistentes con los nombres exportados (`CLIMATE_NODES`…`AI_ANALYTICS_NODES`);
  `TOTAL_NODE_COUNT` derivado de `flatMap`. Limpio.
- **`families/personalEppNodeRegistry.ts`** — 50 filas vía helper `ROW(...)`
  puro. Datos. Sin hallazgos.
- **`families/physicsNodeRegistry.ts`** — 15 casos × 4 sufijos = 60 nodos
  generados determinísticamente (`buildPhysicsNodes`). Pura construcción de
  taxonomía, sin side effects.
- **`types.ts`** — solo tipos/uniones discriminadas (`RiskNodeType`,
  `RiskNodePayload`…). Sin runtime.
- **`riskOrchestrator.ts`** (núcleo) — **PURO** según contrato (no escribe
  Firestore, devuelve `EdgeSuggestion[]`; el caller persiste). Reglas
  determinísticas (regex sobre `riskType` normalizado NFD), sin LLM, sin
  `Math.random`. Solo el #6 (copy normativa) como nit.
- **`smartActions.ts`** — 5 detectores determinísticos (no LLM, header l.18 lo
  declara). Output es **dry-run** (`proposedMutations`, "nunca auto-aplicar",
  l.19/44). IDs estables `kind-${nodeId}-${idx}` (no aleatorios). Sin auth/audit
  porque no muta nada (puro analizador de snapshot). Limpio.
- **`writeNode.ts`** (resto) — `nodeIdFor` usa `crypto.subtle` SHA-256 y
  **rechaza** caer a RNG si subtle no está (l.99-101) → idempotencia preservada,
  no viola conv. #15. La auth/audit/tenant-isolation viven correctamente en el
  endpoint server (`src/server/routes/zettelkasten.ts`: `verifyAuth` +
  `assertProjectMember`); este cliente delega bien y nunca confía en identidad
  del body. Offline-queue vía `saveForSync`. `analytics.track` fire-and-forget
  con try/catch. Solo #1/#3/#4 como nits.
- **`resilientRetrieval.ts`** (resto) — fallback chain memory→idb→firestore→seed
  con timeout por source y captura de errores; `SEED_NODES` es `Object.freeze`
  de datos de emergencia (números 131/132/133, RCP, SOS). Sin red propia (todo
  inyectado por el caller). Solo #2 como nit semántico.

## Resumen

Lote final del bloque B14-IA (10/10 leídos, cierra los 175 archivos). Capa
Zettelkasten v2: ningún hallazgo 🔴. **Cero** acciones Gemini, **cero** prompts
diagnósticos, **cero** `JSON.parse` sin guard, **cero** `Math.random` en IDs,
**cero** tenantId/role tomados del cliente — la familia es deliberadamente
pura-datos + lógica determinística, con auth/audit/aislamiento de tenant
correctamente delegados al endpoint server (`zettelkasten.ts`, ya cubierto con
`verifyAuth`+`assertProjectMember`). Dos 🟡 son bugs de robustez no de seguridad:
(#1) el debounce de `writeNode` deduplica por `type` y puede tragarse nodos
distintos del mismo tipo en una ráfaga; (#2) `resilientRetrieval` confunde
"respuesta vacía autoritativa" con "fallo" y degrada a seed innecesariamente.
Los cuatro 🔵 son limpieza (import muerto, doble import, slug `DS-40` vs DS
44/2024, citas normativas `DS-78/109` vs `DS-43`). Doc-only, sin commit.
