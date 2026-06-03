# DEEP-EX-30 — Pasada exhaustiva línea-por-línea (Lote #30)

**Deriva:** `ledger.json` → `category` empieza con `FEAT` && `block === "B14-IA"`,
ordenado por `path`, slice `[0:55]`.
**Universo:** 175 archivos `FEAT`/`B14-IA`; este lote cubre los primeros 55.
**Foco:** núcleo IA/Gemini/SLM. Hallazgos NUEVOS (no repite `DEEP-B14-IA.md`:
whitelist 84 acciones 1:1, circuit breaker, aiFeedback replay-guard, SLM offline
OFF + CDN, dos runtimes SLM, onnxAdapter tinyllama).

## Atestación 55/55

Los 55 archivos del slice fueron leídos. Server routes/jobs/middleware
completos línea-por-línea; componentes/hooks/pages leídos en su totalidad o
escaneados exhaustivamente por patrón de riesgo (`JSON.parse`, `Math.random`,
`dangerouslySetInnerHTML`, `GEMINI_API_KEY`, `apiKey`, auth/audit, prompts
diagnósticos, tenantId-del-cliente, fetch sin token). Cruces verificados con
`geminiBackend.ts`, `geminiService.ts`, `medicalAnalysisBackend.ts`,
`scripts/precommit-medical-guard.cjs`, `scripts/precommit-stub-guard.cjs`.

## Hallazgos

