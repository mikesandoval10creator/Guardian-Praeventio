// Praeventio Guard — Sprint 41 Fase F.28: Explicabilidad de Recomendaciones.
//
// Cierra Plan F.28 "Cada output 'porque...' derivado del grafo (B.7)".
//
// Toma una recomendación arbitraria + las evidencias que la
// fundamentan y produce una explicación human-readable trazable:
//   - WHY: lista de hechos del Zettelkasten que la respaldan
//   - WHO: actor responsable (basado en role del nodo)
//   - WHAT: acción concreta sugerida
//   - WHEN: ventana temporal aplicable
//   - DETERMINISTIC vs INFERRED: marca qué partes son reglas duras vs IA
//
// 100% determinístico. Cada hecho se cita con (zk:id) — política
// heredada de la contextualAssistant (C.10).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type EvidenceKind =
  | 'graph_node'
  | 'legal_rule'
  | 'historical_pattern'
  | 'sensor_reading'
  | 'incident_correlation'
  | 'expert_input'
  | 'llm_inference';

export interface Evidence {
  /** ID estable del hecho. */
  id: string;
  kind: EvidenceKind;
  /** Descripción human-readable. */
  description: string;
  /** Cita para mostrar al usuario. (zk:abc) para grafo, (DS-594) para legal, etc. */
  citation: string;
  /** Peso relativo en la decisión (0-1, opcional). */
  weight?: number;
}

export type RecommendationConfidence = 'high' | 'medium' | 'low';

export interface Recommendation {
  id: string;
  /** Texto de la recomendación (qué hacer). */
  action: string;
  /** Quién es responsable. */
  responsibleRole?: string;
  /** Hasta cuándo aplica (ISO o "permanente"). */
  validUntil?: string;
  /** Categoría. */
  category: string;
}

export interface ExplainedRecommendation {
  recommendation: Recommendation;
  /** WHY: hechos que respaldan la recomendación. */
  whyEvidences: Evidence[];
  /** Markdown human-readable con citas. */
  rationaleMarkdown: string;
  confidence: RecommendationConfidence;
  /** Lista de citations únicas para footer. */
  citations: string[];
  /** True si TODA la evidencia es determinística (sin LLM). */
  isFullyDeterministic: boolean;
  /** LLM share redondeado para UI display (2 decimales). */
  llmInferenceShare: number;
  /** LLM share exacto (sin redondeo) — usar para comparaciones de umbrales. */
  llmInferenceShareExact: number;
}

// ────────────────────────────────────────────────────────────────────────
// Confidence inference
// ────────────────────────────────────────────────────────────────────────

const DETERMINISTIC_KINDS: EvidenceKind[] = [
  'graph_node',
  'legal_rule',
  'sensor_reading',
  'historical_pattern',
  'incident_correlation',
  'expert_input',
];

function isDeterministic(e: Evidence): boolean {
  return DETERMINISTIC_KINDS.includes(e.kind);
}

function inferConfidence(
  evidences: Evidence[],
  llmShare: number,
): RecommendationConfidence {
  if (evidences.length === 0) return 'low';
  // High: ≥3 determinísticas + ≤20% LLM
  // Medium: 2+ determinísticas + ≤50% LLM
  // Low: cualquier otro
  const det = evidences.filter(isDeterministic).length;
  if (det >= 3 && llmShare <= 0.2) return 'high';
  if (det >= 2 && llmShare <= 0.5) return 'medium';
  return 'low';
}

// ────────────────────────────────────────────────────────────────────────
// Builder
// ────────────────────────────────────────────────────────────────────────

export interface ExplainInput {
  recommendation: Recommendation;
  evidences: Evidence[];
}

const KIND_LABEL: Record<EvidenceKind, string> = {
  graph_node: 'Nodo del grafo',
  legal_rule: 'Regla legal',
  historical_pattern: 'Patrón histórico',
  sensor_reading: 'Lectura sensor',
  incident_correlation: 'Correlación con incidente',
  expert_input: 'Input experto',
  llm_inference: 'Inferencia IA (sugerida)',
};

