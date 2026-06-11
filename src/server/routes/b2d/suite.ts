// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB.6 — B2D Suite tier API.
//
// Mounted via `app.use('/api/b2d/v1/suite', suiteRouter)`.
//
// Endpoint:
//   • POST /api/b2d/v1/suite/coach   — AI safety coach (suite.all scope)
//
// CRITICAL — privacy boundary:
//   The coach NEVER reads the Praeventio Zettelkasten. It operates ONLY
//   on the input the integrator passes in the request body. The coach is
//   a pure function from `(industry, scenario, mitigations) → guidance`
//   with citations. No tenant-scoped data is ever loaded.
//
//   This isolation is non-negotiable: API key holders are NOT tenants;
//   they are integrators. They have ZERO visibility into the Zettelkasten,
//   per `PRICING.md §9.3` and `aiTier.ts` ZETTELKASTEN_BOUNDARY.
//
// §2.17 (cierre Fase C.5, 2026-05-21):
//   Antes este endpoint era 100% determinístico, contradiciendo la promesa
//   marketing "Gemini AI Coach". Ahora intenta Gemini primero (vía el
//   `getAiAdapter()` facade que respeta `AI_ADAPTER` env + flags
//   `AI_ROUTE_LATAM_TO_VERTEX`); si Gemini no está disponible (noop
//   adapter) o falla en runtime (timeout, parse error, etc.), CAE
//   GRACEFULLY al builder determinístico — Regla #3 inviolable del
//   TODO.md: PRODUCIR la solución, no etiquetarla como "no disponible".
//
//   El shape de la response NO cambia: el cliente B2D recibe siempre el
//   mismo JSON con `result.recommendation` + `result.structuredActions` +
//   `citations` + `privacyNote`. Se agrega `source: 'gemini-consumer' |
//   'vertex-ai' | 'deterministic'` para transparencia (auditable).

import { Router } from 'express';
import { z } from 'zod';

import { b2dAuth } from '../../middleware/b2dAuth.js';
import { trackB2dUsage } from '../../../services/b2d/usage.js';
import { getAiAdapter } from '../../../services/ai/index.js';
import { logger } from '../../../utils/logger.js';
import { AI_MODEL_FAST } from '../../../config/aiModels.js';

const router = Router();

const CoachSchema = z.object({
  industry: z.string().min(1).max(64),
  scenario: z.string().min(1).max(2000),
  riskCategory: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  language: z.enum(['es', 'en', 'pt']).default('es'),
  mitigations: z.array(z.string()).default([]),
});

type CoachInput = z.infer<typeof CoachSchema>;

interface CoachGuidance {
  industry: string;
  scenario: string;
  riskCategory: CoachInput['riskCategory'];
  language: CoachInput['language'];
  mitigationsConsidered: number;
  recommendation: string;
  structuredActions: Array<{ step: number; action: string }>;
}

interface GeminiCoachResult {
  recommendation: string;
  structuredActions: Array<{ step: number; action: string }>;
  citations: string[];
}

/**
 * Citas legales canónicas que SIEMPRE aparecen en la respuesta, además
 * de las que el modelo Gemini agregue. Se ordenan por relevancia chilena
 * + ISO internacional. DS 44/2024 reemplaza al DS 40/1969 derogado el
 * 2025-02-01 (directiva legal H26).
 */
const CANONICAL_CITATIONS = [
  'ISO 45001:2018',
  'DS 594/1999 (condiciones sanitarias y ambientales)',
  'DS 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01)',
  'DS 54/1969 (Comité Paritario > 25 trabajadores)',
  'Ley 16.744 (seguro accidentes del trabajo)',
];

const LANGUAGE_LABELS: Record<CoachInput['language'], string> = {
  es: 'español',
  en: 'English',
  pt: 'português brasileiro',
};

/**
 * Builder determinístico de guidance — used as fallback when Gemini no
 * está disponible. Identical to the pre-§2.17 behaviour: una recomendación
 * estructurada en 3 + 1 frases derivada del input. NO toca red ni IA.
 */
