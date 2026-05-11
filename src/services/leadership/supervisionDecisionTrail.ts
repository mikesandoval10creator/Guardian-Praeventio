// Praeventio Guard — Sprint K: Historial de Decisiones de Supervisión + Ranking.
//
// Cierra: Documento usuario "§276-277"
//
// Registra decisiones de los supervisores durante la jornada para:
//   - Trazabilidad real de liderazgo preventivo
//   - Ranking de decisiones de alto impacto (qué evitó más riesgos)
//   - NO castigar — aprender qué tipo de decisión preventiva tiene mayor
//     impacto en la reducción de incidentes.
//
// Determinístico. Métricas simples sobre el log.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SupervisionDecisionKind =
  | 'authorize_work'        // autorizó iniciar una tarea
  | 'stop_task'             // detuvo una tarea
  | 'change_crew'           // cambió la cuadrilla asignada
  | 'change_method'         // cambió el método de trabajo
  | 'reject_unsafe'         // rechazó una condición insegura
  | 'request_resource'      // solicitó recurso adicional
  | 'escalate_finding'      // escaló hallazgo
  | 'approve_exception'     // aprobó excepción (link al exceptionEngine)
  | 'reject_exception';

export interface SupervisionDecision {
  id: string;
  supervisorUid: string;
  /** ISO-8601. */
  decidedAt: string;
  kind: SupervisionDecisionKind;
  /** Descripción libre del contexto. */
  context: string;
  /** Tarea / hallazgo / trabajador involucrado. */
  involvedRef?: { kind: 'TASK' | 'WORKER' | 'FINDING' | 'EXCEPTION'; id: string };
  /** Justificación. */
  rationale: string;
  /** Resultado observado posteriormente (opcional, llenado a posteriori). */
  outcome?: {
    /** Si el outcome fue positivo (evitó algo). */
    positive: boolean;
    /** Descripción del outcome. */
    description: string;
    /** ISO-8601 cuando se registró. */
    recordedAt: string;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Impact scoring
// ────────────────────────────────────────────────────────────────────────

/**
 * Cada kind tiene un peso base por el "valor preventivo" típico.
 * Decisiones que detienen riesgo activo (stop_task, reject_unsafe) valen
 * más que las administrativas.
 */
const KIND_IMPACT_WEIGHT: Record<SupervisionDecisionKind, number> = {
  stop_task: 25,
  reject_unsafe: 30,
  escalate_finding: 18,
  change_method: 15,
  change_crew: 10,
  request_resource: 12,
  authorize_work: 5, // útil pero menos valor preventivo individual
  approve_exception: 8,
  reject_exception: 22,
};

export interface ImpactScore {
  decisionId: string;
  baseWeight: number;
  /** +5 si tuvo outcome positivo registrado. */
  outcomeBonus: number;
  /** Total. */
  totalScore: number;
}

export function scoreDecisionImpact(decision: SupervisionDecision): ImpactScore {
  const baseWeight = KIND_IMPACT_WEIGHT[decision.kind];
  const outcomeBonus = decision.outcome?.positive ? 5 : 0;
  return {
    decisionId: decision.id,
    baseWeight,
    outcomeBonus,
    totalScore: baseWeight + outcomeBonus,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Rankings (§277)
// ────────────────────────────────────────────────────────────────────────

export interface SupervisorRanking {
  supervisorUid: string;
  totalDecisions: number;
  byKind: Record<SupervisionDecisionKind, number>;
  totalImpactScore: number;
  /** % de decisiones con outcome positivo registrado. */
  positiveOutcomeRate: number;
}

export function rankSupervisorsByImpact(
  decisions: SupervisionDecision[],
): SupervisorRanking[] {
  const map = new Map<string, SupervisorRanking>();

  for (const d of decisions) {
    let entry = map.get(d.supervisorUid);
    if (!entry) {
      entry = {
        supervisorUid: d.supervisorUid,
        totalDecisions: 0,
        byKind: {
          stop_task: 0,
          reject_unsafe: 0,
          escalate_finding: 0,
          change_method: 0,
          change_crew: 0,
          request_resource: 0,
          authorize_work: 0,
          approve_exception: 0,
          reject_exception: 0,
        },
        totalImpactScore: 0,
        positiveOutcomeRate: 0,
      };
      map.set(d.supervisorUid, entry);
    }
    entry.totalDecisions += 1;
    entry.byKind[d.kind] += 1;
    entry.totalImpactScore += scoreDecisionImpact(d).totalScore;
  }

  // Calcular tasa de outcome positivo
  for (const [uid, entry] of map) {
    const own = decisions.filter((d) => d.supervisorUid === uid);
    const withOutcome = own.filter((d) => d.outcome);
    const positive = own.filter((d) => d.outcome?.positive);
    entry.positiveOutcomeRate =
      withOutcome.length > 0 ? Math.round((positive.length / withOutcome.length) * 100) : 0;
  }

  return [...map.values()].sort((a, b) => b.totalImpactScore - a.totalImpactScore);
}

// ────────────────────────────────────────────────────────────────────────
// Aggregate decision analytics
// ────────────────────────────────────────────────────────────────────────

export interface DecisionTrailSummary {
  total: number;
  byKind: Record<SupervisionDecisionKind, number>;
  /** Top 5 decisiones de mayor impacto. */
  topImpactDecisions: Array<{ decision: SupervisionDecision; score: number }>;
  /** Decisiones con outcome registrado. */
  withOutcome: number;
  /** % con outcome positivo. */
  positiveOutcomeRate: number;
}

export function summarizeDecisionTrail(
  decisions: SupervisionDecision[],
): DecisionTrailSummary {
  const byKind: Record<SupervisionDecisionKind, number> = {
    stop_task: 0,
    reject_unsafe: 0,
    escalate_finding: 0,
    change_method: 0,
    change_crew: 0,
    request_resource: 0,
    authorize_work: 0,
    approve_exception: 0,
    reject_exception: 0,
  };
  for (const d of decisions) byKind[d.kind] += 1;

  const scored = decisions
    .map((d) => ({ decision: d, score: scoreDecisionImpact(d).totalScore }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const withOutcome = decisions.filter((d) => d.outcome).length;
  const positive = decisions.filter((d) => d.outcome?.positive).length;
  const positiveOutcomeRate =
    withOutcome > 0 ? Math.round((positive / withOutcome) * 100) : 0;

  return {
    total: decisions.length,
    byKind,
    topImpactDecisions: scored,
    withOutcome,
    positiveOutcomeRate,
  };
}
