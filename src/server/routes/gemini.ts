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
import { verifyAuth } from '../middleware/verifyAuth.js';
import { geminiLimiter } from '../middleware/limiters.js';

const ALLOWED_GEMINI_ACTIONS = [
  'generateEmbeddingsBatch',
  'autoConnectNodes',
  'semanticSearch',
  'analyzeFastCheck',
  'predictGlobalIncidents',
  'analyzeRiskWithAI',
  'analyzePostureWithAI',
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
  'analyzeBioImage',
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

const router = Router();

// Ask Guardian Endpoint (El Cerebro Externo).
// NOTE: original server.ts wired this without `geminiLimiter` — the global
// /api/* limiter is the only rate cap here. Preserving that behavior verbatim
// in the split. Adding `geminiLimiter` would be an unrelated security tweak.
router.post('/ask-guardian', verifyAuth, async (req, res) => {
  const { query, stream = false } = req.body;

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Unified context search using Firestore Vector Search
    const { searchRelevantContext } = await import('../../services/ragService.js');
    const context = await searchRelevantContext(query);

    // Generate response using Gemini
    const prompt = `
      Eres "El Guardián", el núcleo de inteligencia artificial de Praeventio Guard.
      Tu propósito es proteger la vida humana, analizar normativas (leyes chilenas como DS 594, Ley 16.744) y gestionar riesgos.
      Responde de forma profesional, vigilante y altamente técnica pero accionable.

      REGLA DE ORO: Si el usuario te pregunta por procedimientos específicos o leyes, prioritiza la información en el CONTEXTO LEGAL proporcionado.
      Si no hay información específica en el contexto, usa tu base de conocimientos pero aclara que es una recomendación general.

      CONTEXTO LEGAL RELEVANTE:
      ${context}

      PREGUNTA DEL USUARIO:
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

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const result = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
      });

      res.json({
        response: result.text,
        contextUsed: context !== 'No se encontró contexto legal relevante.',
      });
    }
  } catch (error) {
    console.error('Error in /api/ask-guardian:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`);
      res.end();
    }
  }
});

// Gemini API Proxy
router.post('/gemini', verifyAuth, geminiLimiter, async (req, res) => {
  const { action, args } = req.body;

  if (!ALLOWED_GEMINI_ACTIONS.includes(action)) {
    return res.status(403).json({ error: `Forbidden: Action ${action} is not allowed` });
  }

  try {
    const geminiBackend = await import('../../services/geminiBackend.js');
    if (typeof geminiBackend[action as keyof typeof geminiBackend] === 'function') {
      const result = await (geminiBackend[action as keyof typeof geminiBackend] as Function)(...args);
      res.json({ result });
    } else {
      res.status(400).json({ error: `Action ${action} not found` });
    }
  } catch (error: any) {
    console.error(`Error in Gemini API Proxy for ${action}:`, error);
    res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
});

export default router;
