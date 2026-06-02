# DEEP — B14 IA / Gemini / SLM & Copilots · 2026-06-02

**Archivos revisados:** 184 (104 fuente + 80 test). Todos presentes en disco;
ninguno faltante. Bloque 🔐 — la superficie IA completa: proxy Gemini,
guardrails, RLHF feedback, SLM on-device (ONNX/MediaPipe), orquestación
resiliente y copilots (Asesor, Coach, Explainability, ResearchMode).

---

## 1. Lo que YA HACE (implementado y real)

- **Proxy `/api/gemini` con whitelist sólida.** `ALLOWED_GEMINI_ACTIONS` =
  **84 acciones** (`src/server/routes/gemini.ts:119-204`). Verificación 1:1:
  cruzando los 84 nombres contra los símbolos exportados desde
  `geminiBackend.ts` + el split `src/services/gemini/*` + los `export *` de los
  14 backends de dominio (suseso/epp/comite/medicine/prediction/legal/…), **los
  84 resuelven a un export real — 0 huérfanos**. Dispatch único en
  `gemini.ts:426-431` (`typeof fn === 'function'` → 400 si falta).
- **Circuit breaker real (los 503).** `geminiCircuit.ts` implementa la máquina
  closed→open(5 fallos/60s)→half-open(5min)→closed con clock inyectable.
  Cableado en los 3 endpoints AI (`/ask-guardian`, `/gemini`, `/gemini/stream`)
  vía `assertGeminiAllowed` → `503 gemini_circuit_open` / `429 quota_exceeded`
  (`gemini.ts:254-268, 408-422, 514-531`). `recordGeminiOutcome` contabiliza
  éxito/fallo + costo estimado en cada path, incl. SSE streaming.
- **aiFeedback replay protection completa.** `aiFeedback.ts:225-258`
  `db.runTransaction` lee-comprueba-escribe atómico; voto duplicado sin
  `?force=true` → **409 `already_voted`** (`:261-266`). PII redactada antes de
  persistir (RUT/email/teléfono CL, `redactPII` `:55-73`), guarda solo la
  versión redactada + flag `responseHadPII`. Audit row fuera de la transacción
  (append-only) con `merge:true` para no romper voto legítimo. TTL 7 días.
- **ADR 0012 respetado en prompts.** El dominio medicina lleva guardrail
  clínico explícito: `chat.ts:102` "LÍMITE CLÍNICO (ADR 0012): NUNCA emitas un
  diagnóstico, NUNCA determines el origen de una patología ni sugieras
  tratamientos… deriva SIEMPRE". Test lo pinea (`asesorDomain.test.ts:11-14`).
  No se hallaron prompts de forma diagnóstica en `src/services/gemini/*`.
- **resilientAiOrchestrator tiered fallback real.** `resilientAiOrchestrator.ts`
  5 tiers (slm→zettelkasten→firestore→gemini→canned), adapters inyectados,
  timeout por tier (`tryTier` `:310-334`), `degraded` flag, `answerEmergency`
  solo-local (`:412-423`), canned por dominio con disclaimer inline
  (`:392-405`). detectDomain heurístico sin LLM (`:209-299`).
- **Guardrails deterministas.** `hallucinationGuard.ts` (afirmaciones con
  números/fechas/leyes exigen citation `[n]` adyacente),
  `citationValidator.ts` (valida `[n]` contra sources, detecta citas
  inventadas), `versionedPrompts.ts`, `runWithGuardrails.ts`. 100% deterministas,
  sin LLM-juez (decisión documentada: costo/determinismo/auditabilidad).
- **Integridad SLM con doble política.** `slmIntegrityGuard.ts` (estricto,
  throw on mismatch, usado por `slmRuntime.ts` antes de
  `InferenceSession.create()`) + `slmIntegrityCheck.ts` (graceful warn). SHA-256
  reales pineados desde HF LFS oid (`registry.ts`, `HASH_COMPUTED_AT 2026-05-13`),
  incl. companion `.onnx_data`.
- **AI-off toggle + drift.** `aiModeController.ts` decide cloud/SLM/reglas ANTES
  de tocar Gemini (§161-162); `ruleDriftDetector.ts` complementa.
- **Auth posture uniforme.** Las 6 rutas AI de dominio (aiToggle, aiQuality,
  coachRag, explainability, researchMode, aiGuardrails) tienen `verifyAuth` +
  `assertProjectMember(callerUid, projectId, …)` antes de escribir; summary de
  feedback es admin-gated (`aiFeedback.ts:308-311`).
- **Cobertura de test alta:** 80 archivos de test (≈43% del bloque), incl.
  replay (`aiFeedback.replay.test.ts`), circuit (`geminiCircuit.test.ts`),
  offline SLM (`slmRuntime.offline.test.ts`).

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

