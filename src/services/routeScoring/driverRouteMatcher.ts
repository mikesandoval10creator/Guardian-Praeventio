// Praeventio Guard — Sprint 53.
//
// `driverRouteMatcher.ts` evaluates a driver against a `RouteRiskProfile`
// emitted by `criticalRouteScoring.ts`. Complementary to
// `drivingSafety.canAssignDriverToRoute()` which only checks level rank —
// this matcher also considers **fatigue**, **30-day hours driven**,
// **vehicle authorization**, and **recent incidents** with blocking vs
// warning semantics so the dispatch UI can surface a confidence score.
//
// Closes §72-73 of the 2nd user document tanda (driver-route matching +
// alertas en ruta).
//
// Determinístico, pure functions. No Firestore, no React, no LLM.

import type {
  DriverExperienceTier,
  RouteRiskProfile,
} from './criticalRouteScoring.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type FatigueLevel = 'low' | 'medium' | 'high' | 'critical';

export interface DriverProfile {
  uid: string;
  experienceLevel: DriverExperienceTier;
  yearsLicensed: number;
  hoursDrivenLast30d: number;
  incidentsLast12months: number;
  vehicleTypesAuthorized: string[];
  fatigueLevel?: FatigueLevel;
}

export interface RouteAssignmentDecision {
  driverUid: string;
  routeId: string;
  canAssign: boolean;
  warnings: string[];
  blockingReasons: string[];
  /** 0-100. Higher = better match. */
  matchScore: number;
}

// ────────────────────────────────────────────────────────────────────────
// Constants — exported so tests can pin the thresholds.
// ────────────────────────────────────────────────────────────────────────

/** Above this, driver is "overdriving" → block. */
export const OVERDRIVE_HOURS_30D = 120;

/** ≥ this incidents in 12 months → block. */
export const INCIDENT_BLOCK_THRESHOLD = 3;

/** ≥ this incidents in 12 months (and < block threshold) → warning. */
export const INCIDENT_WARNING_THRESHOLD = 2;

const EXPERIENCE_RANK: Record<DriverExperienceTier, number> = {
  novice: 0,
  intermediate: 1,
  expert: 2,
};

// ────────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────────

export function experienceRank(tier: DriverExperienceTier): number {
  return EXPERIENCE_RANK[tier];
}

/**
 * Distance between driver experience and required experience. Negative
 * means the driver is under-qualified (blocking). Zero is an exact match.
 * Positive means the driver is over-qualified (still fine, no penalty).
 */
export function experienceGap(
  driverTier: DriverExperienceTier,
  requiredTier: DriverExperienceTier,
): number {
  return experienceRank(driverTier) - experienceRank(requiredTier);
}

/**
 * Pure scoring contribution from incidents — bounded [0, 30].
 */
function incidentPenalty(incidents12m: number): number {
  if (incidents12m <= 0) return 0;
  return Math.min(30, incidents12m * 10);
}

/**
 * Pure scoring contribution from fatigue.
 */
function fatiguePenalty(level: FatigueLevel | undefined): number {
  switch (level) {
    case 'critical':
      return 50;
    case 'high':
      return 20;
    case 'medium':
      return 8;
    default:
      return 0;
  }
}

/**
 * Pure scoring contribution from overdriving — sub-linear above 80h.
 */
function hoursPenalty(hours30d: number): number {
  if (hours30d <= 80) return 0;
  if (hours30d >= OVERDRIVE_HOURS_30D) return 25;
  // Smooth ramp from 80 → 120.
  return Math.round(((hours30d - 80) / (OVERDRIVE_HOURS_30D - 80)) * 25);
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Evaluate whether a driver can be assigned to a scored route.
 *
 * Blocking rules (any → `canAssign = false`):
 *   • driver experience level < required level
 *   • fatigue level is `critical`
 *   • `requiredVehicleType` is set and not in `vehicleTypesAuthorized`
 *   • `incidentsLast12months >= 3`
 *   • `hoursDrivenLast30d > 120` (overdriving)
 *
 * Warning rules (`canAssign` still true, but flagged):
 *   • novice on a `moderate` route
 *   • fatigue level is `high`
 *   • `incidentsLast12months >= 2` (and < block threshold)
 *
 * `matchScore` starts at 100 and decays with each penalty so the
 * dispatcher UI can rank candidates even among "assignable" drivers.
 */
export function evaluateDriverRoute(
  driver: DriverProfile,
  profile: RouteRiskProfile,
  requiredVehicleType?: string,
): RouteAssignmentDecision {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  // ── Blocking checks ──
  const gap = experienceGap(driver.experienceLevel, profile.recommendedDriverExperience);
  if (gap < 0) {
    blockingReasons.push(
      `Experiencia insuficiente: ruta requiere ${profile.recommendedDriverExperience}, conductor es ${driver.experienceLevel}.`,
    );
  }

  if (driver.fatigueLevel === 'critical') {
    blockingReasons.push('Fatiga crítica — descanso obligatorio antes de conducir.');
  }

  if (
    requiredVehicleType &&
    !driver.vehicleTypesAuthorized.includes(requiredVehicleType)
  ) {
    blockingReasons.push(
      `Vehículo ${requiredVehicleType} no autorizado para este conductor.`,
    );
  }

  if (driver.incidentsLast12months >= INCIDENT_BLOCK_THRESHOLD) {
    blockingReasons.push(
      `${driver.incidentsLast12months} incidentes en 12 meses — requiere reentrenamiento.`,
    );
  }

  if (driver.hoursDrivenLast30d > OVERDRIVE_HOURS_30D) {
    blockingReasons.push(
      `Horas conducidas 30d (${driver.hoursDrivenLast30d}h) excede el límite de ${OVERDRIVE_HOURS_30D}h.`,
    );
  }

  // ── Warning checks ──
  if (
    driver.experienceLevel === 'novice' &&
    profile.category === 'moderate'
  ) {
    warnings.push('Conductor novato en ruta moderada — supervisión recomendada.');
  }

  if (driver.fatigueLevel === 'high') {
    warnings.push('Fatiga alta — recomendar pausa antes del dispatch.');
  }

  if (
    driver.incidentsLast12months >= INCIDENT_WARNING_THRESHOLD &&
    driver.incidentsLast12months < INCIDENT_BLOCK_THRESHOLD
  ) {
    warnings.push(
      `${driver.incidentsLast12months} incidentes en 12 meses — historial a vigilar.`,
    );
  }

  // ── Match score ──
  let matchScore = 100;
  // Experience over-qualification grants no bonus but exact / under decays score.
  if (gap < 0) matchScore -= 40 * Math.abs(gap);
  else if (gap === 0) matchScore -= 5; // exact-match still costs slightly less than over-qualified
  matchScore -= incidentPenalty(driver.incidentsLast12months);
  matchScore -= fatiguePenalty(driver.fatigueLevel);
  matchScore -= hoursPenalty(driver.hoursDrivenLast30d);
  if (
    requiredVehicleType &&
    !driver.vehicleTypesAuthorized.includes(requiredVehicleType)
  ) {
    matchScore -= 30;
  }
  // Bonus for tenure.
  if (driver.yearsLicensed >= 5) matchScore += 5;
  if (driver.yearsLicensed >= 10) matchScore += 5;

  matchScore = Math.max(0, Math.min(100, Math.round(matchScore)));

  return {
    driverUid: driver.uid,
    routeId: profile.routeId,
    canAssign: blockingReasons.length === 0,
    warnings,
    blockingReasons,
    matchScore,
  };
}
