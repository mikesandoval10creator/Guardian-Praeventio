// Praeventio Guard — Sprint K Fase §-bowtie: Análisis Bowtie de Riesgo.
//
// Cierra: Documento usuario "Recomendaciones nuevas (gestión de riesgos)".
//
// El diagrama "bowtie" (corbatín) es estándar internacional en
// industrias de alto riesgo (minería, petroquímica, aviación):
//
//                       [HAZARDOUS EVENT]
//   threat ──barrier──>      |      <──barrier── consequence
//   threat ──barrier──>      |      <──barrier── consequence
//
// Permite ver de un vistazo:
//   - Qué amenazas pueden gatillar el evento (lado izquierdo)
//   - Qué barreras preventivas existen
//   - Qué consecuencias puede tener si ocurre (lado derecho)
//   - Qué barreras mitigatorias existen
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type BarrierType =
  | 'elimination'
  | 'substitution'
  | 'engineering'
  | 'administrative'
  | 'ppe';

export type BarrierStatus = 'in_place' | 'planned' | 'missing' | 'degraded';

export interface Barrier {
  id: string;
  description: string;
  type: BarrierType;
  status: BarrierStatus;
  /** Porcentaje 0..1 de efectividad estimada. */
  effectiveness: number;
  /** Responsable (rol o uid). */
  ownerRole?: string;
}

export interface Threat {
  id: string;
  description: string;
  /** Barreras preventivas que actúan sobre esta amenaza. */
  preventiveBarriers: Barrier[];
}

export interface Consequence {
  id: string;
  description: string;
  /** Severidad cualitativa. */
  severity: 'low' | 'medium' | 'high' | 'catastrophic';
  /** Barreras mitigatorias que reducen el impacto si ocurre. */
  mitigatingBarriers: Barrier[];
}

export interface HazardousEvent {
  id: string;
  description: string;
  /** Categoría (caída, incendio, atrapamiento, etc.). */
  category: string;
}

export interface BowtieDiagram {
  diagramId: string;
  tenantId: string;
  hazardousEvent: HazardousEvent;
  threats: Threat[];
  consequences: Consequence[];
  /** Métricas calculadas. */
  metrics: BowtieMetrics;
  /** ISO-8601. */
  createdAt: string;
}

export interface BowtieMetrics {
  totalBarriers: number;
  barriersInPlace: number;
  /** Amenazas sin ninguna barrera preventiva "in_place". */
  unprotectedThreatIds: string[];
  /** Consecuencias sin ninguna barrera mitigatoria "in_place". */
  unmitigatedConsequenceIds: string[];
  /** 0..1, promedio de efectividad de barreras "in_place". */
  averageEffectiveness: number;
  /** Score global: bajo = riesgo residual alto. */
  residualRiskScore: 'low' | 'medium' | 'high' | 'critical';
}

export class BowtieValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'BowtieValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Build
// ────────────────────────────────────────────────────────────────────────

export interface BuildBowtieInput {
  diagramId: string;
  tenantId: string;
  hazardousEvent: HazardousEvent;
  threats: Threat[];
  consequences: Consequence[];
  now?: Date;
}