- 🟡 **SLM offline NO bundleado por defecto.** El flag `SLM_OFFLINE_ENABLED` y
  `VITE_SLM_OFFLINE_ENABLED` = **`false`** en `.env.example:233,644` → la feature
  está OFF en prod. Solo **Qwen-2.5-0.5b** tiene `prePackagedPath`
  (`registry.ts:99`); el modelo **default (Phi-3-mini) y Gemma NO** → caen a
  `fetch(model.url)` apuntando a `huggingface.co/.../resolve/main/...`
  (`loader.ts:81-92`). Es decir: con el flag ON pero sin Qwen seleccionado, el
  "modo offline" depende de **descargar 2.7 GB desde HuggingFace CDN en runtime**
  — contradice la promesa "la IA nunca falla sin red" salvo que el usuario
  preseleccione Qwen o el release pipeline corra prepackage. El workflow
  `prepackage-slm.yml` solo hace dry-run en PR; el download real es
  `workflow_dispatch`/release manual y los `.onnx` están gitignored.
- 🟡 **Dos runtimes SLM paralelos.** `slmRuntime.ts` (real, `ort.InferenceSession`)
  + `onnxAdapter.ts` (real, IndexedDB cache) coexisten con
  `worker/slmWorker.ts` cuyo `generate()` aún **retorna mock**
  (`slmWorker.ts:58`). El mock está correctamente registrado en
  `docs/stubs-inventory.md:6-11` (criterio de retiro documentado). El default
  URL de `onnxAdapter` apunta a `/models/slm/tinyllama-1.1b-q4.onnx`
  (`onnxAdapter.ts:171`) — un modelo (`tinyllama`) que **NO existe en el
  `MODEL_REGISTRY`** (phi-3/qwen/gemma). Inconsistencia de naming/contrato entre
  los dos caminos.
- 🟡 **AsesorChat legacy aún usa `orchestrator.ts` (slm/orchestrator), no el
  `resilientAiOrchestrator`.** El nuevo orquestador de 5 tiers vive detrás del
  flag `useResilientAsesorFlag` (default OFF, `AsesorChatRouter.tsx`). Migración
  planificada pero incompleta — el header de `AsesorChat.tsx:3` admite "migrar
  este wire al hook `useSlmOffline`".
- 🔵 **`eppDetectorOnDevice.ts:182` retorna `mockDetections`** (no en el ledger
  B14 pero contiguo a `src/services/ai/`); verificar registro en stubs-inventory
  si es user-visible.

---

## 3. Tabla por archivo (selección representativa — 104 fuente)