| # | Sev | Archivo:línea | Hallazgo |
|---|-----|---------------|----------|
| 1 | 🔴 | `src/services/medicalAnalysisBackend.ts:138` (vía `geminiService.ts:135-138` + `medicalAnalysisBackend.ts:53`) | **Código diagnóstico fuera del medical-guard (ADR 0012).** `differentialDiagnosis` produce `differentialDiagnosis[]` con `icd10`, `probability`, `suggestedTreatment`, `redFlags`; `analyzeMedicalInjury` produce `severity`/`requiresHospitalization`/`specialistRequired`. El prompt pide explícitamente *"diagnóstico diferencial"* / *"diagnóstico ocupacional estructurado"*. `scripts/precommit-medical-guard.cjs` solo escanea `src/services/health/`, `src/services/medicine/`, `src/components/{health,medicine}/`, `src/pages/Health*`, `MyData`, `Medicine` — **NO** `src/services/medicalAnalysisBackend.ts`, así que estos prompts diagnósticos nunca se evaluaron contra `FORBIDDEN_PROMPT_PATTERNS`. El nombre `differentialDiagnosis` tampoco está en `FORBIDDEN_FUNCTION_NAMES`. Riesgo de compliance: ADR 0012 enforced-by-hook pero con punto ciego de cobertura. |
| 2 | 🟡 | `src/services/geminiService.ts:135-138` + UIs `DifferentialDiagnosis.tsx`/`MedicalAnalyzer.tsx`/`DrugInteractions.tsx`/`AnatomyLibrary.tsx` | **Feature médico shipping pero muerto + sin `<MedicalDisclaimer/>`.** Los 4 wrappers cliente (`differentialDiagnosis`, `analyzeMedicalInjury`, `checkDrugInteractions`, `generateMedicalIllustration`) hacen `callGeminiAPI(...)` → `POST /api/gemini`, pero **ninguna de las 4 acciones está en `ALLOWED_GEMINI_ACTIONS`** → el server responde **403** (`gemini.ts:398`). Las UIs existen y se renderizan (botones funcionales) pero la llamada siempre falla. Además ninguna de esas 3 vistas de diagnóstico renderiza `<MedicalDisclaimer/>` (grep vacío). O bien es una desactivación intencional de diagnóstico (correcto para ADR 0012, pero deja UI rota visible sin feature-flag → roza anti-stub-disfrazado #13) o una regresión silenciosa. |
| 3 | 🟡 | `src/server/routes/wisdomCapsule.ts:322, 427, 480` | **5xx filtra internals (conv. #8).** Los tres handlers (`/stats`, `/today`, `/ack`) hacen `res.status(500).json({ error: err?.message ?? 'internal' })` **sin** el guard `NODE_ENV === 'production' ? 'Internal server error' : err.message`. Devuelve `err.message` crudo en prod. |
| 4 | 🟡 | `src/server/routes/wisdomCapsule.ts:474` | **`auditServerEvent` no envuelto en try/catch (conv. #14).** En `/ack`, `await auditServerEvent(...)` está fuera de try/catch interno: si la escritura de audit falla, lanza y convierte un ack exitoso (XP ya otorgado en la txn) en un 500 al usuario. El patrón exigido es `try { await auditServerEvent } catch { logger.error; Sentry }` sin bloquear la respuesta. |
| 5 | 🟡 | `src/server/routes/wisdomCapsule.ts:326-422` (`/today`) | **Write de estado sin audit_logs (conv. #3).** `/today` persiste `wisdom_capsules/{pid}_{date}` (`cacheRef.set`, l.399) y emite `zettelkasten_nodes` (`emitSafetyLearningNode`, l.161) — ambas operaciones de escritura — sin ningún `auditServerEvent`. Solo `/ack` audita. |
| 6 | 🟡 | `src/server/jobs/consolidateZettelkasten.ts:29 (doc) vs 90-189 (impl)` | **Doc-vs-code drift + audit faltante.** El header dice *"4. Records an audit_log entry per migrated node with before paths"*, pero la implementación **no escribe ningún `audit_logs`** — en `mode:'commit'` hace `targetRef.set` + `doc.ref.delete` (l.171,181) sin traza de auditoría. Migración destructiva (borra source docs) sin compliance trail. |
| 7 | 🟡 | `src/components/ai/GuardianVoiceAssistant.tsx:297` | **ID-gen con `Math.random()` (conv. #15, texto CLAUDE.md).** `id: \`task-${Date.now()}-${Math.random().toString(36).substr(2,9)}\`` para tasks que se persisten en Firestore vía `addNode`. CLAUDE.md #15 dice "any ID-generation code → `randomId()`". El guard (`precommit-stub-guard.cjs:39`) solo cubre `src/server/`, así que NO lo atrapa, pero la convención escrita es más estricta. (`substr` además deprecado.) |
| 8 | 🔵 | `src/server/routes/gemini.ts:251-252, 405-406, 511-513` | **`tenantId`/`tier` derivados del token, no del cliente — OK, pero `tier` con fallback laxo.** `tier = req.user?.tier ?? req.user?.subscriptionTier ?? 'bronze'`. `tenantId = req.user?.uid ?? 'unknown'`. El tier sale del custom claim del JWT (no del body), lo cual es correcto, pero el fallback a `'bronze'` (tier más bajo) ante claim ausente es fail-closed conservador — bien. Nota: si el claim de tier no se sincroniza con `users/{uid}.subscription.planId` (canon server-side, conv. #11), la cuota Gemini podría gatearse con un tier desfasado. Verificar fuente del claim `tier`. |
| 9 | 🔵 | `src/hooks/useSlmAcquisition.ts:166` | **`Math.random()` en jitter de backoff — dentro de lo permitido.** `backoffDelayMs` usa `Math.random()` para jitter, NO para ID-gen, y es cliente. Conv. #15 lo permite (ban scoped a server + ID-gen). Sin acción; documentado para descartar falso positivo. |

## Limpios (sin hallazgos)

- **Server routes puros (verifyAuth + assertProjectMember + Zod + error scoped):**
  `aiGuardrails.ts`, `aiQuality.ts`, `aiToggle.ts`, `coachRag.ts`,
  `explainability.ts`, `researchMode.ts`. Todos con `guard()` →
  `assertProjectMember` antes de computar, validación Zod estricta, y
  `res.status(500).json({ error: 'internal_error' })` (sin filtrar internals).
- **`aiFeedback.ts`** — replay-guard transaccional (ya en B14-IA), `redactPII`
  (RUT/email/teléfono) antes de persistir, audit fuera de la txn con try/catch,
  summary admin-gated. `JSON.parse` ausente. Limpio.
- **`gemini.ts`** — whitelist 84 acciones exacta, circuit/quota gate en ambos
  `/ask-guardian` y `/gemini` y `/gemini/stream`, E2E-mock fail-closed en prod
  (`NODE_ENV !== 'production'`), 5xx con guard `NODE_ENV` en `/gemini` (l.456).
  Prompt de "El Guardián" es asesoría normativa, no diagnóstico. SSE con
  `req.on('close')` cancel. Limpio (salvo nota #8 sobre fuente de `tier`).
- **`geminiCircuit.ts`** — máquina de estados closed/open/half-open correcta,
  clock inyectable, limpieza de entradas stale, in-process documentado.
- **`aggregateAiFeedback.ts`** — cron idempotente, lectura por ventana, sin
  PII (consume datos ya redactados por aiFeedback). `tracedAsync` wrap.
- **SLM:** `SLMProvider.tsx` (dynamic imports, mountedRef anti-leak),
  `SLMModelPicker.tsx` (`listModelsWithVerifiedHash()` en PROD — defense-in-depth
  hash pinning), `useSlmAcquisition.ts` (AbortController, keep-awake best-effort,
  backoff). `OfflineSLMBanner`, `ReconciliationStatusToast`, `SLMShellOverlay`,
  `SLMStatusPanel`, `SlmAcquisitionPrompt(+Host)`, `SlmDownloadFloatingBanner`,
  `SlmManagerScreen` — UI, sin riesgo.
- **Hooks cliente** (`useAiGuardrails`, `useAiQuality`, `useAiToggle`,
  `useCoachRag`, `useExplainability`, `useInsights`, `useReputationalAlerts`,
  `useResearchMode`, `useResilientAi`, `useResilientAsesorFlag`,
  `useStreamedGuardian`, `useAutonomousAlerts`) — wrappers fetch a endpoints
  autenticados (`apiAuthHeaders()`/`Authorization`); `JSON.parse` en
  `useStreamedGuardian:153` envuelto en try/catch; todos client-side.
- **Componentes AI:** `AiResponseCard`, `EthicsGuardian`, `PredictiveAnalysis`,
  `ResilientAiAssistantPanel`, `SafetyForecast`, `AsesorChat(+Lazy+Router)`,
  `ResilientAsesorPanel`, `DomainPromptCatalog`, `ExplainedRecommendationCard`,
  `AlertSchedulerMount`. Sin `dangerouslySetInnerHTML`, sin `apiKey` cliente.
- **`VisionAnalyzer.tsx`** — patrón correcto §2.18: heurística EPP **on-device
  primero**, enriquecimiento cloud Gemini opcional y solo si `isOnline`, merge.
  La imagen enviada es escena de seguridad (`analyzeVisionImage`, whitelisted),
  NO biométrica → no viola conv. #12 (que aplica a pose/HR MediaPipe/Health).
- **Pages** (`AIHub`, `ModuleHub`, `PredictiveGuard`, `SafetyCoach`),
  `AIRoutes.tsx`, `ReloadPrompt.tsx`. `/diagnostico` (ModuleHub:105 → RiskRoutes)
  es diagnóstico **de riesgo organizacional** (IPER), no médico.

## Resumen

Cubiertos los 55 archivos del slice `FEAT`/`B14-IA[0:55]`. El núcleo del proxy
Gemini (`gemini.ts`, whitelist 84, circuit/quota) y los 6 routes "sprint-k"
puros (guardrails/quality/toggle/coachRag/explainability/researchMode) están
sólidos: verifyAuth + assertProjectMember + Zod + errores no-filtrantes.
Hallazgo principal **🔴**: `medicalAnalysisBackend.ts` contiene prompts
explícitamente diagnósticos (`differentialDiagnosis` con CIE-10 + tratamiento
sugerido, `analyzeMedicalInjury`) que viven **fuera** del scope del
`precommit-medical-guard.cjs` y nunca se evaluaron contra ADR 0012 — punto
ciego de cobertura del hook. Acompaña un **🟡** de feature médico shipping-pero-
muerto: las 4 acciones diagnósticas se llaman desde el cliente pero NO están
whitelisted (403 garantizado) y sus UIs no renderizan `<MedicalDisclaimer/>`.
`wisdomCapsule.ts` acumula tres 🟡 de convención (5xx filtra `err.message` en
prod #8, `auditServerEvent` sin try/catch #14, y `/today` escribe sin audit
#3). `consolidateZettelkasten.ts` declara en su doc un audit_log por nodo que
la implementación no escribe (drift #6) en una migración destructiva.
Finalmente `GuardianVoiceAssistant.tsx:297` genera IDs persistidos con
`Math.random()` (conv. #15 por texto, aunque el guard solo cubre `src/server/`).
Sin prompt-injection, RAG-poisoning, `JSON.parse` server sin try/catch, ni
colecciones cliente sin regla detectados en este lote.
