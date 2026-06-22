// Praeventio Guard — Round 19 R2 Phase 4 split.
//
// Gemini-backed AI endpoints extracted from server.ts:
//   • POST /api/gemini         — whitelisted backend RPC proxy. Routes
//     `{ action, args }` to a known method on `src/services/geminiBackend.ts`
//     after asserting the action is on the explicit allowlist below.
//   • POST /api/ask-guardian   — "El Cerebro Externo". Performs RAG context
//     search and prompts Gemini; supports SSE streaming when the body sets
//     `stream: true`.
//
// Both endpoints require a Firebase ID token (`verifyAuth`) and consume the
// shared per-user Gemini limiter (`geminiLimiter`) — 30 req / 15 min keyed
// on uid (see src/server/middleware/limiters.ts for rationale). The
// allowlist on /api/gemini is the security boundary that prevents arbitrary
// backend method invocation; adding a new RPC requires adding it here.
//
// Mounted via `app.use('/api', geminiRouter)` because the two paths are
// siblings under /api (not nested under /api/gemini). Final paths
// preserved verbatim.

import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { ProjectMembershipError } from '../../services/auth/projectMembership.js';
import { isGeminiDegradedError } from '../../services/gemini/degraded.js';
import { redactPromptForVertex } from '../../services/gemini/pii.js';
import { baselineEmergencyPlan } from '../../services/gemini/emergency.js';
import {
  hasServerSlmFallback,
  geminiSlmFallback,
} from '../../services/gemini/geminiSlmFallback.js';
import { geminiLimiter, geminiGlobalDailyLimiter } from '../middleware/limiters.js';
import { getFirestore } from 'firebase-admin/firestore';
// Sprint 22 prod hardening (Bucket X) — wire circuit breaker + per-tenant
// quota gating at the dispatch seam. Both /api/ask-guardian and /api/gemini
// route every authed Gemini call through here, so a single guard pair
// (`assertGeminiAllowed` BEFORE, `recordGeminiOutcome` AFTER) covers all
// 100+ backend RPCs without per-callsite changes that would balloon the
// diff and risk per-function regressions.
import {
  assertGeminiAllowed,
  recordGeminiOutcome,
  estimateGeminiCostUsd,
} from '../../services/geminiBackend.js';
// Sprint 22 Bucket AA — request-scoped tracing for the AI dispatch path.
import { tracedAsync } from '../../services/observability/tracing.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { logger } from '../../utils/logger.js';
import { isUpstreamGeminiParseError } from './_geminiErrors.js';
import {
  AI_MODEL_CHAT,
  AI_MODEL_FAST_LONGFORM,
  AI_MODEL_FAST_STABLE,
  AI_MODEL_REASONING,
  AI_MODEL_VISION,
} from '../../config/aiModels.js';
// AI provider layer — per-action routing to a self-hosted OpenAI-compatible
// endpoint (vLLM/Ollama). Without AI_SELFHOSTED_* config, resolveProvider()
// returns 'gemini' for every action and the legacy path below runs unchanged.
import {
  resolveProvider,
  hasSelfHostedActionSpec,
  dispatchSelfHostedAction,
  selfHostedFallsBackToGemini,
  recordProviderCall,
  SELFHOSTED_CIRCUIT_KEY,
} from '../../services/ai/providerRouter.js';

function sentryCapture(
  err: unknown,
  context: { endpoint?: string; trigger?: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as any,
    );
  } catch (e) {
    console.warn('[observability] capture failed', e);
  }
}

// Sprint 10 — restablece el patrón "Portal â†’ Sentidos â†’ Mente" del prototipo
// histórico (ver docs/proto/analisis_funcional.md). El orquestador inyecta
// contexto ambiental (clima + sismicidad) ANTES del RAG normativo, de modo
// que "El Gran Maestro" nunca razona en el vacío. Si el flag está apagado o
// los datos del proyecto son insuficientes, el handler degrada de forma
// silenciosa al comportamiento legacy (RAG-only).
const ENV_CONTEXT_TIMEOUT_MS = 2000;

interface ProjectGeo {
  lat: number;
  lng: number;
  altitude?: number;
}

const isEnvContextEnabled = (): boolean => {
  const flag = process.env.ENV_CONTEXT_ENABLED;
  if (flag === undefined || flag === null || flag === '') return true;
  return flag !== 'false' && flag !== '0';
};

const lookupProjectGeo = async (projectId: string): Promise<ProjectGeo | null> => {
  try {
    const snap = await getFirestore().collection('projects').doc(projectId).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const lat = typeof data.lat === 'number' ? data.lat : data.location?.lat;
    const lng = typeof data.lng === 'number' ? data.lng : data.location?.lng;
    const altitude =
      typeof data.altitude === 'number' ? data.altitude : data.location?.altitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng, altitude };
  } catch {
    return null;
  }
};

