/**
 * CEAL-SM/SUSESO — pure scoring engine (no side effects, no Firestore).
 *
 * Computes, from anonymized response sets, the official Chilean psychosocial
 * risk evaluation of a centro de trabajo:
 *   1. Per-respondent dimension scores (sum of official item points).
 *   2. Individual risk level per dimension via the Tabla 2 tertile cut-offs.
 *   3. Center-level prevalence per dimension (% of respondents per level).
 *   4. Center points per dimension (Protocolo MINSAL Tabla 3: >=50%
 *      prevalence → +2 alto / +1 medio / -2 bajo, tie → higher risk).
 *   5. Center risk state (Tabla 4: -24..+1 bajo, +2..+12 medio, +13..+24
 *      alto), required actions and reevaluation periodicity (2 años).
 *   6. Evaluation validity: participation >= 60% (Protocolo sección 9).
 *
 * Legal sources are transcribed with citations in cealSmDefinition.ts. This
 * engine NEVER sees worker identities — inputs are bare answer maps; the
 * anonymity machinery (responder hash, k-gate) lives in the server route.
 *
 * ADR 0012: this engine evaluates the WORKPLACE (ambiente laboral), never a
 * person. It produces no individual output and no clinical judgment.
 */

import {
  CEAL_DIMENSIONS,
  CEAL_SCALE_OPTIONS,
  CEAL_MIN_PARTICIPATION,
  CEAL_REEVALUATION_YEARS,
  CEAL_CENTER_PREVALENCE_THRESHOLD,
  CEAL_CENTER_RISK_BANDS,
  type CealDimension,
  type CealDimensionId,
  type CealRiskLevel,
} from './cealSmDefinition';

/** One anonymized respondent: official item code → official point value. */
export type CealAnswers = Record<string, number>;

export interface CealDimensionAggregate {
  dimensionId: CealDimensionId;
  name: string;
  /** Respondents per individual risk level for this dimension. */
  counts: Record<CealRiskLevel, number>;
  /** Percentages over total respondents (sum 100, rounded to 1 decimal). */
  percentages: Record<CealRiskLevel, number>;
  /** Protocolo Tabla 3 points: 2 | 1 | -2 | 0. */
  centerPoints: number;
}

export interface CealSmCenterInput {
  responses: CealAnswers[];
  /** Headcount of the centro de trabajo (denominator of participation). */
  totalWorkers: number;
}

export interface CealSmCenterResult {
  totalResponses: number;
  totalWorkers: number;
  /** responses / totalWorkers, capped at 1. */
  participationRate: number;
  /** Protocolo sección 9: valid only with >= 60% participation. */
  evaluationValid: boolean;
  dimensions: CealDimensionAggregate[];
  /** Sum of center points across the 12 dimensions (-24..+24). */
  centerScore: number;
  /** Estado de riesgo del centro de trabajo (Tabla 4). */
  centerRisk: CealRiskLevel;
  /** es-CL actions mandated by the Protocolo for this state. */
  requiredActions: string[];
  /** Protocolo sección 8: reevaluación cada 2 años. */
  reevaluationYears: number;
}

// ── Lookups ──────────────────────────────────────────────────────────────

const DIMENSION_BY_ID = new Map<CealDimensionId, CealDimension>(
  CEAL_DIMENSIONS.map((d) => [d.id, d]),
);

interface ItemSpec {
  dimensionId: CealDimensionId;
  min: number;
  max: number;
}

const ITEM_SPECS = new Map<string, ItemSpec>();
for (const d of CEAL_DIMENSIONS) {
  for (const item of d.items) {
    const points = CEAL_SCALE_OPTIONS[item.scale].map((o) => o.points);
    ITEM_SPECS.set(item.code, {
      dimensionId: d.id,
      min: Math.min(...points),
      max: Math.max(...points),
    });
  }
}

function fail(message: string): never {
  throw new Error(`CEAL-SM: ${message}`);
}

// ── Validation ───────────────────────────────────────────────────────────

/**
 * Validates a full Sección II answer set: every official item present, no
 * unknown codes, integer values within the item's official point range.
 * Throws `Error('CEAL-SM: …')` on the first violation.
 */
export function validateCealAnswers(answers: CealAnswers): void {
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
    fail('answers must be an object keyed by item code');
  }
  for (const code of Object.keys(answers)) {
    if (!ITEM_SPECS.has(code)) fail(`unknown item code "${code}"`);
  }
  for (const [code, spec] of ITEM_SPECS) {
    const value = answers[code];
    if (value === undefined) fail(`missing answer for item "${code}"`);
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < spec.min ||
      value > spec.max
    ) {
      fail(
        `answer for item "${code}" must be an integer in [${spec.min},${spec.max}] (received ${String(value)})`,
      );
    }
  }
}

// ── Dimension scoring ────────────────────────────────────────────────────

function requireDimension(dimensionId: CealDimensionId): CealDimension {
  const d = DIMENSION_BY_ID.get(dimensionId);
  if (!d) fail(`unknown dimension "${dimensionId}"`);
  return d;
}

/** Sum of the official item points of one dimension for one respondent. */
export function scoreCealDimension(
  dimensionId: CealDimensionId,
  answers: CealAnswers,
): number {
  const d = requireDimension(dimensionId);
  let total = 0;
  for (const item of d.items) {
    const value = answers[item.code];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(`missing answer for item "${item.code}"`);
    }
    total += value;
  }
  return total;
}

/**
 * Individual risk level for a dimension score (Tabla 2). The cut-off value
 * belongs to the UPPER level (manual, footnote 2 of Tabla 2).
 */