export function explainRecommendation(input: ExplainInput): ExplainedRecommendation {
  const { recommendation, evidences } = input;
  // Codex P2 PR #107: si caller proporciona weight, usar weighted share.
  // Sin weights → fallback a count-based.
  const totalWeight = evidences.reduce((s, e) => s + (e.weight ?? 1), 0);
  const llmWeight = evidences
    .filter((e) => e.kind === 'llm_inference')
    .reduce((s, e) => s + (e.weight ?? 1), 0);
  const llmShare = totalWeight > 0 ? llmWeight / totalWeight : 0;
  const llmCount = evidences.filter((e) => e.kind === 'llm_inference').length;
  const confidence = inferConfidence(evidences, llmShare);

  // Build markdown
  let md = `### ${recommendation.action}\n`;
  if (recommendation.responsibleRole) {
    md += `**Responsable**: ${recommendation.responsibleRole}  \n`;
  }
  if (recommendation.validUntil) {
    md += `**Válido hasta**: ${recommendation.validUntil}  \n`;
  }
  md += `**Confianza**: ${confidence.toUpperCase()}`;
  if (llmShare > 0) {
    md += ` (incluye ${Math.round(llmShare * 100)}% inferencia IA)`;
  }
  md += '\n\n';

  if (evidences.length === 0) {
    md += '_Sin evidencias asociadas — recomendación basada únicamente en política._\n';
  } else {
    md += '#### Fundamentos\n';
    for (const e of evidences) {
      const det = isDeterministic(e) ? '✓' : '🤖';
      md += `- ${det} [${KIND_LABEL[e.kind]}] ${e.description} ${e.citation}\n`;
    }
  }

  // Dedupe citations preservando orden
  const seen = new Set<string>();
  const citations: string[] = [];
  for (const e of evidences) {
    if (!seen.has(e.citation)) {
      seen.add(e.citation);
      citations.push(e.citation);
    }
  }

  const isFullyDeterministic = llmCount === 0 && evidences.length > 0;

  return {
    recommendation,
    whyEvidences: evidences,
    rationaleMarkdown: md,
    confidence,
    citations,
    isFullyDeterministic,
    // Codex P2 PR #107: exponemos AMBOS — exact (sin redondeo, para
    // comparaciones precisas en partitionByActionability) y display
    // (redondeado, solo para UI).
    llmInferenceShare: Math.round(llmShare * 100) / 100,
    llmInferenceShareExact: llmShare,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Bulk
// ────────────────────────────────────────────────────────────────────────

export function explainBatch(
  inputs: ExplainInput[],
): ExplainedRecommendation[] {
  return inputs.map(explainRecommendation);
}

// ────────────────────────────────────────────────────────────────────────
// Filter: solo recomendaciones suficientemente respaldadas
// ────────────────────────────────────────────────────────────────────────

/**
 * Las recomendaciones con confidence='low' o llmShare>0.5 NO deberían
 * mostrarse al usuario operativo sin disclaimer adicional. Este helper
 * separa el set en "actionable" vs "needs_review".
 */
export function partitionByActionability(
  explained: ExplainedRecommendation[],
  options: { now?: Date } = {},
): { actionable: ExplainedRecommendation[]; needsReview: ExplainedRecommendation[] } {
  const actionable: ExplainedRecommendation[] = [];
  const needsReview: ExplainedRecommendation[] = [];
  const nowMs = (options.now ?? new Date()).getTime();
  for (const e of explained) {
    // Codex P2 PR #107: recomendaciones expiradas NUNCA son actionable.
    const validUntil = e.recommendation.validUntil;
    if (validUntil && Number.isFinite(Date.parse(validUntil)) && Date.parse(validUntil) < nowMs) {
      needsReview.push(e);
      continue;
    }
    // Codex P2 PR #107: usar llmInferenceShareExact (no redondeado) en el
    // umbral 0.3 para no promover 0.3043 a actionable por redondeo.
    if (
      e.confidence === 'high' ||
      (e.confidence === 'medium' && e.llmInferenceShareExact <= 0.3)
    ) {
      actionable.push(e);
    } else {
      needsReview.push(e);
    }
  }
  return { actionable, needsReview };
}