function buildCoachGuidance(input: CoachInput): CoachGuidance {
  const { industry, scenario, riskCategory, mitigations, language } = input;
  const baseRecommendations = [
    'Asegurar que la matriz IPER cubra el escenario descrito.',
    'Verificar disponibilidad de EPP específico para la industria.',
    'Documentar la cadena de mando para escalamiento de emergencia.',
  ];
  const riskTrailer =
    riskCategory === 'critical' || riskCategory === 'high'
      ? 'Activar plan de respuesta inmediata y notificar al Comité Paritario.'
      : 'Programar revisión preventiva en próximo ciclo mensual.';

  return {
    industry,
    scenario,
    riskCategory,
    language,
    mitigationsConsidered: mitigations.length,
    recommendation: [...baseRecommendations, riskTrailer].join(' '),
    structuredActions: baseRecommendations.map((r, idx) => ({
      step: idx + 1,
      action: r,
    })),
  };
}

/**
 * Build the Gemini prompt + system instruction respetando:
 *  - directiva 2.6 (no push automático a APIs estatales — solo recomendar).
 *  - privacidad B2D (no menciones Zettelkasten ni datos internos).
 *  - directiva legal (DS 44/2024 vigente, DS 40 derogado con anotación
 *    histórica si se menciona — guardrail runtime en
 *    `hallucinationGuard.ts:89-91` actúa como segunda línea).
 */
function buildGeminiPrompts(input: CoachInput): {
  systemInstruction: string;
  prompt: string;
} {
  const langLabel = LANGUAGE_LABELS[input.language];
  const systemInstruction =
    `Eres un asistente experto en prevención de riesgos laborales para ` +
    `Chile y LATAM. Cumples con DS 44/2024 (reemplaza DS 40/1969 derogado ` +
    `2025-02-01), DS 54, DS 594, Ley 16.744 e ISO 45001:2018. ` +
    `Responde en ${langLabel}, citando normas específicas cuando aplique. ` +
    `NUNCA recomiendas invocar APIs estatales (SUSESO/SII/MINSAL/OSHA) ` +
    `directamente — solo recomienda que el usuario gestione el trámite. ` +
    `NUNCA accedes a datos del tenant ni al Zettelkasten interno. ` +
    `Responde SIEMPRE en JSON válido con la estructura solicitada.`;

  const mitigList =
    input.mitigations.length > 0 ? input.mitigations.join('; ') : '(ninguna)';
  const prompt =
    `INDUSTRIA: ${input.industry}\n` +
    `ESCENARIO: ${input.scenario}\n` +
    `CATEGORÍA DE RIESGO: ${input.riskCategory}\n` +
    `MITIGACIONES YA APLICADAS: ${mitigList}\n\n` +
    `Devuelve EXACTAMENTE este JSON (sin texto fuera del objeto):\n` +
    `{\n` +
    `  "recommendation": "<una frase concisa con la recomendación principal>",\n` +
    `  "structuredActions": [\n` +
    `    { "step": 1, "action": "<acción concreta 1>" },\n` +
    `    { "step": 2, "action": "<acción concreta 2>" },\n` +
    `    { "step": 3, "action": "<acción concreta 3>" }\n` +
    `  ],\n` +
    `  "citations": ["<norma específica 1>", "<norma específica 2>"]\n` +
    `}`;

  return { systemInstruction, prompt };
}

/**
 * Intenta generar la guidance via Gemini (o el adapter activo via
 * `getAiAdapter()`). Devuelve `null` si:
 *  - el adapter es `noop` (sin GEMINI_API_KEY configurado),
 *  - la llamada falla (timeout, network, etc.),
 *  - la respuesta no parsea como el JSON esperado.
 *
 * En cualquier caso de `null`, el caller cae al builder determinístico.
 * NUNCA lanza — la promesa marketing es que el endpoint responde, no
 * que use exactamente Gemini.
 */