export function classifyCealDimension(
  dimensionId: CealDimensionId,
  score: number,
): CealRiskLevel {
  const d = requireDimension(dimensionId);
  if (
    !Number.isInteger(score) ||
    score < d.scoreRange.min ||
    score > d.scoreRange.max
  ) {
    fail(
      `score ${score} out of range [${d.scoreRange.min},${d.scoreRange.max}] for dimension ${dimensionId}`,
    );
  }
  if (score <= d.cutoffs.lowMax) return 'bajo';
  if (score <= d.cutoffs.mediumMax) return 'medio';
  return 'alto';
}

// ── Center risk state ────────────────────────────────────────────────────

/** Estado de riesgo del centro de trabajo por puntaje total (Tabla 4). */
export function classifyCealCenter(centerScore: number): CealRiskLevel {
  if (centerScore <= CEAL_CENTER_RISK_BANDS.lowMax) return 'bajo';
  if (centerScore <= CEAL_CENTER_RISK_BANDS.mediumMax) return 'medio';
  return 'alto';
}

/**
 * Center points for one dimension's prevalence (Tabla 3). Evaluated from
 * highest to lowest risk so a 50%/50% tie takes the HIGHER risk level's
 * points ("se asigna el puntaje del nivel de riesgo mayor").
 */
function centerPointsFor(
  counts: Record<CealRiskLevel, number>,
  total: number,
): number {
  const threshold = CEAL_CENTER_PREVALENCE_THRESHOLD;
  if (counts.alto / total >= threshold) return 2;
  if (counts.medio / total >= threshold) return 1;
  if (counts.bajo / total >= threshold) return -2;
  return 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// LEGAL SOURCE: Protocolo MINSAL oct. 2022, Tabla 4 (acción del OAL/AD por
// estado de riesgo) y punto 11.1 (plazos del programa de vigilancia: medidas
// de corto plazo 180 días, mediano 270 días y largo plazo 360 días, con
// verificación de avance a los 6, 9 y 12 meses). User-facing es-CL by design.
function requiredActionsFor(
  centerRisk: CealRiskLevel,
  evaluationValid: boolean,
): string[] {
  const actions: string[] = [];
  if (!evaluationValid) {
    actions.push(
      'Participación bajo el 60% del centro de trabajo: la evaluación NO es válida según el Protocolo MINSAL. Refuerce la campaña de difusión y sensibilización y complete la aplicación hasta alcanzar al menos el 60%.',
    );
  }
  if (centerRisk === 'alto') {
    actions.push(
      'Riesgo alto: el centro de trabajo ingresa al programa de vigilancia ambiental del organismo administrador (OAL/AD).',
      'Implementar las medidas prescritas por el OAL/AD: corto plazo (180 días), mediano plazo (270 días) y largo plazo (360 días), con verificación de avance a los 6, 9 y 12 meses.',
      'Realizar grupos de discusión con los trabajadores y trabajadoras para analizar los resultados y diseñar las intervenciones.',
      'Reevaluar con CEAL-SM/SUSESO a los 2 años.',
    );
  } else if (centerRisk === 'medio') {
    actions.push(
      'Riesgo medio: el organismo administrador (OAL/AD) prescribe acciones específicas para los grupos de exposición similar.',
      'Realizar grupos de discusión en las unidades con más de una dimensión en riesgo alto o medio.',
      'Reevaluar con CEAL-SM/SUSESO a los 2 años.',
    );
  } else {
    actions.push(
      'Riesgo bajo: el organismo administrador (OAL/AD) prescribe medidas específicas para las dimensiones que queden en riesgo medio y alto.',
      'Mantener y reforzar las dimensiones en nivel de riesgo bajo (factores protectores).',
      'Reevaluar con CEAL-SM/SUSESO a los 2 años.',
    );
  }
  return actions;
}

// ── Center evaluation ────────────────────────────────────────────────────

export function evaluateCealSmCenter(
  input: CealSmCenterInput,
): CealSmCenterResult {
  const { responses, totalWorkers } = input;
  if (!Array.isArray(responses) || responses.length === 0) {
    fail('at least one response is required');
  }
  if (
    typeof totalWorkers !== 'number' ||
    !Number.isInteger(totalWorkers) ||
    totalWorkers < 1
  ) {
    fail(`totalWorkers must be a positive integer (received ${String(totalWorkers)})`);
  }
  for (const answers of responses) validateCealAnswers(answers);

  const totalResponses = responses.length;

  const dimensions: CealDimensionAggregate[] = CEAL_DIMENSIONS.map((d) => {
    const counts: Record<CealRiskLevel, number> = { bajo: 0, medio: 0, alto: 0 };
    for (const answers of responses) {
      const level = classifyCealDimension(d.id, scoreCealDimension(d.id, answers));
      counts[level] += 1;
    }
    // Percentages over respondents (the manual's Tabla 3 example sums each
    // dimension's three levels to 100% over the evaluated workers).
    const percentages: Record<CealRiskLevel, number> = {
      bajo: round1((counts.bajo / totalResponses) * 100),
      medio: round1((counts.medio / totalResponses) * 100),
      alto: round1((counts.alto / totalResponses) * 100),
    };
    return {
      dimensionId: d.id,
      name: d.name,
      counts,
      percentages,
      centerPoints: centerPointsFor(counts, totalResponses),
    };
  });

  const centerScore = dimensions.reduce((s, d) => s + d.centerPoints, 0);
  const centerRisk = classifyCealCenter(centerScore);
  const participationRate = Math.min(1, totalResponses / totalWorkers);
  const evaluationValid = participationRate >= CEAL_MIN_PARTICIPATION;

  return {
    totalResponses,
    totalWorkers,
    participationRate,
    evaluationValid,
    dimensions,
    centerScore,
    centerRisk,
    requiredActions: requiredActionsFor(centerRisk, evaluationValid),
    reevaluationYears: CEAL_REEVALUATION_YEARS,
  };
}
