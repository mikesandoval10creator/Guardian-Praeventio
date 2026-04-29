# Gemini Backend split plan — R21 B3 scope discovery

> **Status:** scope-discovery only. R21 produces this inventory; **R22+** executes the
> actual split.
>
> **Source-of-truth file:** `src/services/geminiBackend.ts` (HEAD `377150a`, **2701 LOC**,
> not 2666 — the README/ARCHITECTURE.md figure is stale by 35 lines).
>
> **Goal of split:** carve `geminiBackend.ts` into ~12 domain modules under
> `src/services/gemini/`, keep `geminiBackend.ts` as a thin barrel for backward
> compatibility, and unblock the R18+ AUDIT.md item ("god-file refactor").

---

## 1. Current state

| Metric | Value | Note |
|---|---|---|
| File | `src/services/geminiBackend.ts:1-2701` | |
| LOC | **2701** | `wc -l` on HEAD `377150a` |
| Direct exports | **60** | `export const` / `export async function` only — counted via grep at lines 31, 55, 100, 142, 176, 226, 282, 322, 349, 400, 449, 495, 533, 583, 620, 677, 711, 768, 815, 850, 898, 914, 958, 980, 1014, 1056, 1088, 1120, 1185, 1230, 1258, 1286, 1330, 1358, 1404, 1446, 1513, 1547, 1616, 1661, 1690, 1734, 1781, 1814, 1867, 1973, 2052, 2089, 2137, 2194, 2251, 2283, 2317, 2356, 2398, 2449, 2491, 2529, 2581, 2617, 2653 |
| Barrel re-exports | **12** | `export * from './X.js'` at lines 2688-2700 (susesoBackend, eppBackend, comiteBackend, medicineBackend, predictionBackend, legalBackend, chemicalBackend, psychosocialBackend, shiftBackend, trainingBackend, inventoryBackend, networkBackend) |
| Surface (allowlist) | **84 actions** | `src/server/routes/gemini.ts:26-111` `ALLOWED_GEMINI_ACTIONS` — 60 own + 24 from re-exported sibling modules |
| Module-level helpers | 3 | `API_KEY` (L6), `sleep` (L8), `withExponentialBackoff` (L10-29) |
| Imports of `geminiBackend.ts` | 2 static + 1 dynamic | Static: `networkBackend.ts:3`, `safetyEngineBackend.ts:3`. Dynamic: `src/server/routes/gemini.ts:202` (`await import('../../services/geminiBackend.js')`), `src/server/routes/misc.ts:142` (scanLegalUpdates) |
| Tests directly mocking `geminiBackend` | 1 | `src/services/networkBackend.test.ts:131` — `vi.mock('./geminiBackend', ...)` stubs `autoConnectNodes` |

> **Stale documentation note:** `ARCHITECTURE.md:110` says "2666 LOC". Actual is 2701.
> `ARCHITECTURE.md:272` says "exporta ~85 funciones". Actual: 60 direct + 12 barrel
> re-exports = 72; `ALLOWED_GEMINI_ACTIONS` whitelist contains 84 entries because
> sibling modules (eppBackend, etc.) contribute additional actions through the
> barrel.
>
> **R21 prompt note:** the prompt also said "2666 LOC, 75 exports". Both figures are
> stale. The split plan below uses the actual counts.

### Models referenced (for `_shared.ts` candidate constants)
- `gemini-3-flash-preview` (37 occurrences) — fast classification / generation
- `gemini-3.1-pro-preview` (12 occurrences) — heavy reasoning / vision
- `gemini-3.1-flash-preview` (2 occurrences) — `analyzeFaenaRiskWithAI`, `extractAcademicSummary`
- `gemini-3.1-flash-image-preview` (1) — `analyzeBioImage`
- `gemini-2.5-flash-preview-tts` (1) — TTS in `processAudioWithAI`
- `gemini-2.0-flash` (2) — `scanLegalUpdates`, `getNutritionSuggestion`
- `text-embedding-004` (2) — `generateEmbeddingsBatch`, `semanticSearch`

---

## 2. Function inventory (60 direct exports)

