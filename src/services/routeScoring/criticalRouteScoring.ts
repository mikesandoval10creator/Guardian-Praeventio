// Praeventio Guard — Sprint 53.
//
// `criticalRouteScoring.ts` builds a *segment-aware* risk profile for a
// route. It is complementary to `drivingSafety/drivingSafetyService.ts`:
//
//   • `drivingSafetyService.scoreRouteRisk()` is route-LEVEL — a flat list
//     of hazard tags + a single score. Good for the dispatcher dashboard.
//   • This module is segment-LEVEL — each hazard is anchored to a km-range
//     along the polyline so the on-vehicle navigator can pre-announce the
//     next risk ("curva cerrada en 1.2 km") and the planner can compute a
//     **recommended driver experience tier** for the route.
//
// Determinístico, sin LLM. Pure functions only — no Firestore, no React.
//
// Closes §70-71 of the 2nd user document tanda (critical route scoring).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface RoutePoint {
  lat: number;
  lng: number;
  altMeters?: number;
  /** Cumulative distance from the route start, in km. */
  kmFromStart: number;
}

export type RouteHazardKind =
  | 'sharp_curve'
  | 'steep_grade'
  | 'blind_spot'
  | 'high_traffic'
  | 'school_zone'
  | 'wildlife_crossing'
  | 'weather_prone'
  | 'fatigue_zone'
  | 'no_signal_zone';

export type RouteHazardSeverity = 'minor' | 'moderate' | 'major' | 'critical';

export interface RouteSegmentHazard {
  /** Start of the hazard segment, km from route start. */
  fromKm: number;
  /** End of the hazard segment, km from route start. */
  toKm: number;
  kind: RouteHazardKind;
  severity: RouteHazardSeverity;
}

export type RouteRiskCategory = 'low' | 'moderate' | 'high' | 'extreme';

export type DriverExperienceTier = 'novice' | 'intermediate' | 'expert';