| Archivo | LOC | Estado | Cableado | Propósito + hallazgo file:line |
|---|---|---|---|---|
| src/server/routes/gemini.ts | 595 | ✅ | sí | Proxy + ask-guardian + stream; 84 actions whitelist `:119-204`; circuit/quota gate `:254,408,514` |
| src/server/middleware/geminiCircuit.ts | 151 | ✅ | sí | Breaker closed/open/half-open `:36-150`; singleton `:150` |
| src/services/geminiBackend.ts | 1466 | ✅ | sí | Dispatch target; 28 exports directos + re-export split `:36-112` + `export *` 14 backends `:1450-1466` |
| src/services/gemini/chat.ts | — | ✅ | sí | Guardrail ADR 0012 medicina `:102` |
| src/services/gemini/parsing.ts | — | ✅ | sí | `parseGeminiJson` throw `gemini_empty_response` + backoff `:35-57` |
| src/services/gemini/pii.ts | — | ✅ | sí | `redactPromptForVertex` antes de cloud |
| src/server/routes/aiFeedback.ts | 338 | ✅ | sí | runTransaction+409 replay `:225-266`; redactPII `:55-73`; TTL 7d |
| src/server/jobs/aggregateAiFeedback.ts | — | ✅ | sí | Cron summary semanal RLHF |
| src/services/ai/resilientAiOrchestrator.ts | 423 | ✅ | flag | 5-tier fallback + canned disclaimer `:392-405`; emergency local-only `:412` |
| src/services/ai/asesorAdaptersFactory.ts | — | ✅ | sí | Construye adapters por tier |
| src/services/ai/geminiAdapter.ts | — | ✅ | sí | Tier gemini del orchestrator |
| src/components/shared/AsesorChatRouter.tsx | — | ✅ | sí | Conmuta legacy↔resilient por flag (default OFF) |
| src/components/shared/AsesorChat.tsx | 564 | 🟡 | sí | Legacy; usa slm/orchestrator + GuardianOffline, no resilient `:3,33` |
| src/services/aiGuardrails/hallucinationGuard.ts | 281 | ✅ | sí | Heurística citation-required determinista |
| src/services/aiGuardrails/citationValidator.ts | — | ✅ | sí | Valida `[n]` vs sources, detecta inventadas |
| src/services/aiGuardrails/runWithGuardrails.ts | 281 | ✅ | sí | Wrapper guardrail end-to-end |
| src/server/routes/aiGuardrails.ts | 338 | ✅ | sí | 8 POST, verifyAuth+assertProjectMember `:63` |
| src/server/routes/aiQuality.ts | 333 | ✅ | sí | 6 POST audit-log IA, projectMember `:73` |
| src/server/routes/aiToggle.ts | — | ✅ | sí | Modo IA-off/local, projectMember `:44` |
| src/server/routes/coachRag.ts | — | ✅ | sí | Coach RAG, projectMember `:47` |
| src/server/routes/explainability.ts | — | ✅ | sí | Explica recomendaciones, projectMember `:44` |
| src/server/routes/researchMode.ts | — | ✅ | sí | Research mode, projectMember `:53` |
| src/services/aiToggle/aiModeController.ts | — | ✅ | sí | Decide cloud/SLM/reglas pre-LLM §161-162 |
| src/services/slm/slmRuntime.ts | 1032 | ✅ | sí | ORT real `InferenceSession.create` `:458`; integrity guard antes |
| src/services/slm/onnxAdapter.ts | 661 | 🟡 | sí | Real + IndexedDB cache; default URL `tinyllama` no en registry `:171` |
| src/services/slm/worker/slmWorker.ts | 499 | 🏚️ | parcial | `generate()` mock `:58` — registrado en stubs-inventory |
| src/services/slm/registry.ts | — | 🟡 | sí | 3 modelos; solo Qwen `prePackagedPath` `:99`; Phi-3/Gemma → HF CDN |
| src/services/slm/loader.ts | — | 🟡 | sí | Cache-hit pre_packaged, miss → `fetch(model.url)` HF `:81-92` |
| src/services/slm/slmIntegrityGuard.ts | — | ✅ | sí | Strict throw on SHA mismatch `:102` |
| src/services/slm/slmIntegrityCheck.ts | — | ✅ | sí | Graceful warn-in-staging |
| src/services/slm/reconciliationAutoTrigger.ts | 435 | ✅ | sí | ID: crypto.randomUUID, Math.random solo fallback `:194-198` |
| src/hooks/useSlmOffline.ts | 203 | ✅ | sí | Online-first→SLM fallback; lee SLM_OFFLINE_ENABLED `:104` |
| src/services/geminiService.ts | — | ✅ | sí | Cliente HTTP `/api/gemini` `:17`, wrappers por acción |
| src/services/coach/prompts.ts | 345 | ✅ | sí | Prompts coach, cita REBA/RULA/NIOSH con autor/año `:248` |
| src/services/explainability/recommendationExplainer.ts | — | ✅ | sí | Explica recos sin LLM |
| .github/workflows/prepackage-slm.yml | — | 🟡 | parcial | Dry-run en PR; download real solo workflow_dispatch/release |

(El resto — 80 tests + servicios slm/worker/cache/reconciliation/digitalTwin/
ar/zettelkasten orchestrators — revisados; estados ✅ salvo lo anotado.)

---

## 4. Para decisión del usuario (❓/⚠️)

- ⚠️ **¿La promesa "IA nunca falla offline" es honesta con Phi-3 default sin
  bundle?** Hoy, SLM_OFFLINE_ENABLED=false por defecto y solo Qwen-0.5b es
  pre-empaquetable. Si el objetivo de launch es offline-first real para el
  default, hay que: (a) marcar Qwen como default, o (b) garantizar que el
  release pipeline corra `prepackage-slm` para Phi-3 y servirlo self-host (no HF
  CDN). Decisión de producto + release.
- ⚠️ **Dos runtimes SLM (slmRuntime real vs slmWorker mock) + default URL
  `tinyllama` fuera del registry** (`onnxAdapter.ts:171`). ¿Consolidar en uno
  antes de flip del flag? El mock está gated y en stubs-inventory, pero el
  naming inconsistente puede confundir en debugging de prod.
- ❓ **¿Cuándo se hace el default-flip de `useResilientAsesorFlag`?** El
  orquestador de 5 tiers (mejor diseño) está OFF; AsesorChat legacy sigue
  sirviendo a todos los usuarios. Confirmar plan de canary.
- ⚠️ Verificar que `eppDetectorOnDevice.ts:182` (mockDetections) esté en
  stubs-inventory si es user-visible (directiva #13).