| # | Name | Lines | Domain (target module) | External consumers | Deps inside file | Has tests? |
|---|---|---|---|---|---|---|
| 1  | `generateEmbeddingsBatch` | 31-53 | embeddings | `gemini.ts` allowlist L27 | `withExponentialBackoff` | N |
| 2  | `autoConnectNodes` | 55-98 | classify (graph) | `networkBackend.ts:3`, `gemini.ts` L28 | – | Y (mocked in `networkBackend.test.ts:131`) |
| 3  | `semanticSearch` | 100-140 | embeddings (semantic) | `gemini.ts` L29 | – (uses `text-embedding-004`) | N |
| 4  | `analyzeFastCheck` | 142-174 | classify | `gemini.ts` L30 | – | N |
| 5  | `predictGlobalIncidents` | 176-224 | recommendations (predict) | `gemini.ts` L31 | – | N |
| 6  | `analyzeRiskWithAI` | 226-280 | classify (IPER) | `gemini.ts` L32 | `queryCommunityKnowledge` (rag) | N |
| 7  | `analyzePostureWithAI` | 282-320 | ergonomic / vision | `gemini.ts` L33 | – | N |
| 8  | `generateEmergencyPlan` | 322-347 | evacuation | `gemini.ts` L34 | – | N |
| 9  | `analyzeSafetyImage` | 349-398 | vision | `gemini.ts` L35 | – | N |
| 10 | `generateISOAuditChecklist` | 400-447 | compliance | `gemini.ts` L36 | – | N |
| 11 | `generatePTS` | 449-493 | pts | `gemini.ts` L37 | – | N |
| 12 | `generatePTSWithManufacturerData` | 495-531 | pts | `gemini.ts` L38 | – (uses `googleSearch` tool) | N |
| 13 | `generateEmergencyScenario` | 533-581 | evacuation | `gemini.ts` L39 | – | N |
| 14 | `generateRealisticIoTEvent` | 583-618 | recommendations (iot) | `gemini.ts` L40 | – | N |
| 15 | `processDocumentToNodes` | 620-675 | vision (multimodal) | `gemini.ts` L41 | `withExponentialBackoff` | N |
| 16 | `simulateRiskPropagation` | 677-709 | recommendations | `gemini.ts` L42 | – | N |
| 17 | `enrichNodeData` | 711-766 | classify (graph) | `gemini.ts` L43 | – | N |
| 18 | `analyzeRootCauses` | 768-811 | recommendations | `gemini.ts` L44 | – | N |
| 19 | `queryBCN` | 815-848 | bcn-rag | `gemini.ts` L45 | `searchRelevantContext` | N |
| 20 | `getChatResponse` | 850-896 | chat | `gemini.ts` L46 | `searchRelevantContext` | N |
| 21 | `getSafetyAdvice` | 898-912 | recommendations | `gemini.ts` L47 | – | N |
| 22 | `generateActionPlan` | 914-956 | recommendations | `gemini.ts` L48 | – | N |
| 23 | `generateSafetyReport` | 958-978 | pts | `gemini.ts` L49 | – | N |
| 24 | `auditAISuggestion` | 980-1012 | compliance | `gemini.ts` L50 | – | N |
| 25 | `generatePersonalizedSafetyPlan` | 1014-1054 | recommendations | `gemini.ts` L51 | `searchRelevantContext` | N |
| 26 | `analyzeDocumentCompliance` | 1056-1086 | compliance | `gemini.ts` L52 | – | N |
| 27 | `generateTrainingRecommendations` | 1088-1118 | recommendations | `gemini.ts` L53 | – | N |
| 28 | `investigateIncidentWithAI` | 1120-1183 | recommendations (incidents) | `gemini.ts` L54 | `searchRelevantContext` | N |
| 29 | `auditProjectComplianceWithAI` | 1185-1228 | compliance | `gemini.ts` L55 | – | N |
| 30 | `analyzeAttendancePatterns` | 1230-1256 | recommendations | `gemini.ts` L56 | – | N |
| 31 | `generateSafetyCapsule` | 1258-1284 | recommendations | `gemini.ts` L57 | – | N |
| 32 | `suggestRisksWithAI` | 1286-1328 | classify (IPER) | `gemini.ts` L58 | – | N |
| 33 | `suggestNormativesWithAI` | 1330-1356 | bcn-rag | `gemini.ts` L59 | – | N |
| 34 | `generateCompensatoryExercises` | 1358-1402 | ergonomic | `gemini.ts` L60 | – | N |
| 35 | `analyzeBioImage` | 1404-1444 | vision | `gemini.ts` L61 | – (uses `gemini-3.1-flash-image-preview`) | N |
| 36 | `generatePredictiveForecast` | 1446-1511 | recommendations | `gemini.ts` L62 | – | N |
| 37 | `generateOperationalTasks` | 1513-1545 | compliance | `gemini.ts` L63 | – | N |
| 38 | `generateEmergencyPlanJSON` | 1547-1614 | evacuation | `gemini.ts` L64 | – | N |
| 39 | `forecastSafetyEvents` | 1616-1659 | recommendations | `gemini.ts` L65 | – | N |
| 40 | `analyzeRiskNetwork` | 1661-1688 | classify (graph) | `gemini.ts` L66 | – | N |
| 41 | `predictAccidents` | 1690-1732 | recommendations | `gemini.ts` L67 | – | N |
| 42 | `analyzeSiteMapDensity` | 1734-1779 | recommendations | `gemini.ts` L68 | – | N |
| 43 | `generateTrainingQuiz` | 1781-1812 | recommendations | `gemini.ts` L69 | – | N |
| 44 | `validateRiskImageClick` | 1814-1865 | vision | `gemini.ts` L70 | – | N |
| 45 | `calculateDynamicEvacuationRoute` | 1867-1971 | evacuation | `gemini.ts` L71 | `calculateDeterministicSafeRoute` (routingBackend) | N |
| 46 | `processAudioWithAI` | 1973-2050 | audio | `gemini.ts` L72 | – (uses `gemini-2.5-flash-preview-tts`, `FunctionDeclaration`) | N |
| 47 | `analyzeVisionImage` | 2052-2087 | vision | `gemini.ts` L73 | – | N |
| 48 | `verifyEPPWithAI` | 2089-2135 | vision (EPP) | `gemini.ts` L74 | – | N |
| 49 | `analyzeRiskNetworkHealth` | 2137-2192 | classify (graph) | `gemini.ts` L75 | – | N |
| 50 | `analyzeFeedPostForRiskNetwork` | 2194-2247 | classify (graph) | `gemini.ts` L76 | – | N |
| 51 | `calculateStructuralLoad` | 2251-2281 | engineering | `gemini.ts` L77 | – | N |
| 52 | `designHazmatStorage` | 2283-2315 | engineering | `gemini.ts` L78 | – | N |
| 53 | `evaluateMinsalCompliance` | 2317-2354 | compliance | `gemini.ts` L79 | `searchRelevantContext` | N |
| 54 | `generateModuleRecommendations` | 2356-2396 | recommendations | `gemini.ts` L80 | – | N |
| 55 | `generateExecutiveSummary` | 2398-2447 | recommendations | `gemini.ts` L81 | – | N |
| 56 | `analyzeFaenaRiskWithAI` | 2449-2489 | classify (IPER) | `gemini.ts` L82 | `searchRelevantContext` | N |
| 57 | `extractAcademicSummary` | 2491-2527 | recommendations (research) | `gemini.ts` L83 | – | N |
| 58 | `calculateComplianceSummary` | 2529-2579 | compliance | `safetyEngineBackend.ts:3`, `gemini.ts` L84 | – | N |
| 59 | `processGlobalSafetyAudit` | 2581-2615 | compliance | `safetyEngineBackend.ts:3`, `gemini.ts` L85 | – | N |
| 60 | `scanLegalUpdates` | 2617-2651 | compliance | `misc.ts:147`, `gemini.ts` L86 | – | N |
| 61 | `getNutritionSuggestion` | 2653-2686 | recommendations (health) | `gemini.ts` L87 | – | N |