export function buildBowtie(input: BuildBowtieInput): BowtieDiagram {
  if (!input.diagramId?.trim()) {
    throw new BowtieValidationError('NO_ID', 'diagramId requerido');
  }
  if (!input.tenantId?.trim()) {
    throw new BowtieValidationError('NO_TENANT', 'tenantId requerido');
  }
  if (!input.hazardousEvent?.id?.trim()) {
    throw new BowtieValidationError('NO_EVENT', 'hazardousEvent requerido');
  }
  if (input.threats.length === 0) {
    throw new BowtieValidationError('NO_THREATS', 'al menos 1 amenaza');
  }
  if (input.consequences.length === 0) {
    throw new BowtieValidationError('NO_CONSEQUENCES', 'al menos 1 consecuencia');
  }

  const ids = new Set<string>();
  const checkId = (id: string, kind: string) => {
    if (!id?.trim()) {
      throw new BowtieValidationError('EMPTY_ID', `${kind} con id vacío`);
    }
    if (ids.has(id)) {
      throw new BowtieValidationError('DUPLICATE_ID', `id duplicado: ${id}`);
    }
    ids.add(id);
  };
  for (const t of input.threats) {
    checkId(t.id, 'threat');
    for (const b of t.preventiveBarriers) {
      checkId(b.id, 'barrier');
      validateEffectiveness(b);
    }
  }
  for (const c of input.consequences) {
    checkId(c.id, 'consequence');
    for (const b of c.mitigatingBarriers) {
      checkId(b.id, 'barrier');
      validateEffectiveness(b);
    }
  }

  const metrics = computeMetrics(input.threats, input.consequences);
  const now = input.now ?? new Date();
  return {
    diagramId: input.diagramId,
    tenantId: input.tenantId,
    hazardousEvent: input.hazardousEvent,
    threats: input.threats,
    consequences: input.consequences,
    metrics,
    createdAt: now.toISOString(),
  };
}

function validateEffectiveness(b: Barrier): void {
  if (b.effectiveness < 0 || b.effectiveness > 1 || Number.isNaN(b.effectiveness)) {
    throw new BowtieValidationError(
      'BAD_EFFECTIVENESS',
      `barrier ${b.id}: effectiveness debe estar en 0..1`,
    );
  }
}

function computeMetrics(threats: Threat[], consequences: Consequence[]): BowtieMetrics {
  const allBarriers = [
    ...threats.flatMap((t) => t.preventiveBarriers),
    ...consequences.flatMap((c) => c.mitigatingBarriers),
  ];
  const inPlace = allBarriers.filter((b) => b.status === 'in_place');
  const unprotectedThreatIds = threats
    .filter((t) => !t.preventiveBarriers.some((b) => b.status === 'in_place'))
    .map((t) => t.id);
  const unmitigatedConsequenceIds = consequences
    .filter((c) => !c.mitigatingBarriers.some((b) => b.status === 'in_place'))
    .map((c) => c.id);
  const averageEffectiveness =
    inPlace.length === 0
      ? 0
      : inPlace.reduce((sum, b) => sum + b.effectiveness, 0) / inPlace.length;

  const residualRiskScore = scoreResidualRisk({
    unprotectedThreats: unprotectedThreatIds.length,
    unmitigatedConsequences: unmitigatedConsequenceIds.length,
    catastrophicCount: consequences.filter((c) => c.severity === 'catastrophic').length,
    averageEffectiveness,
  });

  return {
    totalBarriers: allBarriers.length,
    barriersInPlace: inPlace.length,
    unprotectedThreatIds,
    unmitigatedConsequenceIds,
    averageEffectiveness,
    residualRiskScore,
  };
}

function scoreResidualRisk(args: {
  unprotectedThreats: number;
  unmitigatedConsequences: number;
  catastrophicCount: number;
  averageEffectiveness: number;
}): BowtieMetrics['residualRiskScore'] {
  if (args.catastrophicCount > 0 && args.unmitigatedConsequences > 0) return 'critical';
  if (args.unprotectedThreats >= 2 || args.unmitigatedConsequences >= 2) return 'high';
  if (args.unprotectedThreats >= 1 || args.averageEffectiveness < 0.5) return 'medium';
  return 'low';
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** Devuelve solo amenazas sin ninguna barrera preventiva "in_place". */
export function listUnprotectedThreats(diagram: BowtieDiagram): Threat[] {
  return diagram.threats.filter((t) => diagram.metrics.unprotectedThreatIds.includes(t.id));
}

/** Recomienda jerarquía de control siguiente para una amenaza. */
export function recommendNextBarrierType(threat: Threat): BarrierType {
  const present = new Set(threat.preventiveBarriers.map((b) => b.type));
  const order: BarrierType[] = [
    'elimination',
    'substitution',
    'engineering',
    'administrative',
    'ppe',
  ];
  for (const t of order) {
    if (!present.has(t)) return t;
  }
  return 'administrative';
}
