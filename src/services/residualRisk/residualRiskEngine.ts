// Praeventio Guard — Sprint K: Riesgo Residual + Aceptación Formal + Drift Sospechoso.
//
// Cierra: Documento usuario "§296-301"
//
// Después de aplicar controles, queda un "riesgo residual". Este
// servicio:
//   - Calcula riesgo residual = severidad × probabilidad − efecto controles
//   - Exige aceptación formal si residual >= alto (§297)
//   - Reagenda revisión periódica de residuales altos (§298)
//   - Registra historial de cambios de criticidad (§299)
//   - Detecta drift sospechoso: muchos riesgos bajan sin evidencia (§300)
//   - Separa riesgo físico real vs administrativo (§301)
//
// Determinístico — ISO 31000 risk-flow.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type RiskLikelihood = 'rare' | 'unlikely' | 'possible' | 'likely' | 'almost_certain';
export type RiskSeverity = 'negligible' | 'minor' | 'moderate' | 'major' | 'catastrophic';
export type RiskLevel = 'low' | 'medium' | 'high' | 'extreme';

const LIKELIHOOD_VALUE: Record<RiskLikelihood, number> = {
  rare: 1,
  unlikely: 2,
  possible: 3,
  likely: 4,
  almost_certain: 5,
};
const SEVERITY_VALUE: Record<RiskSeverity, number> = {
  negligible: 1,
  minor: 2,
  moderate: 3,
  major: 4,
  catastrophic: 5,
};

export type ControlEffectivenessLevel = 'minimal' | 'partial' | 'significant' | 'full';

const CONTROL_EFFECTIVENESS_REDUCTION: Record<ControlEffectivenessLevel, number> = {
  minimal: 1,
  partial: 4,
  significant: 8,
  full: 14,
};

export interface RiskAssessment {
  riskId: string;
  category: string;
  likelihood: RiskLikelihood;
  severity: RiskSeverity;
  /** Categoría de riesgo: físico real vs solo administrativo. */
  riskKind: 'physical' | 'administrative';
}

export interface AppliedControl {
  controlId: string;
  effectiveness: ControlEffectivenessLevel;
}

export interface ResidualRiskReport {
  riskId: string;
  /** Score inicial = likelihood × severity (1-25). */
  initialScore: number;
  /** Reducción total por controles aplicados. */
  controlReduction: number;
  /** Score residual = max(initialScore - reduction, 1). */
  residualScore: number;
  initialLevel: RiskLevel;
  residualLevel: RiskLevel;
  /** Si requiere aceptación formal (residual >= high). */
  requiresFormalAcceptance: boolean;
  /** Días recomendados hasta próxima revisión periódica. */
  nextReviewInDays: number;
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 15) return 'extreme';
  if (score >= 9) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

export function computeResidualRisk(
  assessment: RiskAssessment,
  controls: AppliedControl[],
): ResidualRiskReport {
  const initialScore =
    LIKELIHOOD_VALUE[assessment.likelihood] * SEVERITY_VALUE[assessment.severity];
  const controlReduction = controls.reduce(
    (sum, c) => sum + CONTROL_EFFECTIVENESS_REDUCTION[c.effectiveness],
    0,
  );
  const residualScore = Math.max(initialScore - controlReduction, 1);
  const initialLevel = scoreToLevel(initialScore);
  const residualLevel = scoreToLevel(residualScore);
  const requiresFormalAcceptance = residualLevel === 'high' || residualLevel === 'extreme';

  const nextReviewInDays =
    residualLevel === 'extreme'
      ? 30
      : residualLevel === 'high'
        ? 90
        : residualLevel === 'medium'
          ? 180
          : 365;

  return {
    riskId: assessment.riskId,
    initialScore,
    controlReduction,
    residualScore,
    initialLevel,
    residualLevel,
    requiresFormalAcceptance,
    nextReviewInDays,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Criticality change history (§299) + drift detection (§300)
// ────────────────────────────────────────────────────────────────────────

export interface CriticalityChangeEvent {
  riskId: string;
  fromLevel: RiskLevel;
  toLevel: RiskLevel;
  changedAt: string;
  changedByUid: string;
  rationale: string;
  /** True si está respaldado por evidencia (nuevos controles vinculados). */
  hasEvidence: boolean;
}

export interface DriftReport {
  totalChanges: number;
  downgrades: number;
  unbackedDowngrades: number;
  /** % de bajadas sin evidencia. */
  unbackedRate: number;
  isSuspicious: boolean;
  message: string;
}

const LEVEL_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, extreme: 3 };

export function detectCriticalityDrift(
  events: CriticalityChangeEvent[],
  windowDays: number = 7,
  nowIso: string = new Date().toISOString(),
): DriftReport {
  const nowMs = Date.parse(nowIso);
  const recent = events.filter(
    (e) => nowMs - Date.parse(e.changedAt) <= windowDays * 86_400_000,
  );

  const downgrades = recent.filter(
    (e) => LEVEL_ORDER[e.toLevel] < LEVEL_ORDER[e.fromLevel],
  );
  const unbackedDowngrades = downgrades.filter((e) => !e.hasEvidence);
  const unbackedRate =
    downgrades.length > 0
      ? Math.round((unbackedDowngrades.length / downgrades.length) * 100)
      : 0;
  /**
   * Sospechoso: >=5 bajadas sin evidencia en la ventana, O >=70% de las
   * bajadas son sin evidencia (si hay >=3 bajadas en total).
   */
  const isSuspicious =
    unbackedDowngrades.length >= 5 || (downgrades.length >= 3 && unbackedRate >= 70);

  let message = `${downgrades.length} bajadas de criticidad en ${windowDays}d, ${unbackedRate}% sin evidencia.`;
  if (isSuspicious) {
    message =
      `Patrón sospechoso: ${unbackedDowngrades.length} riesgos bajaron de criticidad sin evidencia en ${windowDays}d. ` +
      'Revisar si hubo presión por cerrar hallazgos sin controles reales.';
  }

  return {
    totalChanges: recent.length,
    downgrades: downgrades.length,
    unbackedDowngrades: unbackedDowngrades.length,
    unbackedRate,
    isSuspicious,
    message,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Risk classifier (§301) — físico vs administrativo
// ────────────────────────────────────────────────────────────────────────

export interface RiskKindSummary {
  total: number;
  physical: number;
  administrative: number;
  /** Razón principal de los administrativos. */
  topAdminKinds: Array<{ category: string; count: number }>;
  /** Recomendación si >50% son administrativos. */
  recommendation: string;
}

export function classifyRiskKinds(assessments: RiskAssessment[]): RiskKindSummary {
  const total = assessments.length;
  const physical = assessments.filter((r) => r.riskKind === 'physical').length;
  const administrative = total - physical;

  const adminCategories = new Map<string, number>();
  for (const r of assessments) {
    if (r.riskKind === 'administrative') {
      adminCategories.set(r.category, (adminCategories.get(r.category) ?? 0) + 1);
    }
  }
  const topAdminKinds = [...adminCategories.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const adminShare = total > 0 ? administrative / total : 0;
  const recommendation =
    adminShare > 0.5
      ? `${Math.round(adminShare * 100)}% de los "riesgos" son brechas administrativas. Asegúrate de NO desviar foco del riesgo físico real.`
      : 'Mix de riesgos balanceado.';

  return { total, physical, administrative, topAdminKinds, recommendation };
}
