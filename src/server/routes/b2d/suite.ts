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

import { Router } from 'express';
import { z } from 'zod';

import { b2dAuth } from '../../middleware/b2dAuth.js';
import { trackB2dUsage } from '../../../services/b2d/usage.js';

const router = Router();

const CoachSchema = z.object({
  industry: z.string().min(1).max(64),
  scenario: z.string().min(1).max(2000),
  riskCategory: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  language: z.enum(['es', 'en', 'pt']).default('es'),
  mitigations: z.array(z.string()).default([]),
});

/**
 * Deterministic coach response. The Gemini wiring lives behind the
 * ai-tier abstraction; for the public B2D surface we ship a structured
 * recommendation derived from the input + a citations list. This keeps
 * privacy guarantees auditable: there is literally no path from this
 * handler to tenant Zettelkasten data.
 */
function buildCoachGuidance(input: z.infer<typeof CoachSchema>) {
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

router.post('/coach', b2dAuth('suite.all'), async (req, res) => {
  const parsed = CoachSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', issue: parsed.error.flatten() });
  }

  const guidance = buildCoachGuidance(parsed.data);
  const customerId = req.b2dKey?.customerId as string;
  await trackB2dUsage(customerId);

  return res.json({
    result: guidance,
    citations: ['ISO 45001:2018', 'DS 594/1999', 'Praeventio Coach v1'],
    privacyNote:
      'AI Coach opera SOLO sobre el input de este request. No accede al Zettelkasten ni a datos del tenant.',
    computedAt: new Date().toISOString(),
  });
});

export default router;