async function tryBuildWithGemini(input: CoachInput): Promise<
  { result: GeminiCoachResult; provider: 'gemini-consumer' | 'vertex-ai' } | null
> {
  const adapter = getAiAdapter();
  if (!adapter.isAvailable || adapter.name === 'noop') {
    return null;
  }

  const { systemInstruction, prompt } = buildGeminiPrompts(input);
  try {
    const response = await adapter.generate({
      model: AI_MODEL_FAST,
      prompt,
      systemInstruction,
      temperature: 0.3,
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
    });

    const text = response.text?.trim() ?? '';
    if (!text) {
      logger.warn('b2d_coach_gemini_empty_text', { provider: adapter.name });
      return null;
    }

    const parsed = JSON.parse(text) as Partial<GeminiCoachResult>;
    if (
      typeof parsed.recommendation !== 'string' ||
      !Array.isArray(parsed.structuredActions) ||
      !Array.isArray(parsed.citations)
    ) {
      logger.warn('b2d_coach_gemini_invalid_shape', {
        provider: adapter.name,
        keys: Object.keys(parsed),
      });
      return null;
    }

    // Sanitizar structuredActions a forma estricta { step, action }.
    const cleanActions = parsed.structuredActions
      .filter(
        (a): a is { step: number; action: string } =>
          typeof a === 'object' &&
          a !== null &&
          typeof (a as { step: unknown }).step === 'number' &&
          typeof (a as { action: unknown }).action === 'string',
      )
      .slice(0, 8); // hard cap defensivo
    const cleanCitations = parsed.citations
      .filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length < 200)
      .slice(0, 12);

    if (cleanActions.length === 0) {
      // Sin acciones, mejor cae al deterministic builder.
      return null;
    }

    return {
      result: {
        recommendation: parsed.recommendation,
        structuredActions: cleanActions,
        citations: cleanCitations,
      },
      provider: adapter.name as 'gemini-consumer' | 'vertex-ai',
    };
  } catch (err) {
    logger.warn('b2d_coach_gemini_failed', {
      provider: adapter.name,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

router.post('/coach', b2dAuth('suite.all'), async (req, res) => {
  const parsed = CoachSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', issue: parsed.error.flatten() });
  }

  const customerId = req.b2dKey?.customerId as string;
  await trackB2dUsage(customerId);

  // §2.17 — tier 1: try Gemini (or active adapter via facade).
  const gemini = await tryBuildWithGemini(parsed.data);
  if (gemini) {
    const guidance: CoachGuidance = {
      industry: parsed.data.industry,
      scenario: parsed.data.scenario,
      riskCategory: parsed.data.riskCategory,
      language: parsed.data.language,
      mitigationsConsidered: parsed.data.mitigations.length,
      recommendation: gemini.result.recommendation,
      structuredActions: gemini.result.structuredActions,
    };
    // Merge citations: las del modelo primero, deduplicado vs canónicas.
    const merged = [...gemini.result.citations];
    for (const c of CANONICAL_CITATIONS) {
      if (!merged.some((m) => m.toLowerCase().includes(c.toLowerCase().slice(0, 12)))) {
        merged.push(c);
      }
    }
    return res.json({
      result: guidance,
      citations: merged.slice(0, 15),
      source: gemini.provider,
      privacyNote:
        'AI Coach opera SOLO sobre el input de este request. No accede al Zettelkasten ni a datos del tenant.',
      computedAt: new Date().toISOString(),
    });
  }

  // §2.17 — tier 2: deterministic fallback (Regla #3 — producir solución).
  const guidance = buildCoachGuidance(parsed.data);
  return res.json({
    result: guidance,
    citations: [...CANONICAL_CITATIONS, 'Praeventio Coach v1 (deterministic fallback)'],
    source: 'deterministic',
    privacyNote:
      'AI Coach opera SOLO sobre el input de este request. No accede al Zettelkasten ni a datos del tenant.',
    computedAt: new Date().toISOString(),
  });
});

export default router;
