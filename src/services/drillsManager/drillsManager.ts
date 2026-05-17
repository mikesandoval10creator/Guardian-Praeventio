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
  /**
   * Personas esperadas (workers en proyecto). Optional: si la planificación
   * no incluyó un baseline real, NO se asume `participantCount` — la
   * evaluación reporta `insufficient_baseline` en su lugar para no
   * inflar la participación a 100% artificialmente. (Codex PR #316 P2.)
   */
  expectedCount?: number;
  /** Tiempo de respuesta total (segundos). */
  responseTimeSeconds: number;
  /**
   * Benchmark esperado (segundos). Optional por la misma razón que
   * `expectedCount`: sin baseline real no se puede gradear velocidad.
   */
  benchmarkSeconds?: number;
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

export type DrillReadinessLevel =
  | 'excellent'
  | 'good'
  | 'needs_improvement'
  | 'critical'
  /**
   * Sin baseline real para gradear: la planificación omitió
   * `expectedCount` y/o `benchmarkSeconds`, así que no podemos calcular
   * participación o velocidad sin inflar artificialmente el resultado a
   * 100%. La UI muestra "Baseline insuficiente" y pide volver al plan a
   * registrar los valores reales. (Codex PR #316 P2.)
   */
  | 'insufficient_baseline';

export interface DrillReadinessReport {
  drillId: string;
  /** % de participación. `null` si no se proveyó baseline (`expectedCount`). */
  participationRate: number | null;
  /**
   * Diferencia % vs benchmark (>0 = más lento). `null` si no se proveyó
   * baseline (`benchmarkSeconds`).
   */
  speedDeficitPercent: number | null;
  level: DrillReadinessLevel;
  recommendations: string[];
}

export function evaluateDrillResult(result: DrillResult): DrillReadinessReport {
  // Codex PR #316 P2 (line 1300): no asumimos baselines. Si la
  // planificación omitió `expectedCount` o `benchmarkSeconds` (y la
  // ejecución tampoco los aportó), reportamos `insufficient_baseline`
  // con una recomendación explícita. Antes esto se gradeaba como
  // "excellent" porque participación = 100% y déficit = 0% por default.
  const hasParticipationBaseline =
    typeof result.expectedCount === 'number' && result.expectedCount > 0;
  const hasSpeedBaseline =
    typeof result.benchmarkSeconds === 'number' && result.benchmarkSeconds > 0;

  if (!hasParticipationBaseline || !hasSpeedBaseline) {
    const missing: string[] = [];
    if (!hasParticipationBaseline) missing.push('participantes esperados');
    if (!hasSpeedBaseline) missing.push('tiempo benchmark');
    const recommendations: string[] = [
      `Baseline insuficiente: falta ${missing.join(' y ')}. Edita el plan del simulacro y registra ${missing.length > 1 ? 'estos valores' : 'este valor'} antes de gradear el resultado.`,
    ];
    if (result.observedGaps.length > 0) {
      recommendations.push(`Cerrar brechas: ${result.observedGaps.join('; ')}`);
    }
    if (result.requiredExternal) {
      recommendations.push('Intervención externa requerida — fortalecer capacidad interna.');
    }
    return {
      drillId: result.id,
      participationRate: hasParticipationBaseline
        ? Math.round((result.participantCount / (result.expectedCount as number)) * 100)
        : null,
      speedDeficitPercent: hasSpeedBaseline
        ? Math.round(
            ((result.responseTimeSeconds - (result.benchmarkSeconds as number)) /
              (result.benchmarkSeconds as number)) *
              100,
          )
        : null,
      level: 'insufficient_baseline',
      recommendations,
    };
  }

  const participationRate = Math.round(
    (result.participantCount / (result.expectedCount as number)) * 100,
  );
  const speedDeficitPercent = Math.round(
    ((result.responseTimeSeconds - (result.benchmarkSeconds as number)) /
      (result.benchmarkSeconds as number)) *
      100,
  );

  let level: DrillReadinessLevel;
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