const fetchEnvContextWithTimeout = async (
  geo: ProjectGeo,
): Promise<string | null> => {
  try {
    const { fetchEnvironmentContext } = await import('../../services/orchestratorService.js');
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ENV_CONTEXT_TIMEOUT_MS);
    });
    const result = await Promise.race([
      fetchEnvironmentContext(geo.lat, geo.lng),
      timeoutPromise,
    ]);
    if (!result) {
      logger.warn('ask_guardian_env_context_timeout');
      return null;
    }
    const serialized = JSON.stringify(result);
    return serialized.length > 500 ? serialized.slice(0, 497) + '...' : serialized;
  } catch (error) {
    logger.warn('ask_guardian_env_context_failed', { err: error instanceof Error ? error.message : String(error) });
    sentryCapture(error, { endpoint: 'gemini.fetchEnvContext', tags: { phase: 'env-context' } });
    return null;
  }
};

const ALLOWED_GEMINI_ACTIONS = [
  'generateEmbeddingsBatch',
  'autoConnectNodes',
  'semanticSearch',
  'analyzeFastCheck',
  'predictGlobalIncidents',
  'analyzeRiskWithAI',
  // B3 (Fase 5): 'analyzePostureWithAI' de-whitelisted — el análisis postural
  // es 100% on-device (MediaPipe → REBA/RULA, directiva #12); la imagen del
  // trabajador no sale del equipo. Sin caller cliente; cerramos el egress.
  'generateEmergencyPlan',
  'analyzeSafetyImage',
  'generateISOAuditChecklist',
  'generatePTS',
  'generatePTSWithManufacturerData',
  'generateEmergencyScenario',
  'generateRealisticIoTEvent',
  'processDocumentToNodes',
  'simulateRiskPropagation',
  'enrichNodeData',
  'analyzeRootCauses',
  'queryBCN',
  'getChatResponse',
  'getSafetyAdvice',
  'generateActionPlan',
  'generateSafetyReport',
  'auditAISuggestion',
  'generatePersonalizedSafetyPlan',
  'analyzeDocumentCompliance',
  'generateTrainingRecommendations',
  'investigateIncidentWithAI',
  'auditProjectComplianceWithAI',
  'analyzeAttendancePatterns',
  'generateSafetyCapsule',
  'suggestRisksWithAI',
  'suggestNormativesWithAI',
  'syncNodeToNetwork',
  'syncBatchToNetwork',
  'generateCompensatoryExercises',
  // B3 (Fase 5): 'analyzeBioImage' de-whitelisted — BioAnalysis ahora corre
  // 100% on-device (directiva #12, el frame de cámara no sale del equipo).
  // Sin caller cliente; cerramos el path de egress también en el servidor.
  'generatePredictiveForecast',
  'generateOperationalTasks',
  'generateEmergencyPlanJSON',
  'forecastSafetyEvents',
  'analyzeRiskNetwork',
  'predictAccidents',
  'analyzeSiteMapDensity',
  'generateTrainingQuiz',
  'validateRiskImageClick',
  'calculateDynamicEvacuationRoute',
  'processAudioWithAI',
  'analyzeVisionImage',
  'verifyEPPWithAI',
  'analyzeRiskNetworkHealth',
  'analyzeFeedPostForRiskNetwork',
  'analyzePsychosocialRisks',
  'auditLegalGap',
  'evaluateNormativeImpact',
  'analyzeChemicalRisk',
  'suggestChemicalSubstitution',
  'generateStressPreventionTips',
  'generateShiftHandoverInsights',
  'analyzeShiftFatiguePatterns',
  'generateCustomSafetyTraining',
  'optimizePPEInventory',
  'calculateStructuralLoad',
  'designHazmatStorage',
  'evaluateMinsalCompliance',
  'generateModuleRecommendations',
  'generateExecutiveSummary',
  'analyzeFaenaRiskWithAI',
  'extractAcademicSummary',
  'calculateComplianceSummary',
  'processGlobalSafetyAudit',
  'calculatePreventionROI',
  'generateSusesoFormMetadata',
  'predictEPPReplacement',
  'auditEPPCompliance',
  'suggestMeetingAgenda',
  'summarizeAgreements',
  'mapRisksToSurveillance',
  'analyzeHealthPatterns',
  'analyzeRiskCorrelations',
  'downloadSpecificNormative',
  'searchRelevantContext',
  'getNutritionSuggestion',
  'scanLegalUpdates',
];

