// Praeventio Guard — Sprint K: Encuesta percepción + índice cultura + reconocimiento.
//
// Cierra: Documento usuario "§61-63"
//
// Pulse periódico (mensual / trimestral) de la cultura preventiva:
//   - Encuesta de percepción (5 preguntas tipo Likert 1-5)
//   - Índice agregado por proyecto/area/rol
//   - Detección de baja percepción que predice incidentes
//   - Bandera de "punitive culture" si las respuestas indican miedo a reportar
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type PulseQuestionKey =
  | 'felt_safe_today'
  | 'manager_listens'
  | 'free_to_stop'
  | 'reported_incident_safely'
  | 'has_resources_to_be_safe';

export interface PulseSurveyResponse {
  /** ID anonimizado del respondedor (hash). */
  responderHash: string;
  workerRole: string;
  /** Sector / área. */
  area: string;
  /** Respuestas en escala Likert 1-5 (5=fuerte acuerdo). */
  answers: Record<PulseQuestionKey, number>;
  /** ISO-8601. */
  submittedAt: string;
}

const QUESTIONS_META: Record<PulseQuestionKey, { weight: number; punitiveFlagThreshold: number }> = {
  felt_safe_today: { weight: 1, punitiveFlagThreshold: 2 },
  manager_listens: { weight: 1.5, punitiveFlagThreshold: 2 },
  free_to_stop: { weight: 2, punitiveFlagThreshold: 2 }, // crítico: si bajo, cultura punitiva
  reported_incident_safely: { weight: 2, punitiveFlagThreshold: 2 },
  has_resources_to_be_safe: { weight: 1.5, punitiveFlagThreshold: 2 },
};

// ────────────────────────────────────────────────────────────────────────
// Pulse index
// ────────────────────────────────────────────────────────────────────────

export interface PulseIndexReport {
  totalResponses: number;
  /** Índice 0-100. */
  cultureIndex: number;
  level: 'low' | 'fair' | 'good' | 'strong';
  /** Score promedio por pregunta. */
  byQuestion: Record<PulseQuestionKey, number>;
  /** True si el pulse sugiere cultura punitiva. */
  punitiveCulturedFlagged: boolean;
}

export function computePulseIndex(responses: PulseSurveyResponse[]): PulseIndexReport {
  if (responses.length === 0) {
    return {
      totalResponses: 0,
      cultureIndex: 0,
      level: 'low',
      byQuestion: {
        felt_safe_today: 0,
        manager_listens: 0,
        free_to_stop: 0,
        reported_incident_safely: 0,
        has_resources_to_be_safe: 0,
      },
      punitiveCulturedFlagged: false,
    };
  }

  const sums: Record<PulseQuestionKey, number> = {
    felt_safe_today: 0,
    manager_listens: 0,
    free_to_stop: 0,
    reported_incident_safely: 0,
    has_resources_to_be_safe: 0,
  };

  for (const r of responses) {
    for (const key of Object.keys(sums) as PulseQuestionKey[]) {
      sums[key] += r.answers[key] ?? 0;
    }
  }

  const byQuestion = Object.fromEntries(
    (Object.keys(sums) as PulseQuestionKey[]).map((k) => [
      k,
      Math.round((sums[k] / responses.length) * 10) / 10,
    ]),
  ) as Record<PulseQuestionKey, number>;

  // Index ponderado: cada respuesta se normaliza 1-5 → 0-100
  let totalWeightedScore = 0;
  let totalWeight = 0;
  for (const [key, meta] of Object.entries(QUESTIONS_META) as Array<[PulseQuestionKey, typeof QUESTIONS_META[PulseQuestionKey]]>) {
    const avg = byQuestion[key];
    const normalizedScore = ((avg - 1) / 4) * 100; // 1→0, 5→100
    totalWeightedScore += normalizedScore * meta.weight;
    totalWeight += meta.weight;
  }
  const cultureIndex = Math.round(totalWeightedScore / totalWeight);

  // Punitive flag: si free_to_stop O reported_incident_safely están bajo umbral
  const punitiveCulturedFlagged =
    byQuestion.free_to_stop < QUESTIONS_META.free_to_stop.punitiveFlagThreshold ||
    byQuestion.reported_incident_safely <
      QUESTIONS_META.reported_incident_safely.punitiveFlagThreshold;

  let level: 'low' | 'fair' | 'good' | 'strong';
  if (cultureIndex < 40) level = 'low';
  else if (cultureIndex < 60) level = 'fair';
  else if (cultureIndex < 80) level = 'good';
  else level = 'strong';

  return {
    totalResponses: responses.length,
    cultureIndex,
    level,
    byQuestion,
    punitiveCulturedFlagged,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Area drill-down
// ────────────────────────────────────────────────────────────────────────

export interface AreaPulse {
  area: string;
  index: PulseIndexReport;
}

export function buildAreaPulses(responses: PulseSurveyResponse[]): AreaPulse[] {
  const byArea = new Map<string, PulseSurveyResponse[]>();
  for (const r of responses) {
    if (!byArea.has(r.area)) byArea.set(r.area, []);
    byArea.get(r.area)!.push(r);
  }
  return [...byArea.entries()]
    .map(([area, list]) => ({ area, index: computePulseIndex(list) }))
    .sort((a, b) => a.index.cultureIndex - b.index.cultureIndex);
}

// ────────────────────────────────────────────────────────────────────────
// Trend over time
// ────────────────────────────────────────────────────────────────────────

export interface PulseTrendPoint {
  periodLabel: string;
  index: number;
  responses: number;
}

export function buildPulseTrend(
  responses: PulseSurveyResponse[],
  periodFn: (iso: string) => string = (iso) => iso.slice(0, 7),
): PulseTrendPoint[] {
  const byPeriod = new Map<string, PulseSurveyResponse[]>();
  for (const r of responses) {
    const key = periodFn(r.submittedAt);
    if (!byPeriod.has(key)) byPeriod.set(key, []);
    byPeriod.get(key)!.push(r);
  }
  return [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodLabel, list]) => {
      const idx = computePulseIndex(list);
      return { periodLabel, index: idx.cultureIndex, responses: list.length };
    });
}
