// Praeventio Guard — Sprint K: Conducción Segura + Rutas Críticas + Alertas Ruta.
//
// Cierra: Documento usuario "§69-71"
//
// Gestión de conducción comercial / mineral:
//   - Score de conductor (incidentes + fatiga + speeding)
//   - Rutas críticas con zonas de peligro
//   - Alertas en tiempo real (clima, obstáculos)
//   - Vehículos certificados
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface DriverProfile {
  workerUid: string;
  /** Tipo de licencia (Chile: A2/A3/A4/A5, D para grúa horquilla, etc.) */
  licenseClass: string;
  /** ISO-8601 vencimiento. */
  licenseExpiresAt: string;
  /** Años de experiencia conduciendo este tipo. */
  yearsExperience: number;
  /** Incidentes en últimos 12 meses. */
  incidents12m: number;
  /** Veces que ha excedido velocidad permitida (últimas 30 jornadas). */
  speedingEvents30d: number;
  /**
   * Fatigue score 0..100 (higher = more fatigued). Default 0 for drivers who
   * do not have a recent fatigue sample (e.g. brand-new account, manual
   * entry, or telemetry gap). Values outside the range are clamped
   * defensively rather than throwing — a corrupt field must not crash the
   * dispatcher, and the audit trail would flag the bad value separately.
   *
   * [Hy3-audit] Resolves [Audit-2026-08-31] Driver score — fatigueScore
   * se muestra pero no participa en safetyScore/canOperate. The
   * StoredDrivingDriver already stores fatigueScore and the ranking
   * endpoint returns it; computeDriverScore now actually weights it.
   */
  fatigueScore?: number;
}

export interface CriticalRoute {
  id: string;
  name: string;
  /** Distancia en km. */
  distanceKm: number;
  /** Riesgos identificados en la ruta. */
  hazards: Array<'cliff' | 'rockfall' | 'flood_zone' | 'sharp_curves' | 'limited_visibility' | 'wildlife' | 'mining_traffic'>;
  /** Velocidad máxima recomendada (km/h). */
  recommendedMaxSpeedKmh: number;
}

// ────────────────────────────────────────────────────────────────────────
// Driver scoring
// ────────────────────────────────────────────────────────────────────────

export interface DriverScoreReport {
  workerUid: string;
  /** Score 0-100 (mayor = mejor). */
  safetyScore: number;
  level: 'critical' | 'poor' | 'fair' | 'good' | 'excellent';
  /** True si puede operar (licencia vigente + score aceptable). */
  canOperate: boolean;
  blockers: string[];
}