> **Tests = 0 direct unit tests** for `geminiBackend.ts`. The only existing
> coverage is via mocks at `networkBackend.test.ts:131` (stubbing
> `autoConnectNodes`). All other functions are integration-tested implicitly
> through the `/api/gemini` proxy — no dedicated test file exists. **AUDIT.md
> tracks this as the #1 testing gap for the file.** The split is the perfect
> opportunity to add per-module test files.

### Re-exported sibling modules (lines 2688-2700)

| Line | Module | Notes |
|---|---|---|
| 2688 | `./susesoBackend.js` | Stays — only re-export |
| 2689 | `./eppBackend.js` | Stays — only re-export |
| 2690 | `./comiteBackend.js` | Stays — only re-export |
| 2691 | `./medicineBackend.js` | Stays — only re-export |
| 2692 | `./predictionBackend.js` | Stays — only re-export |
| 2693 | `./legalBackend.js` | Stays — only re-export |
| 2694 | `./chemicalBackend.js` | Stays — only re-export |
| 2695 | `./psychosocialBackend.js` | Stays — only re-export |
| 2696 | `./shiftBackend.js` | Stays — only re-export |
| 2697 | `./trainingBackend.js` | Stays — only re-export |
| 2698 | `./inventoryBackend.js` | Stays — only re-export |
| 2699 | `./networkBackend.js` | **Cycle risk** — `networkBackend.ts:3` imports `autoConnectNodes` from `geminiBackend`, and `geminiBackend.ts:2699` re-exports `networkBackend.js`. Today this works because `autoConnectNodes` is defined inline. **After R22 the cycle must be broken** by having `networkBackend.ts` import from `./gemini/classify.js` (or a smaller `gemini/graph.ts`) instead of the barrel. |

---

## 3. Module assignment

Target directory: `src/services/gemini/`. The R21 prompt mandates 12 domain modules
+ `index.ts` barrel + `_shared.ts`.

