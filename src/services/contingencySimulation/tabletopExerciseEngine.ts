// Praeventio Guard — Sprint 52: Tabletop Exercise Engine (§242).
//
// Cierra: Documento usuario 2da tanda "§242 Incident simulation tabletop".
//
// Toma un ContingencyScenario (de contingencyScenarioBuilder) + las respuestas
// del equipo durante un ejercicio tabletop, y devuelve evaluación con:
//   - puntaje (% correctas)
//   - tiempo de reacción promedio (minutos)
//   - puntos débiles
//   - recomendaciones
//   - pasa / no pasa (≥70%)
//
// NO bloquea operación — sólo evalúa preparación.
// NO transfiere panic-mode externo: las recomendaciones son tranquilas.
//
// Determinístico, sin LLM.

import type { ContingencyScenario, ScenarioDecisionPoint } from './contingencyScenarioBuilder.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface TabletopResponse {
  /** Minuto del decision point al que responde. */
  decisionPointMinute: number;
  /** Opción seleccionada por el equipo (string exacto del options[]). */
  selectedOption: string;
  /** Minuto efectivo en que respondió (>= decisionPointMinute). */
  respondedAtMinute: number;
  /** UID del miembro del equipo que respondió. */
  respondingUid: string;
}

export interface TabletopAttempt {
  scenarioId: string;
  /** UIDs del equipo que participa. */
  teamUids: string[];
  /** ISO-8601 inicio del ejercicio. */
  startedAt: string;
  responses: TabletopResponse[];
}

export interface TabletopWeakSpot {
  decisionPointMinute: number;
  question: string;
  teamResponse: string;
  gap: string;
}

export interface TabletopResult {
  scenarioId: string;
  totalDecisionPoints: number;
  correctResponses: number;
  scorePct: number;
  /** Promedio de retraso minutos (respondedAtMinute - decisionPointMinute). */
  reactionTimeMinutes: number;
  weakSpots: TabletopWeakSpot[];
  recommendations: string[];
  /** ≥70% correctas. */
  passed: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Evaluation
// ────────────────────────────────────────────────────────────────────────

/**
 * Evalúa un intento de tabletop contra el escenario.
 *
 * Reglas:
 *  - Un decision point cuenta como correcto si la opción seleccionada está
 *    en `correctResponses`.
 *  - Decision points sin respuesta cuentan como incorrectos.
 *  - `reactionTimeMinutes` se calcula sólo sobre respuestas presentes
 *    (retraso medio, mínimo 0).
 *  - `weakSpots` se llena con todos los decision points fallados.
 *  - `passed` = scorePct ≥ 70.
 */
export function evaluateTabletop(
  attempt: TabletopAttempt,
  scenario: ContingencyScenario,
): TabletopResult {
  if (attempt.scenarioId !== scenario.id) {
    throw new Error(
      `Scenario mismatch: attempt=${attempt.scenarioId} vs scenario=${scenario.id}`,
    );
  }

  const dpList = scenario.decisionPoints;
  const totalDecisionPoints = dpList.length;

  if (totalDecisionPoints === 0) {
    return {
      scenarioId: scenario.id,
      totalDecisionPoints: 0,
      correctResponses: 0,
      scorePct: 0,
      reactionTimeMinutes: 0,
      weakSpots: [],
      recommendations: ['Escenario sin puntos de decisión — ajustar la plantilla.'],
      passed: false,
    };
  }

  let correctResponses = 0;
  const weakSpots: TabletopWeakSpot[] = [];
  const reactionDelays: number[] = [];

  for (const dp of dpList) {
    const response = findResponseFor(dp, attempt.responses);
    if (!response) {
      weakSpots.push({
        decisionPointMinute: dp.minute,
        question: dp.question,
        teamResponse: '(sin respuesta)',
        gap: `Equipo no respondió al punto de decisión en minuto ${dp.minute}. ${dp.rationale}`,
      });
      continue;
    }

    const delay = Math.max(0, response.respondedAtMinute - dp.minute);
    reactionDelays.push(delay);

    const optionRecognized = dp.options.includes(response.selectedOption);
    if (!optionRecognized) {
      weakSpots.push({
        decisionPointMinute: dp.minute,
        question: dp.question,
        teamResponse: response.selectedOption,
        gap: `Respuesta no figura en las opciones documentadas. Revisar entrenamiento sobre opciones válidas. ${dp.rationale}`,
      });
      continue;
    }

    if (dp.correctResponses.includes(response.selectedOption)) {
      correctResponses += 1;
    } else {
      weakSpots.push({
        decisionPointMinute: dp.minute,
        question: dp.question,
        teamResponse: response.selectedOption,
        gap: dp.rationale,
      });
    }
  }

  const scorePct = Math.round((correctResponses / totalDecisionPoints) * 100);
  const reactionTimeMinutes =
    reactionDelays.length > 0
      ? Math.round(
          (reactionDelays.reduce((a, b) => a + b, 0) / reactionDelays.length) * 10,
        ) / 10
      : 0;

  const recommendations = buildRecommendations({
    scorePct,
    reactionTimeMinutes,
    weakSpots,
    severity: scenario.severity,
    teamSize: attempt.teamUids.length,
  });

  return {
    scenarioId: scenario.id,
    totalDecisionPoints,
    correctResponses,
    scorePct,
    reactionTimeMinutes,
    weakSpots,
    recommendations,
    passed: scorePct >= 70,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function findResponseFor(
  dp: ScenarioDecisionPoint,
  responses: TabletopResponse[],
): TabletopResponse | undefined {
  // primera respuesta para ese minute
  return responses.find((r) => r.decisionPointMinute === dp.minute);
}

function buildRecommendations(args: {
  scorePct: number;
  reactionTimeMinutes: number;
  weakSpots: TabletopWeakSpot[];
  severity: ContingencyScenario['severity'];
  teamSize: number;
}): string[] {
  const recs: string[] = [];

  if (args.scorePct >= 90) {
    recs.push(
      `Excelente desempeño (${args.scorePct}%). Mantener entrenamiento + escalar a escenarios más complejos.`,
    );
  } else if (args.scorePct >= 70) {
    recs.push(
      `Aprobado (${args.scorePct}%). Hay margen de mejora en ${args.weakSpots.length} puntos.`,
    );
  } else if (args.scorePct >= 50) {
    recs.push(
      `Por debajo del umbral (${args.scorePct}%). Re-entrenar puntos débiles y repetir tabletop.`,
    );
  } else {
    recs.push(
      `Desempeño crítico (${args.scorePct}%). Capacitación intensiva antes de operar zonas con este riesgo.`,
    );
  }

  if (args.reactionTimeMinutes > 5) {
    recs.push(
      `Tiempo de reacción promedio ${args.reactionTimeMinutes} min — objetivo <5 min. Practicar toma de decisión bajo presión.`,
    );
  }

  if (args.severity === 'catastrophic' && args.scorePct < 90) {
    recs.push(
      'Escenario catastrófico requiere ≥90% para validar preparación. Repetir cuando se haya cerrado brechas.',
    );
  }

  if (args.teamSize < 3) {
    recs.push(
      `Equipo pequeño (${args.teamSize}). Incorporar al menos 1 segundo al mando para validar continuidad.`,
    );
  }

  // top-3 weak spots
  const topGaps = args.weakSpots.slice(0, 3);
  for (const ws of topGaps) {
    recs.push(`[min ${ws.decisionPointMinute}] ${ws.question} — ${ws.gap}`);
  }

  return recs;
}
