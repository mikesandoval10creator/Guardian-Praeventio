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
      ${query}
    `;

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-3.1-pro-preview',
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
        costUsd: estimateGeminiCostUsd('gemini-3.1-pro-preview', inTokens, streamedTokens),
      });
    } else {
      const result = await tracedAsync(
        'ask-guardian.generateContent',
        { tenantId, projectId: typeof projectId === 'string' ? projectId : null, model: 'gemini-3.1-pro-preview' },
        () => ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          contents: prompt,
        }),
      );

      res.json({
        response: result.text,
        contextUsed: context !== 'No se encontró contexto legal relevante.',
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
        costUsd: estimateGeminiCostUsd('gemini-3.1-pro-preview', tokensIn, tokensOut),
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
      res.json({ result });
      // Bucket X: post-call accounting. The whitelisted RPC layer does
      // not return per-call token usage, so we charge a flat estimate
      // based on serialized arg/result size. This is intentionally a
      // ceiling — better to over-charge slightly than to under-meter.
      const argsLen = JSON.stringify(args ?? []).length;
      const resultLen = JSON.stringify(result ?? null).length;
      const tokensIn = Math.ceil(argsLen / 4);
      const tokensOut = Math.ceil(resultLen / 4);
      await recordGeminiOutcome(tenantId, 'success', {
        tokens: tokensIn + tokensOut,
        // Most RPCs use Flash internally; Pro is reserved for the
        // ask-guardian path. Use Flash pricing as the default.
        costUsd: estimateGeminiCostUsd('gemini-2.0-flash', tokensIn, tokensOut),
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
        model: 'gemini-3.1-pro-preview',
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
        costUsd: estimateGeminiCostUsd('gemini-3.1-pro-preview', inTokens, outTokens),
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