| Module | Functions (count) | LOC est. | Shared deps |
|---|---|---|---|
| `embeddings.ts` | `generateEmbeddingsBatch`, `semanticSearch` (2) | ~120 | `withExponentialBackoff` (shared), `text-embedding-004` model id (shared) |
| `classify.ts` | `analyzeFastCheck`, `analyzeRiskWithAI`, `suggestRisksWithAI`, `analyzeFaenaRiskWithAI`, `autoConnectNodes`, `enrichNodeData`, `analyzeRiskNetwork`, `analyzeRiskNetworkHealth`, `analyzeFeedPostForRiskNetwork` (9) | ~440 | `searchRelevantContext`, `queryCommunityKnowledge` (rag) |
| `vision.ts` | `analyzeSafetyImage`, `processDocumentToNodes`, `analyzeBioImage`, `validateRiskImageClick`, `analyzeVisionImage`, `verifyEPPWithAI` (6) | ~290 | `withExponentialBackoff`, image base64 cleanup helper (extract to `_shared`) |
| `audio.ts` | `processAudioWithAI` (1) | ~80 | `FunctionDeclaration` (sdk type), TTS model id |
| `pts.ts` | `generatePTS`, `generatePTSWithManufacturerData`, `generateSafetyReport` (3) | ~140 | – |
| `evacuation.ts` | `generateEmergencyPlan`, `generateEmergencyScenario`, `generateEmergencyPlanJSON`, `calculateDynamicEvacuationRoute` (4) | ~250 | `calculateDeterministicSafeRoute` (routingBackend) |
| `bcn-rag.ts` | `queryBCN`, `suggestNormativesWithAI` (2) | ~80 | `searchRelevantContext` |
| `compliance.ts` | `generateISOAuditChecklist`, `auditAISuggestion`, `analyzeDocumentCompliance`, `auditProjectComplianceWithAI`, `generateOperationalTasks`, `evaluateMinsalCompliance`, `calculateComplianceSummary`, `processGlobalSafetyAudit`, `scanLegalUpdates` (9) | ~400 | `searchRelevantContext` |
| `engineering.ts` | `calculateStructuralLoad`, `designHazmatStorage` (2) | ~80 | – |
| `chat.ts` | `getChatResponse` (1) | ~60 | `searchRelevantContext` |
| `recommendations.ts` | `predictGlobalIncidents`, `simulateRiskPropagation`, `analyzeRootCauses`, `getSafetyAdvice`, `generateActionPlan`, `generatePersonalizedSafetyPlan`, `generateTrainingRecommendations`, `investigateIncidentWithAI`, `analyzeAttendancePatterns`, `generateSafetyCapsule`, `generatePredictiveForecast`, `forecastSafetyEvents`, `predictAccidents`, `analyzeSiteMapDensity`, `generateTrainingQuiz`, `generateRealisticIoTEvent`, `generateModuleRecommendations`, `generateExecutiveSummary`, `extractAcademicSummary`, `getNutritionSuggestion` (20) | ~860 (over budget — see note) | `searchRelevantContext` |
| `ergonomic.ts` | `analyzePostureWithAI`, `generateCompensatoryExercises` (2) | ~90 | – |
| **`_shared.ts`** | `sleep`, `withExponentialBackoff`, `getApiKey()`, `getAi()`, model-id constants, base64 cleanup | ~60 | – |
| **`index.ts`** | barrel re-exporting all 12 modules + sibling backends | ~30 | – |
| **Total** | 60 direct + 12 sibling re-exports | ~2980 | – |

> **`recommendations.ts` is over the 150-300 LOC budget.** With 20 functions
> averaging ~43 LOC each, the file ends up ~860 LOC. Two options for R22:
>
> 1. **Sub-split `recommendations.ts` into 3 sub-modules** (recommended):
>    - `recommendations/predict.ts` — `predictGlobalIncidents`, `forecastSafetyEvents`, `predictAccidents`, `generatePredictiveForecast`, `analyzeSiteMapDensity` (5)
>    - `recommendations/incidents.ts` — `simulateRiskPropagation`, `analyzeRootCauses`, `investigateIncidentWithAI`, `generateActionPlan` (4)
>    - `recommendations/personal.ts` — the rest (11): `getSafetyAdvice`, `generatePersonalizedSafetyPlan`, `generateTrainingRecommendations`, `analyzeAttendancePatterns`, `generateSafetyCapsule`, `generateTrainingQuiz`, `generateRealisticIoTEvent`, `generateModuleRecommendations`, `generateExecutiveSummary`, `extractAcademicSummary`, `getNutritionSuggestion`
> 2. **Accept the size and ship as a single file** — it's still a >3× LOC reduction
>    vs the parent god-file, and per-function complexity is low.
>
> Recommendation: **option 1**. Sub-split costs nothing extra in R22 (same
> mechanical move) and lands every file in the 150-300 LOC band.

---

## 4. Shared internals (`_shared.ts`)

Functions/values currently used by 2+ exports:

| Symbol | Definition | Used by | Action |
|---|---|---|---|
| `API_KEY` (const) | L6 | every exported function | Replace with `getApiKey()` getter (allows test-time override + env-late-binding); export from `_shared.ts` |
| `sleep` (fn) | L8 | `withExponentialBackoff` | Move to `_shared.ts` (private) |
| `withExponentialBackoff` (fn) | L10-29 | `generateEmbeddingsBatch` (L40), `processDocumentToNodes` (L636) | Move to `_shared.ts` and export |
| `new GoogleGenAI({apiKey: API_KEY})` (pattern) | repeated 60+ times | every exported function | Extract to `getAi()` factory in `_shared.ts` — single-instance lazy init |
| Base64 prefix cleanup `.replace(/^data:image\/\w+;base64,/, "")` | L1820, L2218 | `validateRiskImageClick`, `analyzeFeedPostForRiskNetwork` | Extract to `stripBase64Prefix(s)` helper |
| Model IDs (`"gemini-3-flash-preview"`, `"gemini-3.1-pro-preview"`, `"text-embedding-004"`) | scattered | many | Extract to `_shared.ts` as named constants `MODEL_FLASH`, `MODEL_PRO`, `MODEL_EMBED` etc. — also future-proofs Vertex migration (see VERTEX_MIGRATION.md) |
| `searchRelevantContext` import (rag) | L3 | `queryBCN`, `getChatResponse`, `generatePersonalizedSafetyPlan`, `investigateIncidentWithAI`, `evaluateMinsalCompliance`, `analyzeFaenaRiskWithAI` (6 functions) | Stays in `ragService.ts`; each domain module imports it directly |
| `queryCommunityKnowledge` import (rag) | L3 | `analyzeRiskWithAI` only | Stays in `ragService.ts` |
| `calculateDeterministicSafeRoute` import | L4 | `calculateDynamicEvacuationRoute` only | Stays in `routingBackend.ts` |