export function computeDriverScore(
  profile: DriverProfile,
  nowIso: string = new Date().toISOString(),
): DriverScoreReport {
  let score = 100;
  const blockers: string[] = [];

  // [Hy3-audit] Reject non-finite license expiry. Date.parse('invalid')
  // returns NaN, and `NaN < NaN` is `false`, so the legacy code treated
  // a corrupt license as "valid and not near expiry" \u2014 canOperate=true
  // for a driver whose license field is garbage. A driver who cannot
  // prove a valid license is UNSAFE to dispatch; surface as expired.
  const licenseExpiryMs = Date.parse(profile.licenseExpiresAt);
  const licenseParseable = Number.isFinite(licenseExpiryMs);
  if (!licenseParseable) {
    blockers.push('Fecha de vencimiento de licencia inválida o ausente.');
  }
  const licenseExpired = licenseParseable && licenseExpiryMs < Date.parse(nowIso);

  if (licenseExpired) {
    blockers.push('Licencia vencida.');
  } else if (licenseParseable) {
    const daysToExpiry = Math.floor((licenseExpiryMs - Date.parse(nowIso)) / 86_400_000);
    if (daysToExpiry < 30) {
      blockers.push(`Licencia vence en ${daysToExpiry}d.`);
    }
  }

  // Penalización por incidentes
  score -= profile.incidents12m * 15;
  if (profile.incidents12m >= 3) blockers.push(`${profile.incidents12m} incidentes 12m.`);

  // Penalización por exceso de velocidad
  score -= Math.min(30, profile.speedingEvents30d * 5);

  // Bonus por experiencia
  if (profile.yearsExperience >= 5) score += 10;
  else if (profile.yearsExperience < 1) score -= 15;

  // [Hy3-audit] Penalización por fatiga. Resolves [Audit-2026-08-31]
  // Driver score — fatigueScore se muestra pero no participa en
  // safetyScore/canOperate. Linear penalty: fatigueScore 100 → -50
  // (safety override), 80 → -40 (heavy), 50 → -25 (moderate), 0 → 0.
  // Also: fatigueScore >= 90 → hard BLOCK (canOperate=false) regardless
  // of the experience bonus (fatigued drivers cannot "buy back" safety
  // with seniority). Default 0 (no fatigue sample → no penalty) keeps
  // the contract for drivers with no telemetry.
  const rawFatigue = profile.fatigueScore;
  const safeFatigue =
    typeof rawFatigue === 'number' && Number.isFinite(rawFatigue)
      ? Math.max(0, Math.min(100, rawFatigue))
      : 0;
  if (safeFatigue > 0) {
    score -= Math.round(safeFatigue * 0.5); // 0..50 point linear penalty
  }
  if (safeFatigue >= 90) {
    blockers.push(`Fatiga crítica (${safeFatigue}/100). Descanso obligatorio.`);
    score = 0; // hard override — experience bonus is wiped
  }

  // Si licencia vencida o inválida, score se fuerza a 0 al final
  // (después de bonus/penalties).
  if (licenseExpired || !licenseParseable) score = 0;
  score = Math.max(0, Math.min(100, score));

  let level: DriverScoreReport['level'];
  if (score >= 90) level = 'excellent';
  else if (score >= 75) level = 'good';
  else if (score >= 60) level = 'fair';
  else if (score >= 40) level = 'poor';
  else level = 'critical';

  const canOperate = blockers.length === 0 && level !== 'critical';

  return {
    workerUid: profile.workerUid,
    safetyScore: score,
    level,
    canOperate,
    blockers,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Route safety
// ────────────────────────────────────────────────────────────────────────

export interface RouteRiskScore {
  routeId: string;
  /** Score 0-100 (mayor = más riesgo). */
  riskScore: number;
  level: 'low' | 'medium' | 'high' | 'extreme';
  /** Conductor mínimo requerido (level). */
  requiredDriverLevel: 'good' | 'excellent';
  /** Categorías de hazard activas. */
  activeHazards: CriticalRoute['hazards'];
}

const HAZARD_WEIGHT: Record<CriticalRoute['hazards'][number], number> = {
  cliff: 30,
  rockfall: 25,
  flood_zone: 20,
  sharp_curves: 15,
  limited_visibility: 20,
  wildlife: 10,
  mining_traffic: 15,
};

export function scoreRouteRisk(route: CriticalRoute): RouteRiskScore {
  let riskScore = 0;
  // [Hy3-audit] Reject unknown hazard codes. The legacy code indexed
  // HAZARD_WEIGHT[h] for every h in route.hazards. If a hazard code
  // isn't in HAZARD_WEIGHT, the lookup returns `undefined`, `riskScore
  // += undefined` makes riskScore NaN, every `riskScore >= N` comparison
  // returns false, and the route falls through to level='low'. A route
  // with an UNKNOWN hazard would be classified as low risk and assigned
  // any driver. We surface the unknown hazard as extreme (penalty = 100)
  // and add a synthetic blocker so the route is never dispatchable until
  // the catalog gap is closed.
  const unknownHazards: string[] = [];
  for (const h of route.hazards) {
    const weight = HAZARD_WEIGHT[h];
    if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      unknownHazards.push(h);
      continue;
    }
    riskScore += weight;
  }
  if (unknownHazards.length > 0) {
    riskScore = 100; // saturate to extreme; the synthetic blocker gates dispatch
  }
  // Bonus por distancia larga
  if (route.distanceKm > 100) riskScore += 10;
  if (route.distanceKm > 200) riskScore += 10;
  riskScore = Math.min(100, riskScore);

  let level: 'low' | 'medium' | 'high' | 'extreme';
  if (riskScore >= 75) level = 'extreme';
  else if (riskScore >= 50) level = 'high';
  else if (riskScore >= 25) level = 'medium';
  else level = 'low';

  const requiredDriverLevel: 'good' | 'excellent' =
    level === 'extreme' || level === 'high' ? 'excellent' : 'good';

  return {
    routeId: route.id,
    riskScore,
    level,
    requiredDriverLevel,
    activeHazards: route.hazards,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Driver-route matching
// ────────────────────────────────────────────────────────────────────────

export interface AssignmentDecision {
  driverUid: string;
  routeId: string;
  allowed: boolean;
  reason: string;
}

export function canAssignDriverToRoute(
  driverReport: DriverScoreReport,
  routeRisk: RouteRiskScore,
): AssignmentDecision {
  if (!driverReport.canOperate) {
    return {
      driverUid: driverReport.workerUid,
      routeId: routeRisk.routeId,
      allowed: false,
      reason: `Conductor no puede operar: ${driverReport.blockers.join(' · ')}`,
    };
  }

  const levelRank = { excellent: 4, good: 3, fair: 2, poor: 1, critical: 0 };
  const requiredRank = levelRank[routeRisk.requiredDriverLevel];
  const driverRank = levelRank[driverReport.level];

  if (driverRank < requiredRank) {
    return {
      driverUid: driverReport.workerUid,
      routeId: routeRisk.routeId,
      allowed: false,
      reason: `Ruta nivel ${routeRisk.level} requiere conductor ${routeRisk.requiredDriverLevel}, este es ${driverReport.level}.`,
    };
  }

  return {
    driverUid: driverReport.workerUid,
    routeId: routeRisk.routeId,
    allowed: true,
    reason: 'Match adecuado conductor-ruta.',
  };
}