// Bucket X under-billing fix — the post-call quota accounting below charges a
// FLAT token estimate (args/result JSON length / 4) at the model's per-SKU
// rate. Until now every whitelisted RPC was billed at `AI_MODEL_FAST_STABLE`
// (the cheapest Flash SKU), but many actions run on a MUCH more expensive
// model internally (e.g. the prediction / legal / emergency-plan paths use
// `AI_MODEL_REASONING` — Gemini Pro, ~17× the per-token rate). Charging Flash
// rates for Pro calls under-meters real spend and lets a tenant burn far past
// their cost ceiling before the quota gate trips.
//
// This map records the REAL model each whitelisted action dispatches to, so
// the cost passed to the tracker matches the SKU actually billed by Google.
// The model is the one used by the EXPORT the dispatcher resolves via
// `geminiBackend[action]` (explicit `export {…}` re-exports shadow the barrel's
// `export *`, so e.g. `generatePredictiveForecast` → gemini/predictions FAST,
// not predictionBackend REASONING). Anything not listed defaults to
// `AI_MODEL_FAST_STABLE` (verified Flash-tier at the call site). When in doubt
// the governance pricing table (gemini/governance.ts) falls back to Pro pricing
// for unknown SKUs — so this map only needs the over-default (expensive) cases
// to be exhaustive; missing FAST entries can never UNDER-bill.
const GEMINI_ACTION_MODEL: Record<string, string> = {
  // ── Reasoning (Gemini Pro) — the expensive path that was under-billed ──
  generateISOAuditChecklist: AI_MODEL_REASONING, // gemini/operations.ts
  processDocumentToNodes: AI_MODEL_REASONING, // gemini/operations.ts
  investigateIncidentWithAI: AI_MODEL_REASONING, // gemini/operations.ts
  evaluateMinsalCompliance: AI_MODEL_REASONING, // gemini/compliance.ts
  processGlobalSafetyAudit: AI_MODEL_REASONING, // gemini/compliance.ts
  generatePTS: AI_MODEL_REASONING, // gemini/safetyDocs.ts
  generatePTSWithManufacturerData: AI_MODEL_REASONING, // gemini/safetyDocs.ts
  generatePersonalizedSafetyPlan: AI_MODEL_REASONING, // gemini/personPlans.ts
  generateEmergencyPlan: AI_MODEL_REASONING, // gemini/emergency.ts
  calculateStructuralLoad: AI_MODEL_REASONING, // gemini/engineering.ts
  designHazmatStorage: AI_MODEL_REASONING, // gemini/engineering.ts (shadows chemicalBackend)
  analyzeRootCauses: AI_MODEL_REASONING, // gemini/risk.ts
  auditLegalGap: AI_MODEL_REASONING, // legalBackend.ts
  mapRisksToSurveillance: AI_MODEL_REASONING, // medicineBackend.ts
  generateModuleRecommendations: AI_MODEL_REASONING, // geminiBackend.ts
  analyzeRiskCorrelations: AI_MODEL_REASONING, // predictionBackend.ts (not shadowed)
  // ── Conversational (Gemini Pro via AI_MODEL_CHAT) ──
  queryBCN: AI_MODEL_CHAT, // gemini/chat.ts
  getChatResponse: AI_MODEL_CHAT, // gemini/chat.ts
  // ── Vision (Gemini Pro via AI_MODEL_VISION) ──
  analyzeSafetyImage: AI_MODEL_VISION, // gemini/vision.ts
  // ── Fast long-form Markdown (preview Flash SKU, distinct rate) ──
  analyzeFaenaRiskWithAI: AI_MODEL_FAST_LONGFORM, // geminiBackend.ts
  // ── Fast default-but-explicit (FLASH_3_PREVIEW differs from FAST_STABLE) ──
  // The bulk of actions run on AI_MODEL_FAST; listing them all is brittle, so
  // they fall through to the AI_MODEL_FAST_STABLE default below. AI_MODEL_FAST
  // (FLASH_3_PREVIEW) is not in the pricing table → Pro fallback (never under-
  // bills), so the default is conservative for those too.
};

/**
 * Resolve the REAL Gemini model SKU a whitelisted action dispatches to, for
 * cost accounting. Falls back to `AI_MODEL_FAST_STABLE` for unmapped actions
 * (Flash-tier call sites). Keeps the flat token estimate unchanged — only the
 * per-SKU RATE applied to it is corrected.
 */
function modelForAction(action: string): string {
  return GEMINI_ACTION_MODEL[action] ?? AI_MODEL_FAST_STABLE;
}

// F3 — identity-from-token. A few whitelisted actions take the CALLER'S uid as
// an argument that their backend then PERSISTS (e.g. node authorship written via
// the Admin SDK, which bypasses Firestore rules). Because the dispatcher spreads
// client-supplied args verbatim, a client could spoof that field. For these
// actions the dispatcher OVERWRITES the configured arg slot with the verified
// token uid — the client-supplied value is never trusted.
const IDENTITY_STAMPED_ACTIONS: Record<string, { argIndex: number; field: string }> = {
  // syncNodeToNetwork(nodeData, authorUid) → writes metadata.authorId to nodes/*
  syncNodeToNetwork: { argIndex: 1, field: 'authorUid' },
  // syncBatchToNetwork(operations, authorUid) → batched syncNodeToNetwork
  syncBatchToNetwork: { argIndex: 1, field: 'authorUid' },
};

// Hard ceiling on the serialized RPC args. The flat token estimator below
// charges by JSON length / 4, so an unbounded args array could burn quota and
// force giant prompts. 256 KB is far above any legitimate RPC payload.
const MAX_GEMINI_ARGS_BYTES = 256 * 1024;

// Life-safety actions that MUST still return a usable result even when the
// shared Gemini breaker is already OPEN. `assertGeminiAllowed` rejects with
// `gemini_circuit_open` BEFORE dispatch, so without this carve-out a worker
// would get a 503 in exactly the sustained-outage scenario the deterministic
// plan exists to cover. Each entry synthesizes a fallback from the call args
// WITHOUT touching Gemini; the breaker stays open (no upstream call is made).
// This is the same degradation the post-dispatch GeminiDegradedError path
// provides for transient request failures — extended to the breaker-open path.
// (When the resilient on-device SLM failover — ADR 0019 — is wired server-side,
// it becomes the primary here and this baseline remains the last resort.)
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const CIRCUIT_OPEN_FALLBACKS: Record<string, (args: unknown[]) => unknown> = {
  generateEmergencyPlanJSON: (args) =>
    baselineEmergencyPlan(asStr(args[0]), asStr(args[1]), asStr(args[2]), asStr(args[3]) || undefined),
};