### Proposed `_shared.ts` skeleton (~60 LOC)

```ts
import { GoogleGenAI } from '@google/genai';

export const MODEL_FLASH = 'gemini-3-flash-preview';
export const MODEL_PRO = 'gemini-3.1-pro-preview';
export const MODEL_FLASH_31 = 'gemini-3.1-flash-preview';
export const MODEL_FLASH_IMAGE = 'gemini-3.1-flash-image-preview';
export const MODEL_FLASH_2 = 'gemini-2.0-flash';
export const MODEL_TTS = 'gemini-2.5-flash-preview-tts';
export const MODEL_EMBED = 'text-embedding-004';

export const getApiKey = (): string => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  return key;
};

export const getAi = (): GoogleGenAI =>
  new GoogleGenAI({ apiKey: getApiKey() });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const withExponentialBackoff = async <T>(
  op: () => Promise<T>,
  maxRetries = 5,
  baseDelay = 1000,
): Promise<T> => { /* ... unchanged ... */ };

export const stripBase64Prefix = (s: string) =>
  s.replace(/^data:image\/\w+;base64,/, '');
```

---

## 5. Migration strategy — phased vs big-bang

### Recommendation: **phased, 3-4 modules per round**

Rationale:

1. **Compile-time safety net.** Each phase only moves functions; the public surface
   (re-exports from `geminiBackend.ts`) stays identical, so `tsc --noEmit`
   catches drift after every round.
2. **Diff size.** A big-bang move of 60 functions is a +2700 / -2700 patch, hard
   to review. 3-4 modules per round = ~180-360 LOC moved per PR — reviewable.
3. **Risk localisation.** If the dynamic-import in `gemini.ts:202` breaks for one
   action, only the functions moved that round are suspects.
