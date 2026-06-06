// Praeventio Guard — Sprint K: Brigada Emergencia + Recursos + Extintores + Mapa + QR Puntos.
//
// Cierra: Documento usuario "§74-78"
//
// Gestión de la respuesta a emergencias:
//   - Brigada de emergencia con roles (jefe, primeros auxilios, fuego, evacuación)
//   - Recursos (extintores, kits, botiquines, AED) con QR
//   - Mapa de puntos críticos (rutas escape, hidrantes, AEDs)
//   - Verificación periódica + caducidad
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type BrigadeRole =
  | 'brigade_chief'
  | 'first_aid'
  | 'fire_response'
  | 'evacuation_coordinator'
  | 'communications';

export interface BrigadeMember {
  workerUid: string;
  role: BrigadeRole;
  /** ISO-8601 de la última capacitación. */
  trainedAt: string;
  /** Vigencia capacitación (años). */
  trainingValidYears: number;
  active: boolean;
}

export interface EmergencyResource {
  id: string;
  kind: 'extinguisher' | 'first_aid_kit' | 'aed' | 'eyewash' | 'safety_shower' | 'fire_hose' | 'spill_kit';
  location: string;
  /** ISO-8601 última inspección. */
  lastInspectedAt: string;
  /** ISO-8601 próximo vencimiento (carga / certificación). */
  nextExpirationAt: string;
  /** True si operativo. */
  operational: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Brigade readiness
// ────────────────────────────────────────────────────────────────────────

export interface BrigadeCoverageReport {
  totalMembers: number;
  byRole: Record<BrigadeRole, number>;
  /** Roles con cero miembros activos certificados. */
  uncoveredRoles: BrigadeRole[];
  /** Miembros con capacitación vencida. */
  expiredTrainings: BrigadeMember[];
  /** True si tiene cobertura mínima (1 jefe + 1 primer aux + 1 fuego). */
  meetsMinimum: boolean;
}

const MINIMUM_REQUIRED: BrigadeRole[] = ['brigade_chief', 'first_aid', 'fire_response'];

export function buildBrigadeCoverageReport(
  members: BrigadeMember[],
  nowIso: string = new Date().toISOString(),
): BrigadeCoverageReport {
  const nowMs = Date.parse(nowIso);
  const active = members.filter((m) => m.active);
  const byRole = {
    brigade_chief: 0,
    first_aid: 0,
    fire_response: 0,
    evacuation_coordinator: 0,
    communications: 0,
  } as Record<BrigadeRole, number>;

  const expiredTrainings: BrigadeMember[] = [];
  for (const m of active) {
    const trainedMs = Date.parse(m.trainedAt);
    const expiresMs = trainedMs + m.trainingValidYears * 365 * 86_400_000;
    // Fail-closed: a corrupt/unparseable `trainedAt` must NOT count as valid
    // brigade coverage — a brigade can't be certified "ready" on garbage data.
    // `Date.parse` returns NaN on a bad date and `NaN < nowMs` is always false,
    // so WITHOUT this guard the member would skip `expiredTrainings` AND
    // increment `byRole`, inflating `meetsMinimum` for a brigade that is
    // actually under-covered — a life-safety false positive.
    if (Number.isNaN(trainedMs) || expiresMs < nowMs) {
      expiredTrainings.push(m);
    } else {
      byRole[m.role] += 1;
    }
  }

  const uncoveredRoles = MINIMUM_REQUIRED.filter((r) => byRole[r] === 0);
  const meetsMinimum = uncoveredRoles.length === 0;

  return {
    totalMembers: active.length,
    byRole,
    uncoveredRoles,
    expiredTrainings,
    meetsMinimum,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Resource readiness
// ────────────────────────────────────────────────────────────────────────

export interface ResourceReadinessReport {
  totalResources: number;
  byKind: Record<EmergencyResource['kind'], number>;
  operational: number;
  /** Recursos vencidos o por vencer en 30d. */
  needingAttention: EmergencyResource[];
  /** % operativos. */
  operationalPercent: number;
}

export function buildResourceReadinessReport(
  resources: EmergencyResource[],
  nowIso: string = new Date().toISOString(),
): ResourceReadinessReport {
  const nowMs = Date.parse(nowIso);
  const byKind = {
    extinguisher: 0,
    first_aid_kit: 0,
    aed: 0,
    eyewash: 0,
    safety_shower: 0,
    fire_hose: 0,
    spill_kit: 0,
  } as Record<EmergencyResource['kind'], number>;

  let operational = 0;
  const needingAttention: EmergencyResource[] = [];
  for (const r of resources) {
    byKind[r.kind] += 1;
    if (r.operational) operational += 1;
    const daysToExpiry = (Date.parse(r.nextExpirationAt) - nowMs) / 86_400_000;
    if (!r.operational || daysToExpiry <= 30) {
      needingAttention.push(r);
    }
  }

  const operationalPercent =
    resources.length > 0 ? Math.round((operational / resources.length) * 100) : 0;

  return {
    totalResources: resources.length,
    byKind,
    operational,
    needingAttention,
    operationalPercent,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Coverage gap detector
// ────────────────────────────────────────────────────────────────────────

export interface CoverageRequirement {
  /** Tipo de recurso requerido. */
  kind: EmergencyResource['kind'];
  /** Mínimo de unidades en faena. */
  minimumCount: number;
}

export interface CoverageGap {
  kind: EmergencyResource['kind'];
  required: number;
  current: number;
  shortfall: number;
}

export function detectCoverageGaps(
  resources: EmergencyResource[],
  requirements: CoverageRequirement[],
): CoverageGap[] {
  return requirements
    .map((req) => {
      const current = resources.filter((r) => r.kind === req.kind && r.operational).length;
      return {
        kind: req.kind,
        required: req.minimumCount,
        current,
        shortfall: Math.max(0, req.minimumCount - current),
      };
    })
    .filter((g) => g.shortfall > 0);
}