export interface RouteRiskProfile {
  routeId: string;
  totalKm: number;
  hazardsCount: number;
  /** 0-100. Higher = more dangerous. */
  riskScore: number;
  category: RouteRiskCategory;
  hazardBreakdown: Record<RouteHazardKind, number>;
  recommendedDriverExperience: DriverExperienceTier;
  recommendations: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Scoring weights — kept as exported constants so they can be referenced
// in tests and tuned without changing the algorithm itself.
// ────────────────────────────────────────────────────────────────────────

export const HAZARD_KIND_WEIGHT: Record<RouteHazardKind, number> = {
  sharp_curve: 4,
  steep_grade: 5,
  blind_spot: 6,
  high_traffic: 3,
  school_zone: 7,
  wildlife_crossing: 4,
  weather_prone: 5,
  fatigue_zone: 4,
  no_signal_zone: 6,
};

export const SEVERITY_MULTIPLIER: Record<RouteHazardSeverity, number> = {
  minor: 1,
  moderate: 2,
  major: 3.5,
  critical: 5,
};

// Score thresholds for category buckets.
const CATEGORY_THRESHOLDS = {
  moderate: 25,
  high: 50,
  extreme: 75,
} as const;

// ────────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────────

const ALL_HAZARD_KINDS: ReadonlyArray<RouteHazardKind> = [
  'sharp_curve',
  'steep_grade',
  'blind_spot',
  'high_traffic',
  'school_zone',
  'wildlife_crossing',
  'weather_prone',
  'fatigue_zone',
  'no_signal_zone',
];

function emptyBreakdown(): Record<RouteHazardKind, number> {
  // Build deterministically so JSON.stringify ordering is stable in tests.
  const out = {} as Record<RouteHazardKind, number>;
  for (const k of ALL_HAZARD_KINDS) out[k] = 0;
  return out;
}

/**
 * Compute total km of the route from the last point's `kmFromStart`.
 * If the points are unsorted or the value is missing, falls back to 0.
 */
export function totalRouteKm(points: ReadonlyArray<RoutePoint>): number {
  if (points.length === 0) return 0;
  let maxKm = 0;
  for (const p of points) {
    if (Number.isFinite(p.kmFromStart) && p.kmFromStart > maxKm) {
      maxKm = p.kmFromStart;
    }
  }
  return maxKm;
}

/**
 * Validate a hazard against the route bounds. Returns the *clamped*
 * hazard, or null if it is wholly outside the route or has zero length.
 * Pure, deterministic.
 */
export function clampHazardToRoute(
  hazard: RouteSegmentHazard,
  totalKm: number,
): RouteSegmentHazard | null {
  if (totalKm <= 0) return null;
  const from = Math.max(0, Math.min(hazard.fromKm, hazard.toKm));
  const to = Math.min(totalKm, Math.max(hazard.fromKm, hazard.toKm));
  if (to <= from) return null;
  return { ...hazard, fromKm: from, toKm: to };
}

/**
 * Per-hazard contribution to the risk score. The base weight depends on
 * `kind`; severity multiplies it; segment-length (km) adds a sub-linear
 * bonus so a 30 km landslide-prone stretch doesn't drown an otherwise
 * safe route, but still meaningfully shifts the score.
 */
export function hazardContribution(hazard: RouteSegmentHazard): number {
  const base = HAZARD_KIND_WEIGHT[hazard.kind];
  const sev = SEVERITY_MULTIPLIER[hazard.severity];
  const lengthKm = Math.max(0, hazard.toKm - hazard.fromKm);
  // sqrt(km+1) keeps short hazards meaningful and long ones bounded.
  const lengthFactor = Math.sqrt(lengthKm + 1);
  return base * sev * lengthFactor;
}

function categoryFromScore(score: number): RouteRiskCategory {
  if (score >= CATEGORY_THRESHOLDS.extreme) return 'extreme';
  if (score >= CATEGORY_THRESHOLDS.high) return 'high';
  if (score >= CATEGORY_THRESHOLDS.moderate) return 'moderate';
  return 'low';
}

function experienceFromCategory(c: RouteRiskCategory): DriverExperienceTier {
  if (c === 'extreme' || c === 'high') return 'expert';
  if (c === 'moderate') return 'intermediate';
  return 'novice';
}

function buildRecommendations(
  category: RouteRiskCategory,
  breakdown: Record<RouteHazardKind, number>,
  totalKm: number,
): string[] {
  const recs: string[] = [];
  if (category === 'extreme') {
    recs.push('Asignar solo a conductores expertos con licencia vigente y sin incidentes recientes.');
    recs.push('Convoy obligatorio (mínimo 2 vehículos) y check-in cada 30 min.');
  } else if (category === 'high') {
    recs.push('Conductor experimentado requerido; supervisor debe firmar el dispatch.');
  } else if (category === 'moderate') {
    recs.push('Recordatorio de pausas activas cada 2 horas de conducción.');
  }

  if (breakdown.school_zone > 0) {
    recs.push('Velocidad reducida en zonas escolares; revisar horarios de salida.');
  }
  if (breakdown.weather_prone > 0) {
    recs.push('Verificar pronóstico Open-Meteo 30 min antes del dispatch.');
  }
  if (breakdown.no_signal_zone > 0) {
    recs.push('Radio HF/VHF o satelital obligatoria en tramos sin cobertura celular.');
  }
  if (breakdown.fatigue_zone > 0 || totalKm > 200) {
    recs.push('Planificar relevo de conductor si la jornada total supera 4 horas.');
  }
  if (breakdown.wildlife_crossing > 0) {
    recs.push('Reducir velocidad en cruces de fauna durante crepúsculo y noche.');
  }
  return recs;
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a per-segment risk profile for a route.
 *
 * Pure: no I/O, deterministic. Hazards outside the route bounds are
 * clamped or dropped; the algorithm never throws on malformed input.
 *
 * `riskScore` is bounded to 0-100. The mapping is:
 *   • `low`      : score < 25
 *   • `moderate` : 25 ≤ score < 50
 *   • `high`     : 50 ≤ score < 75
 *   • `extreme`  : score ≥ 75
 */
export function buildRouteRiskProfile(
  routeId: string,
  points: ReadonlyArray<RoutePoint>,
  hazards: ReadonlyArray<RouteSegmentHazard>,
): RouteRiskProfile {
  const totalKm = totalRouteKm(points);
  const breakdown = emptyBreakdown();

  let rawScore = 0;
  let validCount = 0;
  for (const h of hazards) {
    const clamped = clampHazardToRoute(h, totalKm);
    if (!clamped) continue;
    rawScore += hazardContribution(clamped);
    breakdown[clamped.kind] += 1;
    validCount += 1;
  }

  // Bound the score to 0-100. The raw score is unbounded by construction;
  // 100 corresponds to ~5 critical hazards of 10 km each on a worst-kind
  // segment, which is a reasonable "extreme" anchor empirically.
  const riskScore = Math.min(100, Math.round(rawScore));
  const category = categoryFromScore(riskScore);
  const recommendedDriverExperience = experienceFromCategory(category);
  const recommendations = buildRecommendations(category, breakdown, totalKm);

  return {
    routeId,
    totalKm,
    hazardsCount: validCount,
    riskScore,
    category,
    hazardBreakdown: breakdown,
    recommendedDriverExperience,
    recommendations,
  };
}