4. **Test coverage co-evolution.** Per-module placement makes adding the
   currently-missing tests (AUDIT.md gap #1) tractable: add 1 test file per
   round alongside the move.

### Phasing (proposed for R22-R26)

| Round | Modules moved | Functions | Notes |
|---|---|---|---|
| **R22** | `_shared.ts`, `embeddings.ts`, `chat.ts`, `audio.ts` | 4 | Smallest; introduces the shared layer first so later rounds can import from it. |
| **R23** | `bcn-rag.ts`, `engineering.ts`, `pts.ts`, `ergonomic.ts` | 8 | Mid-sized, low-coupling. |
| **R24** | `vision.ts`, `evacuation.ts` | 10 | Medium. Vision has 6 fns; evacuation pulls `routingBackend`. |
| **R25** | `classify.ts`, `compliance.ts` | 18 | Largest singletons; high RAG coupling — review search-context flow. |
| **R26** | `recommendations/predict.ts`, `recommendations/incidents.ts`, `recommendations/personal.ts`, `index.ts` cleanup | 20 + barrel finalisation | Sub-split per §3 note. |

Total: **5 rounds**, ~12 functions/round average.

### Big-bang alternative (rejected)

Costs:
- Single PR > 3000 LOC churn — review fatigue, reviewer can't catch logic drift.
- Test-coverage gap can't be filled in the same PR without doubling the diff.
- If the dynamic-import barrel breaks for any of the 84 actions, all are affected.

Benefits:
- 1 round vs 5 rounds. Only worth it if the team commits to writing the entire
  test suite upfront — unrealistic.

---

## 6. Test impact

### Existing tests touching `geminiBackend`

| File | What it does | After split |
|---|---|---|
| `src/services/networkBackend.test.ts:14, 128, 131` | `vi.mock('./geminiBackend', () => ({ autoConnectNodes: ... }))` | Update mock target to `'./gemini/classify.js'` (where `autoConnectNodes` lands). Alternative: keep the mock against `./geminiBackend` because the barrel re-exports it; then the test's mock continues to work without change. **Recommended: keep the barrel target** for minimum churn. |
| `src/__tests__/server/askGuardian.test.ts:5` | Comment-only reference | No change. |

### New tests R22+ should add (one per module)

- `src/services/gemini/_shared.test.ts` — `withExponentialBackoff` (rate-limit retry math), `stripBase64Prefix`, `getApiKey` env-missing path
- `src/services/gemini/embeddings.test.ts` — empty-input contract, batch ordering, dimensions vector
- `src/services/gemini/classify.test.ts` — IPER doctrine: `criticidad` MUST be absent from response schema (R16 R1 doctrine, see L229-238, L714-720, L1289-1297, L2197-2213); add a regression test that fails if any LLM-returned criticidad field is propagated
- `src/services/gemini/vision.test.ts` — base64 prefix stripping, mimeType inference
- `src/services/gemini/audio.test.ts` — function-call routing for `reportIncident`
- `src/services/gemini/pts.test.ts` — schema completeness against `marcoLegal` cite-set
- `src/services/gemini/evacuation.test.ts` — fallback when Gemini parse fails (L1957-1970 fallback object)
- `src/services/gemini/bcn-rag.test.ts` — RAG-empty path returns "no info"
- `src/services/gemini/compliance.test.ts` — `complianceScore` 0-100 bound
- `src/services/gemini/engineering.test.ts` — try/catch fallback path
- `src/services/gemini/chat.test.ts` — prompt-injection `<user_input>` sandboxing
- `src/services/gemini/recommendations/*.test.ts` — happy-path schema validation
- `src/services/gemini/ergonomic.test.ts` — note: ergonomic deterministic logic now lives in `src/services/ergonomics/rula.ts` per `rula.ts:10`; the AI variants are advisory

### Tests that **stay** untouched

- All the tests in `src/services/*.test.ts` that don't import `geminiBackend` (5 of 5 non-network tests are unaffected): `routingBackend.test.ts`, `syncManager.test.ts`, `environmentBackend.test.ts`, `orchestratorService.test.ts`, plus the ergonomics tests `ergonomics/rula.test.ts`, `ergonomics/reba.test.ts`.

---

## 7. Backward-compat barrel

After R22-R26, `src/services/geminiBackend.ts` becomes a **thin re-export**
(target: ~30 LOC, down from 2701):

```ts
// src/services/geminiBackend.ts  — backward-compat barrel (R22+)
export * from './gemini/index.js';
// keep the cross-domain sibling re-exports identical to today's L2688-L2700
export * from './susesoBackend.js';
export * from './eppBackend.js';
export * from './comiteBackend.js';
export * from './medicineBackend.js';
export * from './predictionBackend.js';
export * from './legalBackend.js';
export * from './chemicalBackend.js';
export * from './psychosocialBackend.js';
export * from './shiftBackend.js';
export * from './trainingBackend.js';
export * from './inventoryBackend.js';
export * from './networkBackend.js';
```

And `src/services/gemini/index.ts`:

```ts
export * from './_shared.js';
export * from './embeddings.js';
export * from './classify.js';
export * from './vision.js';
export * from './audio.js';
export * from './pts.js';
export * from './evacuation.js';
export * from './bcn-rag.js';
export * from './compliance.js';
export * from './engineering.js';
export * from './chat.js';
export * from './recommendations/index.js';
export * from './ergonomic.js';
```

### Why the barrel must stay

- `src/server/routes/gemini.ts:202` does `await import('../../services/geminiBackend.js')`
  then dispatches by `action` name (`geminiBackend[action]`). Removing the
  barrel breaks the entire `/api/gemini` proxy and 84 client-side calls.
- `src/server/routes/misc.ts:142` similarly imports for `scanLegalUpdates`.
- `src/services/networkBackend.ts:3` and `src/services/safetyEngineBackend.ts:3`
  use static imports — also depend on the barrel.

> **Risk:** if a sibling module (`networkBackend.ts`) imports from
> `./geminiBackend` while `geminiBackend.ts` re-exports `./networkBackend.js`
> through the barrel, ESM resolution may surface a circular-init warning.
> Mitigation: update `networkBackend.ts:3` to import directly from
> `./gemini/classify.js` in R22 (smallest fix; documented in §2 cycle-risk note).

---

## 8. R22 execution plan

Per §5: **5 rounds total** (R22-R26).

### Per-round playbook (mechanical)

1. Create `src/services/gemini/<module>.ts` with the listed functions copied
   verbatim from the current line ranges in §2.
2. Replace inline `API_KEY`/`sleep`/`withExponentialBackoff`/`new GoogleGenAI(...)` with
   imports from `_shared.ts` (only after R22 lands `_shared.ts`).
3. Delete the moved functions from `geminiBackend.ts`.
4. Add `export * from './<module>.js'` to `src/services/gemini/index.ts`.
5. Run `npm run lint` (`tsc --noEmit`) — no errors expected because the public
   surface is preserved by the barrel.
6. Run `npm test` — `networkBackend.test.ts` is the only test that touches the
   surface; verify the mock still resolves.
7. Optional: add the per-module test file from §6.

### R22 specific scope

- Files created: `src/services/gemini/{_shared,embeddings,chat,audio,index}.ts`
- Files modified: `src/services/geminiBackend.ts` (delete moved functions, ~250 LOC removed)
- Functions moved: `generateEmbeddingsBatch`, `semanticSearch`, `getChatResponse`, `processAudioWithAI` (4)
- LOC budget: +500 new / -250 from `geminiBackend.ts` / net +250 (overhead: barrel + shared)
- Risk: low — these are 4 well-bounded functions

### Quality gates per round

- `tsc --noEmit` green
- Vitest green (no behavioural regressions)
- `git diff --stat` shows net LOC reduction in `geminiBackend.ts`
- `ALLOWED_GEMINI_ACTIONS` count unchanged (84) — guards against accidental
  surface change

---

## 9. Risk register (top 5, sorted by likelihood × blast-radius)

### Risk 1 — **Dynamic import + barrel circularity** (HIGH likelihood, HIGH impact)

`gemini.ts:202` does runtime `await import('../../services/geminiBackend.js')` and
then `geminiBackend[action]`. If during R22-R26 the barrel ever stops re-exporting
a previously-allowlisted action, the proxy returns `400 "Action not found"` for
real users.

**Mitigation:**
- Before each round, snapshot `Object.keys(await import('./geminiBackend.js'))`
  and assert post-round that the set is a strict superset.
- Add a CI test: `it('preserves all 84 allowlisted Gemini actions', async () => { const mod = await import('../services/geminiBackend.js'); for (const a of ALLOWED_GEMINI_ACTIONS) expect(typeof mod[a]).toBe('function'); })`.

### Risk 2 — **`networkBackend.ts` ↔ `geminiBackend.ts` import cycle** (MEDIUM likelihood, HIGH impact)

`networkBackend.ts:3` imports `autoConnectNodes` from `./geminiBackend`, and
`geminiBackend.ts:2699` re-exports `./networkBackend.js`. Today this works because
ESM tolerates one-direction cycles when the consumer is read at call-time. After
the split, if `autoConnectNodes` lands in `./gemini/classify.js` and
`networkBackend.ts` still imports from the parent barrel, the cycle deepens by
one hop and the SDK's lazy-init may fail with "module not found" in CJS mode.

**Mitigation:** in R22 (before any move that affects classify), update
`networkBackend.ts:3` to `import { autoConnectNodes } from './gemini/classify.js'`.
The test mock at `networkBackend.test.ts:131` must update to match.

### Risk 3 — **Vitest mock seam breaks** (MEDIUM likelihood, MEDIUM impact)

`networkBackend.test.ts:131` does `vi.mock('./geminiBackend', () => ({ autoConnectNodes: ... }))`.
After §2 mitigation (importing from `./gemini/classify.js`), the mock target
must change too, or the production code calls the real `autoConnectNodes` (which
hits Gemini in tests, racks up cost, and fails offline).

**Mitigation:** atomic update — change `networkBackend.ts:3` and
`networkBackend.test.ts:131` in the same commit. Add a comment at the import
site documenting the mock dependency.

### Risk 4 — **IPER doctrine drift** (LOW likelihood, CRITICAL impact)

L229-238, L714-720, L1289-1297, L2197-2213 contain repeated comments that
`criticidad` MUST NOT be in the prompt or schema (Ley 16.744 / DS 40 / DS 54
liability). Splitting into smaller files makes it easier for a future maintainer
to "innocently" add a `criticidad` field to a single module, breaking the legal
contract for that endpoint only.

**Mitigation:** add a regression test in `gemini/classify.test.ts` that
greps the module's own source for `criticidad` outside the doctrine comment.
Document the doctrine in the top-level JSDoc of each affected module.

### Risk 5 — **LOC overshoot in `recommendations.ts`** (HIGH likelihood, LOW impact)

20 functions = ~860 LOC, breaking the 150-300 LOC band the prompt requested.

**Mitigation:** sub-split into `recommendations/{predict,incidents,personal}.ts`
in R26 per §3 note. The barrel preserves backward compat regardless.

---

## Appendix A — verification commands

```bash
# total LOC of source-of-truth file
wc -l src/services/geminiBackend.ts
# 2701

# direct exports
grep -nE '^export (const|async function|function) (\\w+)' src/services/geminiBackend.ts | wc -l
# 60

# re-exported sibling modules
grep -nE "^export \\* from " src/services/geminiBackend.ts
# L2688..L2700 (12)

# allowlist size
grep -cE "^  '\\w+'," src/server/routes/gemini.ts
# 84 (with sibling-module actions included)

# direct importers of the file
grep -RnE "from ['\\\"].*geminiBackend" src
# only networkBackend.ts:3 and safetyEngineBackend.ts:3

# dynamic importers
grep -RnE "import\\(.*geminiBackend" src
# gemini.ts:202, misc.ts:142
```

## Appendix B — changes-since-prompt

The R21 prompt cited "2666 LOC, 75 exports". Actual numbers (HEAD `377150a`):

- LOC: **2701** (+35 vs prompt) — likely reflects R20 unrelated edits or stale
  count in the prompt template. The split plan below uses the actual counts.
- Direct exports: **60**. Adding the 12 sibling re-exports gives 72; counting the
  union of `ALLOWED_GEMINI_ACTIONS` (which include sibling-backend functions
  like `predictEPPReplacement`, `analyzeChemicalRisk`, etc.) gives 84. The "75"
  figure does not match any concrete count and appears to be an estimate.

## Appendix C — per-domain dispatch (consumer × allowlist matrix)

For each target module, the table below pins which `ALLOWED_GEMINI_ACTIONS`
entries (allowlist line in `src/server/routes/gemini.ts`) it owns. This is the
authoritative source for the CI snapshot test recommended in Risk #1.

| Target module | Allowlist lines (gemini.ts) | Action count | Direct callers (non-`gemini.ts`) |
|---|---|---|---|
| `embeddings.ts` | L27, L29 | 2 | – |
| `classify.ts` | L28, L30, L32, L43, L58, L66, L75, L76, L82 | 9 | `networkBackend.ts:3` (`autoConnectNodes`) |
| `vision.ts` | L35, L41, L61, L70, L73, L74 | 6 | – |
| `audio.ts` | L72 | 1 | – |
| `pts.ts` | L37, L38, L49 | 3 | – |
| `evacuation.ts` | L34, L39, L64, L71 | 4 | – |
| `bcn-rag.ts` | L45, L59 | 2 | – |
| `compliance.ts` | L36, L50, L52, L55, L63, L79, L84, L85, L86 | 9 | `safetyEngineBackend.ts:3` (`processGlobalSafetyAudit`, `calculateComplianceSummary`); `misc.ts:147` (`scanLegalUpdates`) |
| `engineering.ts` | L77, L78 | 2 | – |
| `chat.ts` | L46 | 1 | – |
| `recommendations.ts` (or sub-split) | L31, L40, L42, L44, L47, L48, L51, L53, L54, L56, L57, L62, L65, L67, L68, L69, L80, L81, L83, L87 | 20 | – |
| `ergonomic.ts` | L33, L60 | 2 | – |
| **Subtotal own** | – | **61** | – |
| Sibling barrel-only | L60-61, L79, L80-86 etc. (varies) | 23 | (handled by sibling modules; out of scope for split) |
| **Total** | – | **84** | – |

> The "Subtotal own" of 61 is one more than the 60 direct exports because
> `searchRelevantContext` (L108) is allowlisted but actually defined in
> `ragService.ts` and re-exported through one of the sibling barrels. R22 must
> not move it — it stays in `ragService.ts`.

## Appendix D — call-graph evidence

Internal calls inside `geminiBackend.ts` (only 2 helpers are reused — the file
is mostly flat):

```
withExponentialBackoff
├── generateEmbeddingsBatch        L40
└── processDocumentToNodes         L636

(no other intra-file function-to-function calls;
 every export is independent and self-contained
 — confirmed by grep `^\\s*await? (analyze|generate|predict|...)` for
 cross-references)
```

External calls from inside `geminiBackend.ts` (imports at L1-4):

```
@google/genai          → 60/60 functions (every export)
ragService             → 6 functions
  ├── searchRelevantContext: queryBCN, getChatResponse,
  │      generatePersonalizedSafetyPlan, investigateIncidentWithAI,
  │      evaluateMinsalCompliance, analyzeFaenaRiskWithAI
  └── queryCommunityKnowledge: analyzeRiskWithAI (only)
routingBackend         → 1 function
  └── calculateDeterministicSafeRoute: calculateDynamicEvacuationRoute
types                  → 3 functions (RiskNode type)
  ├── generateEmbeddingsBatch (parameter type)
  ├── autoConnectNodes (parameter type)
  └── enrichNodeData (return type)
```

Implication: **the file has near-zero internal cohesion.** Every domain module
can be moved in isolation — the only friction is external `searchRelevantContext`
imports (which stay in `ragService.ts`) and the 2 reuses of
`withExponentialBackoff` (which moves to `_shared.ts` in R22).

## Appendix E — model-id × module heat-map (for `_shared.ts` constants)

| Module | `MODEL_FLASH` | `MODEL_PRO` | `MODEL_FLASH_31` | `MODEL_FLASH_IMAGE` | `MODEL_FLASH_2` | `MODEL_TTS` | `MODEL_EMBED` |
|---|---|---|---|---|---|---|---|
| embeddings | – | – | – | – | – | – | 2 |
| classify | 5 | – | – | – | – | – | – |
| vision | 4 | 2 | – | 1 | – | – | – |
| audio | 1 | – | – | – | – | 1 | – |
| pts | 1 | 2 | – | – | – | – | – |
| evacuation | 3 | – | – | – | – | – | – |
| bcn-rag | 1 | 1 | – | – | – | – | – |
| compliance | 5 | 4 | – | – | – | – | – |
| engineering | – | 2 | – | – | – | – | – |
| chat | – | 1 | – | – | – | – | – |
| recommendations | 17 | – | 2 | – | 1 | – | – |
| ergonomic | 1 | 1 | – | – | – | – | – |
| **Total uses** | **38** | **13** | **2** | **1** | **1** | **1** | **2** |

This validates the constant-extraction proposal in §4: 38 occurrences of the
flash model alone justify a single named import vs string-literal duplication.