const router = Router();

// Ask Guardian Endpoint (El Cerebro Externo).
// Round 20 R6 R19 MEDIUM #1: gated by `geminiLimiter` (30 req / 15 min keyed
// on uid) — same per-user bucket as /api/gemini. Without it, an authed user
// could spend the global 100/15min /api/* budget entirely on SSE Gemini
// streams, which is real cost exposure. The limiter is mounted AFTER
// verifyAuth so the keyGenerator can read req.user.uid (per-uid keying); a
// pre-auth flood from missing/invalid Bearer headers is rejected by
// verifyAuth before it reaches the limiter, so 401 traffic does not
// consume any uid's quota.
router.post('/ask-guardian', verifyAuth, geminiGlobalDailyLimiter, geminiLimiter, async (req, res) => {
  const { query, projectId, stream = false } = req.body;

  // Sprint 19 / F-B11 — E2E_MODE deterministic mock. When the test runner
  // hits this endpoint with an `Authorization: E2E ...` header (validated
  // upstream by verifyAuth's E2E branch), we skip the real Gemini call and
  // return a stable payload. This keeps Playwright specs offline-cheap and
  // independent of the live Gemini quota. Production never enters this
  // branch — verifyAuth tira fatal en boot si NODE_ENV=production && E2E_MODE=1.
  if (
    process.env.E2E_MODE === '1' &&
    process.env.NODE_ENV !== 'production' &&
    typeof req.headers.authorization === 'string' &&
    req.headers.authorization.startsWith('E2E ')
  ) {
    return res.json({
      ok: true,
      mock: true,
      source: 'e2e-mode',
      endpoint: 'ask-guardian',
      query,
      projectId: projectId ?? null,
      stream,
      response: 'E2E mock response — Gemini real call bypassed.',
    });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  // Sprint 22 (Bucket X): circuit + quota gate before any Gemini I/O.
  // Tenant id derives from req.user.uid as a stable per-account bucket;
  // tier comes from the JWT custom claim populated by the billing layer.
  const tenantId: string = req.user?.uid ?? 'unknown';
  const tier: string = req.user?.tier ?? req.user?.subscriptionTier ?? 'bronze';
  try {
    await assertGeminiAllowed(tenantId, tier);
  } catch (err: any) {
    if (err?.code === 'gemini_circuit_open') {
      return res.status(503).json({ error: 'gemini_circuit_open', message: 'AI temporarily unavailable.' });
    }
    if (err?.code === 'gemini_quota_exceeded') {
      return res.status(429).json({
        error: 'quota_exceeded',
        reason: err.quota?.reason ?? 'requests_exceeded',
        usage: err.quota?.usage,
        limit: err.quota?.limit,
      });
    }
    throw err;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Sentidos: contexto ambiental tiempo real (clima + sismicidad). Se
    // ejecuta antes del RAG normativo y se omite con elegancia si falta
    // projectId, geo o el flag ENV_CONTEXT_ENABLED está desactivado.
    let envContext: string | null = null;
    if (isEnvContextEnabled() && typeof projectId === 'string' && projectId.length > 0) {
      const geo = await lookupProjectGeo(projectId);
      if (geo) {
        envContext = await fetchEnvContextWithTimeout(geo);
      }
    }

    // Unified context search using Firestore Vector Search
    const { searchRelevantContext } = await import('../../services/ragService.js');
    const context = await searchRelevantContext(query);

    // Generate response using Gemini
    const envBlock = envContext
      ? `\n      [CONTEXTO AMBIENTAL TIEMPO REAL]\n      ${envContext}\n`
      : '';
    // V11 hardening: redact PII (RUT/email/phone) from the user query before it
    // reaches Gemini. The RAG search above keeps the raw query (internal Firestore
    // vector search, never leaves our infra); only the model prompt is redacted.
    const safeQuery =
      typeof query === 'string' ? redactPromptForVertex(query, 'ask-guardian') : query;
    const prompt = `
      Eres "El Guardián", el núcleo de inteligencia artificial de Praeventio Guard.
      Tu propósito es proteger la vida humana, analizar normativas (leyes chilenas como DS 594, Ley 16.744) y gestionar riesgos.
      Responde de forma profesional, vigilante y altamente técnica pero accionable.

      REGLA DE ORO: Si el usuario te pregunta por procedimientos específicos o leyes, prioritiza la información en el CONTEXTO LEGAL proporcionado.
      Si no hay información específica en el contexto, usa tu base de conocimientos pero aclara que es una recomendación general.
${envBlock}
      [CONTEXTO NORMATIVO RELEVANTE]
      ${context}

      [PREGUNTA DEL USUARIO]
      ${safeQuery}
    `;

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const responseStream = await ai.models.generateContentStream({
        model: AI_MODEL_CHAT,
        contents: prompt,
      });

      let streamedTokens = 0;
      for await (const chunk of responseStream) {
        if (chunk.text) {
          streamedTokens += Math.ceil(chunk.text.length / 4); // rough heuristic
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
      // Bucket X: post-call accounting on streamed responses. Tokens are
      // estimated from char count when the SDK doesn't surface usage.
      const inTokens = Math.ceil(prompt.length / 4);
      await recordGeminiOutcome(tenantId, 'success', {
        tokens: inTokens + streamedTokens,
        costUsd: estimateGeminiCostUsd(AI_MODEL_CHAT, inTokens, streamedTokens),
      });
    } else {
      const result = await tracedAsync(
        'ask-guardian.generateContent',
        { tenantId, projectId: typeof projectId === 'string' ? projectId : null, model: AI_MODEL_CHAT },
        () => ai.models.generateContent({
          model: AI_MODEL_CHAT,
          contents: prompt,
        }),
      );

      res.json({
        response: result.text,
        // `searchRelevantContext` (ragService → safeNormativeQuery) now returns
        // EITHER a verified `[Fuente: ...]` snippet OR a canonical "no verified
        // info" message (never the old `'No se encontró...'` sentinel, and never
        // fabricated law). Real context used iff a source header is present.
        contextUsed: context.includes('[Fuente:'),
        envContextUsed: envContext !== null,
      });
      // Bucket X: post-call accounting. Prefer SDK-reported token usage
      // when available (Gemini 2.0+ surfaces `usageMetadata`), fall
      // back to char-based estimation.
      const meta: { promptTokenCount?: number; candidatesTokenCount?: number } =
        result.usageMetadata ?? {};
      const tokensIn = typeof meta.promptTokenCount === 'number'
        ? meta.promptTokenCount
        : Math.ceil(prompt.length / 4);
      const tokensOut = typeof meta.candidatesTokenCount === 'number'
        ? meta.candidatesTokenCount
        : Math.ceil((result.text ?? '').length / 4);
      await recordGeminiOutcome(tenantId, 'success', {
        tokens: tokensIn + tokensOut,
        costUsd: estimateGeminiCostUsd(AI_MODEL_CHAT, tokensIn, tokensOut),
      });
    }
  } catch (error) {
    logger.error('ask_guardian_failed', error);
    sentryCapture(error, { endpoint: '/api/ask-guardian', tags: { method: 'POST', tenantId } });
    // Bucket X: every Gemini exception advances the breaker counter so
    // sustained upstream failure trips it before per-tenant ceilings do.
    await recordGeminiOutcome(tenantId, 'failure');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`);
      res.end();
    }
  }
  return undefined;
});

// Gemini API Proxy
router.post('/gemini', verifyAuth, geminiGlobalDailyLimiter, geminiLimiter, async (req, res) => {
  const { action, args } = req.body;

  // Sprint 19 / F-B11 — E2E_MODE deterministic mock (same gating as
  // /ask-guardian). Returns a shape compatible with the typical wrapper
  // `{ result: ... }` without invoking the real Gemini backend.
  if (
    process.env.E2E_MODE === '1' &&
    process.env.NODE_ENV !== 'production' &&
    typeof req.headers.authorization === 'string' &&
    req.headers.authorization.startsWith('E2E ')
  ) {
    return res.json({
      result: { ok: true, mock: true, source: 'e2e-mode', action, args: args ?? [] },
    });
  }

  if (!ALLOWED_GEMINI_ACTIONS.includes(action)) {
    return res.status(403).json({ error: `Forbidden: Action ${action} is not allowed` });
  }

  // All whitelisted RPCs take a positional args array (the client wrappers
  // always send one). Reject non-arrays early — a bare spread of a non-array
  // would throw a 500 — and cap the payload so a client can't force a giant
  // prompt that burns quota past the flat estimator below.
  if (!Array.isArray(args)) {
    return res.status(400).json({ error: 'Invalid args: expected an array' });
  }
  if (JSON.stringify(args).length > MAX_GEMINI_ARGS_BYTES) {
    return res.status(413).json({ error: 'Payload too large' });
  }

  // F3 — stamp the caller's verified identity over any client-supplied value for
  // identity-persisting actions. Work on a COPY — never mutate the parsed
  // request body. The client-supplied authorUid/uid is never trusted.
  let callArgs: unknown[] = args;
  const identityStamp = IDENTITY_STAMPED_ACTIONS[action];
  if (identityStamp) {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'unauthenticated' });
    }
    callArgs = [...args];
    while (callArgs.length <= identityStamp.argIndex) callArgs.push(undefined);
    callArgs[identityStamp.argIndex] = req.user.uid;
  }

  // Sprint 22 (Bucket X): circuit + quota gate. The dispatcher is the
  // single chokepoint for 100+ Gemini RPCs — guarding here covers them
  // all without touching individual handlers in geminiBackend.ts.
  const tenantId: string = req.user?.uid ?? 'unknown';
  const tier: string = req.user?.tier ?? req.user?.subscriptionTier ?? 'bronze';

  // ── AI provider layer (self-hosted | Gemini) ────────────────────────────
  // Same chokepoint rationale as Bucket X: routing here covers every
  // whitelisted RPC without touching 80+ handler call sites. With no
  // AI_SELFHOSTED_* config this whole block is skipped (resolveProvider()
  // → 'gemini') and the legacy path below runs byte-identical.
  //
  // Chain for a selfhosted-routed action:
  //   ok                          → 200 { result } (accounted at costUsd 0)
  //   fails / breaker open        → AI_SELFHOSTED_FALLBACK_GEMINI != '0'
  //                                 (default): legacy Gemini path below,
  //                                 which carries its own degraded ladder;
  //                                 fallback OFF: ladder (RAG → canned),
  //                                 else 503.
  // The self-hosted breaker uses its OWN key ('selfhosted') so a broken
  // local model never trips the Gemini breaker, and vice versa.
  if (resolveProvider(action) === 'selfhosted' && hasSelfHostedActionSpec(action)) {
    let selfHostedBlocked = false;
    try {
      // Per-tenant quota is provider-agnostic (abuse ceiling); the circuit
      // gate runs on the ISOLATED selfhosted key, NOT the gemini key.
      await assertGeminiAllowed(tenantId, tier, SELFHOSTED_CIRCUIT_KEY);
    } catch (err: any) {
      if (err?.code === 'gemini_quota_exceeded') {
        return res.status(429).json({
          error: 'quota_exceeded',
          reason: err.quota?.reason ?? 'requests_exceeded',
          usage: err.quota?.usage,
          limit: err.quota?.limit,
        });
      }
      if (err?.code === 'gemini_circuit_open') {
        selfHostedBlocked = true; // treat as a self-hosted failure → chain
      } else {
        throw err;
      }
    }
    if (!selfHostedBlocked) {
      const attempt = await dispatchSelfHostedAction(action, callArgs);
      if (attempt.status === 'ok') {
        res.json({ result: attempt.text });
        // Same flat accounting as the Gemini path, at zero cost: the
        // per-tenant quota row still counts the request, the breaker
        // success is recorded on the isolated selfhosted key.
        const tokensIn = Math.ceil(JSON.stringify(args ?? []).length / 4);
        const tokensOut = Math.ceil(attempt.text.length / 4);
        await recordGeminiOutcome(tenantId, 'success', {
          tokens: tokensIn + tokensOut,
          costUsd: 0,
          circuitKey: SELFHOSTED_CIRCUIT_KEY,
        });
        return undefined;
      }
      // 'skipped' (config raced off / spec missing) keeps the Gemini path
      // silently; 'failed' enters the configured fallback chain below.
      if (attempt.status === 'failed') selfHostedBlocked = true;
    }
    if (selfHostedBlocked && !selfHostedFallsBackToGemini()) {
      // Gemini fallback disabled — run the degraded ladder (RAG → canned)
      // directly so the worker still gets a real answer when possible.
      if (hasServerSlmFallback(action)) {
        try {
          const fb = await geminiSlmFallback(action, callArgs);
          if (fb) {
            return res.json({ result: fb.text, degraded: true, fallbackTier: fb.tier });
          }
        } catch (fallbackErr) {
          logger.error('gemini_server_fallback_failed', fallbackErr as Error, { action });
          sentryCapture(fallbackErr, { endpoint: '/api/gemini', tags: { action, phase: 'fallback-selfhosted' } });
        }
      }
      // No internals leaked — generic unavailability, mirrors the breaker 503.
      return res.status(503).json({ error: 'selfhosted_unavailable', message: 'AI temporarily unavailable.' });
    }
    // selfHostedBlocked && fallback enabled → continue into the legacy
    // Gemini path below (gate + dispatch + its own ladder).
  }

  // Observability: per-call provider/latency/outcome (no prompt content).
  const geminiDispatchStartedAt = Date.now();

  try {
    await assertGeminiAllowed(tenantId, tier);
  } catch (err: any) {
    if (err?.code === 'gemini_circuit_open') {
      // Life-safety carve-out: serve the deterministic fallback instead of 503
      // so a worker in an emergency still gets a usable plan during the outage.
      const circuitOpenFallback = CIRCUIT_OPEN_FALLBACKS[action];
      if (circuitOpenFallback) {
        return res.json({ result: circuitOpenFallback(callArgs), degraded: true });
      }
      return res.status(503).json({ error: 'gemini_circuit_open', message: 'AI temporarily unavailable.' });
    }
    if (err?.code === 'gemini_quota_exceeded') {
      return res.status(429).json({
        error: 'quota_exceeded',
        reason: err.quota?.reason ?? 'requests_exceeded',
        usage: err.quota?.usage,
        limit: err.quota?.limit,
      });
    }
    throw err;
  }

  try {
    const geminiBackend = await import('../../services/geminiBackend.js');
    if (typeof geminiBackend[action as keyof typeof geminiBackend] === 'function') {
      const result = await tracedAsync(
        'gemini.dispatch',
        { tenantId, action },
        () =>
          (geminiBackend[action as keyof typeof geminiBackend] as (
            ...fnArgs: unknown[]
          ) => Promise<unknown>)(...callArgs),
      );
      // B14 — audit the node-sync state changes BEFORE responding (CLAUDE.md
      // #3/#14). Only the identity-stamped actions write state via the Admin
      // SDK (rules-bypassing); the rest are stateless Gemini generation. The
      // audit must never block the user-facing response, so swallow + Sentry on
      // failure (auditServerEvent already returns false on its own errors).
      if (identityStamp) {
        const firstArg = callArgs[0] as { projectId?: unknown } | undefined;
        const auditProjectId =
          firstArg && typeof firstArg.projectId === 'string' ? firstArg.projectId : null;
        try {
          await auditServerEvent(
            req,
            `gemini.${action}`,
            'network',
            { nodeId: (result as { nodeId?: string } | null | undefined)?.nodeId ?? null },
            { projectId: auditProjectId },
          );
        } catch (auditErr) {
          logger.error('audit_event_failed', auditErr as Error, { action });
          sentryCapture(auditErr, { endpoint: '/api/gemini', tags: { action } });
        }
      }
      // Directive #2 — server-side Gemini->degraded fallback for the wired TEXT
      // actions. When a whitelisted text action returns an EMPTY completion
      // (Gemini safety-blocked / non-STOP finish / empty string), surface a REAL
      // degraded answer (RAG -> canned, ADR 0019 §2) instead of `result: ''`.
      // `null` is intentionally NOT treated as empty: it is a valid typed
      // fallback for some actions. The whole attempt is wrapped so a fallback
      // bug can never turn this success path into a 500.
      const resultIsEmpty =
        result === undefined ||
        (typeof result === 'string' && result.trim().length === 0);
      if (resultIsEmpty && hasServerSlmFallback(action)) {
        try {
          const fb = await geminiSlmFallback(action, callArgs);
          if (fb) {
            // The request itself succeeded but Gemini returned an empty body —
            // that is an upstream MISS, so record a breaker FAILURE (ADR 0019)
            // before returning the degraded answer, so sustained empties still
            // trip the circuit.
            recordProviderCall('gemini', 'failure', Date.now() - geminiDispatchStartedAt, action);
            await recordGeminiOutcome(tenantId, 'failure');
            return res.json({ result: fb.text, degraded: true, fallbackTier: fb.tier });
          }
        } catch (fallbackErr) {
          // A fallback bug must NEVER break the (successful) primary path.
          logger.error('gemini_server_fallback_failed', fallbackErr as Error, { action });
          sentryCapture(fallbackErr, { endpoint: '/api/gemini', tags: { action, phase: 'fallback-empty' } });
        }
      }
      res.json({ result });
      // Bucket X: post-call accounting. The whitelisted RPC layer does
      // not return per-call token usage, so we charge a flat estimate
      // based on serialized arg/result size. This is intentionally a
      // ceiling — better to over-charge slightly than to under-meter.
      const argsLen = JSON.stringify(args ?? []).length;
      const resultLen = JSON.stringify(result ?? null).length;
      const tokensIn = Math.ceil(argsLen / 4);
      const tokensOut = Math.ceil(resultLen / 4);
      recordProviderCall('gemini', 'success', Date.now() - geminiDispatchStartedAt, action);
      await recordGeminiOutcome(tenantId, 'success', {
        tokens: tokensIn + tokensOut,
        // Charge at the REAL model the action dispatched to (Bucket X
        // under-billing fix): reasoning/chat/vision actions run on Gemini Pro
        // (~17× Flash), so billing them at Flash under-meters spend and lets a
        // tenant blow past their cost ceiling. `modelForAction` resolves the
        // SKU; unmapped Flash-tier actions keep the AI_MODEL_FAST_STABLE rate.
        costUsd: estimateGeminiCostUsd(modelForAction(action), tokensIn, tokensOut),
      });
    } else {
      res.status(400).json({ error: `Action ${action} not found` });
    }
  } catch (error: any) {
    // B14 — a project-membership denial is a 403 client error (not a server or
    // upstream failure); return it cleanly without polluting failure metrics.
    // `instanceof` is primary; the name check is a defensive fallback in case a
    // module-boundary duplicate ever breaks identity.
    if (error instanceof ProjectMembershipError || error?.name === 'ProjectMembershipError') {
      return res.status(403).json({ error: 'forbidden_project', message: 'No eres miembro del proyecto indicado.' });
    }
    logger.error('gemini_proxy_failed', error, { action });
    sentryCapture(error, { endpoint: '/api/gemini', tags: { method: 'POST', action, tenantId } });
    recordProviderCall('gemini', 'failure', Date.now() - geminiDispatchStartedAt, action);
    await recordGeminiOutcome(tenantId, 'failure');
    // A life-safety action surfaced a usable fallback alongside the upstream
    // failure (e.g. emergency-plan generation). The breaker failure is already
    // recorded above — so the breaker opens and the resilient SLM failover
    // (ADR 0019) engages — but the caller still receives the fallback with HTTP
    // 200 rather than an error. The worker is never left without a plan.
    if (isGeminiDegradedError(error)) {
      return res.json({ result: error.degradedResult, degraded: true });
    }
    // An unparseable/empty upstream body is a bad *gateway* response (502), not
    // an internal bug (500). `parseGeminiJson` throws 'gemini_empty_response' on
    // an empty completion (safety-blocked / non-STOP finish); a malformed body
    // throws SyntaxError. Surface both as 502 so a client can tell "the AI
    // returned garbage" apart from "our server broke" — without leaking internals.
    if (isUpstreamGeminiParseError(error)) {
      // Directive #2 — before surfacing a dry 502, try the server-side degraded
      // ladder (RAG -> canned, ADR 0019 §2) for the wired TEXT actions so the
      // worker gets a REAL answer. The breaker FAILURE was already recorded
      // above (recordGeminiOutcome(tenantId, 'failure')), so the circuit still
      // trips. The attempt is wrapped so a fallback bug can never turn the 502
      // into a 500.
      if (hasServerSlmFallback(action)) {
        try {
          const fb = await geminiSlmFallback(action, callArgs);
          if (fb) {
            return res.json({ result: fb.text, degraded: true, fallbackTier: fb.tier });
          }
        } catch (fallbackErr) {
          logger.error('gemini_server_fallback_failed', fallbackErr as Error, { action });
          sentryCapture(fallbackErr, { endpoint: '/api/gemini', tags: { action, phase: 'fallback-parse-error' } });
        }
      }
      return res.status(502).json({
        error: 'gemini_bad_response',
        message: 'The AI service returned an unparseable response. Please retry.',
      });
    }
    res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
  return undefined;
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sprint 32 Bucket UU — SSE streaming endpoint for AsesorChat.
//
// POST /api/gemini/stream
//   • Streams Gemini chunks back to the browser as Server-Sent Events:
//        data: {"chunk":"...","done":false}\n\n
//        ...
//        data: {"chunk":"","done":true,"totalTokens":N}\n\n
//   • Reuses verifyAuth + geminiLimiter + geminiGlobalDailyLimiter and the
//     Bucket X circuit/quota guard (`assertGeminiAllowed`).
//   • Body validated by Zod (Sprint 28 B3 middleware): `{ prompt, sessionId? }`.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const streamBodySchema = z.object({
  prompt: z.string().min(1).max(8000),
  sessionId: z.string().min(1).max(128).optional(),
});

router.post(
  '/gemini/stream',
  verifyAuth,
  geminiGlobalDailyLimiter,
  geminiLimiter,
  validate(streamBodySchema),
  async (req, res) => {
    const { prompt, sessionId } = req.validated as z.infer<typeof streamBodySchema>;

    // E2E mock — keeps Playwright specs offline-cheap.
    if (
      process.env.E2E_MODE === '1' &&
      process.env.NODE_ENV !== 'production' &&
      typeof req.headers.authorization === 'string' &&
      req.headers.authorization.startsWith('E2E ')
    ) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ chunk: 'E2E mock stream chunk.', done: false })}\n\n`);
      res.write(`data: ${JSON.stringify({ chunk: '', done: true, totalTokens: 6 })}\n\n`);
      res.end();
      return undefined;
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const tenantId: string = req.user?.uid ?? 'unknown';
    const tier: string =
      req.user?.tier ?? req.user?.subscriptionTier ?? 'bronze';
    try {
      await assertGeminiAllowed(tenantId, tier);
    } catch (err: any) {
      if (err?.code === 'gemini_circuit_open') {
        return res
          .status(503)
          .json({ error: 'gemini_circuit_open', message: 'AI temporarily unavailable.' });
      }
      if (err?.code === 'gemini_quota_exceeded') {
        return res.status(429).json({
          error: 'quota_exceeded',
          reason: err.quota?.reason ?? 'requests_exceeded',
          usage: err.quota?.usage,
          limit: err.quota?.limit,
        });
      }
      throw err;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Flush headers immediately so the browser opens the EventSource.
    // `flushHeaders` is typed on http.ServerResponse (express Response extends
    // it); the runtime guard stays defensive for mock `res` doubles in tests.
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    let cancelled = false;
    req.on('close', () => {
      cancelled = true;
    });

    let streamedChars = 0;
    try {
      const responseStream = await ai.models.generateContentStream({
        model: AI_MODEL_CHAT,
        contents: prompt,
      });

      for await (const chunk of responseStream as AsyncIterable<{ text?: string }>) {
        if (cancelled) break;
        const text = chunk.text ?? '';
        if (!text) continue;
        streamedChars += text.length;
        res.write(`data: ${JSON.stringify({ chunk: text, done: false })}\n\n`);
      }

      const inTokens = Math.ceil(prompt.length / 4);
      const outTokens = Math.ceil(streamedChars / 4);
      const totalTokens = inTokens + outTokens;

      if (!cancelled) {
        res.write(`data: ${JSON.stringify({ chunk: '', done: true, totalTokens, sessionId: sessionId ?? null })}\n\n`);
      }
      res.end();
      await recordGeminiOutcome(tenantId, 'success', {
        tokens: totalTokens,
        costUsd: estimateGeminiCostUsd(AI_MODEL_CHAT, inTokens, outTokens),
      });
    } catch (error) {
      logger.error('gemini_stream_failed', error);
      sentryCapture(error, { endpoint: '/api/gemini/stream', tags: { method: 'POST', tenantId } });
      await recordGeminiOutcome(tenantId, 'failure');
      if (!res.headersSent) {
        res.status(500).json({ error: 'stream_failed' });
      } else {
        try {
          res.write(`data: ${JSON.stringify({ error: 'stream_failed', done: true })}\n\n`);
        } catch { /* socket may already be gone */ }
        res.end();
      }
    }
    return undefined;
  },
);

export default router;
