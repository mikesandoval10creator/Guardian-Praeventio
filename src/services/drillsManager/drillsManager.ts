// Praeventio Guard — Sprint K: Gestor de Simulacros + Evaluación Preparación.
//
// Cierra: Documento usuario "F.20"
//
// Planifica simulacros (evacuación, derrame, incendio, primeros auxilios)
// y evalúa la preparación de la faena:
//   - Calendario de simulacros obligatorios (DS 132 semestral)
//   - Resultados con tiempo de respuesta vs benchmark
//   - Brechas detectadas
//   - Plan de acción post-simulacro
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type DrillKind =
  | 'evacuation'
  | 'fire'
  | 'spill_chemical'
  | 'first_aid'
  | 'rescue_confined'
  | 'rescue_height'
  | 'gas_leak'
  | 'earthquake';

export interface DrillSchedule {
  id: string;
  kind: DrillKind;
  /** ISO-8601 cuándo se ejecutará. */
  scheduledAt: string;
  /** Frecuencia legal mínima (días). */
  legalFrequencyDays: number;
}

export interface DrillResult {
  id: string;
  drillKind: DrillKind;
  executedAt: string;
  /** Personas participantes. */
  participantCount: number;
  /** Personas esperadas (workers en proyecto). */
  expectedCount: number;
  /** Tiempo de respuesta total (segundos). */
  responseTimeSeconds: number;
  /** Benchmark esperado (segundos). */
  benchmarkSeconds: number;
  /** Brechas observadas. */
  observedGaps: string[];
  /** Si requirió interventión externa. */
  requiredExternal: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Legal frequencies (DS 132 + DS 594)
// ────────────────────────────────────────────────────────────────────────

export const LEGAL_FREQUENCY_DAYS: Record<DrillKind, number> = {
  evacuation: 183, // semestral DS 132
  fire: 183,
  spill_chemical: 365,
  first_aid: 365,
  rescue_confined: 183,
  rescue_height: 183,
  gas_leak: 365,
  earthquake: 365,
};

// ────────────────────────────────────────────────────────────────────────
// Result analysis
// ────────────────────────────────────────────────────────────────────────

export interface DrillReadinessReport {
  drillId: string;
  participationRate: number; // %
  /** Diferencia % vs benchmark (>0 = más lento). */
  speedDeficitPercent: number;
  level: 'excellent' | 'good' | 'needs_improvement' | 'critical';
  recommendations: string[];
}

export function evaluateDrillResult(result: DrillResult): DrillReadinessReport {
  const participationRate =
    result.expectedCount > 0
      ? Math.round((result.participantCount / result.expectedCount) * 100)
      : 0;
  const speedDeficitPercent =
    result.benchmarkSeconds > 0
      ? Math.round(
          ((result.responseTimeSeconds - result.benchmarkSeconds) / result.benchmarkSeconds) * 100,
        )
      : 0;

  let level: DrillReadinessReport['level'];
  if (participationRate >= 90 && speedDeficitPercent <= 20 && result.observedGaps.length === 0) {
    level = 'excellent';
  } else if (
    participationRate >= 80 &&
    speedDeficitPercent <= 40 &&
    result.observedGaps.length <= 2
  ) {
    level = 'good';
  } else if (participationRate >= 60 && speedDeficitPercent <= 80) {
    level = 'needs_improvement';
  } else {
    level = 'critical';
  }

  const recommendations: string[] = [];
  if (participationRate < 80) {
    recommendations.push(`Participación ${participationRate}% — comunicar mejor el simulacro.`);
  }
  if (speedDeficitPercent > 40) {
    recommendations.push(
      `Respuesta ${speedDeficitPercent}% más lenta que benchmark. Re-entrenar.`,
    );
  }
  if (result.observedGaps.length > 0) {
    recommendations.push(`Cerrar brechas: ${result.observedGaps.join('; ')}`);
  }
  if (result.requiredExternal) {
    recommendations.push('Intervención externa requerida — fortalecer capacidad interna.');
  }

  return {
    drillId: result.id,
    participationRate,
    speedDeficitPercent,
    level,
    recommendations,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Compliance calendar
// ────────────────────────────────────────────────────────────────────────

export interface DrillComplianceReport {
  kind: DrillKind;
  lastExecuted?: string;
  /** Fecha que debería ejecutarse el próximo. */
  nextDueAt: string;
  /** Días hasta el próximo. */
  daysUntilDue: number;
  /** True si está atrasado. */
  isOverdue: boolean;
}

export function buildDrillComplianceReport(
  results: DrillResult[],
  nowIso: string = new Date().toISOString(),
): DrillComplianceReport[] {
  const nowMs = Date.parse(nowIso);
  const kinds = Object.keys(LEGAL_FREQUENCY_DAYS) as DrillKind[];

  return kinds.map((kind) => {
    const own = results
      .filter((r) => r.drillKind === kind)
      .sort((a, b) => Date.parse(b.executedAt) - Date.parse(a.executedAt));
    const last = own[0];
    const freq = LEGAL_FREQUENCY_DAYS[kind];
    if (!last) {
      return {
        kind,
        lastExecuted: undefined,
        nextDueAt: new Date(nowMs).toISOString(),
        daysUntilDue: 0,
        isOverdue: true,
      };
    }
    const nextDueMs = Date.parse(last.executedAt) + freq * 86_400_000;
    const daysUntilDue = Math.floor((nextDueMs - nowMs) / 86_400_000);
    return {
      kind,
      lastExecuted: last.executedAt,
      nextDueAt: new Date(nextDueMs).toISOString(),
      daysUntilDue,
      isOverdue: daysUntilDue < 0,
    };
  });
}
