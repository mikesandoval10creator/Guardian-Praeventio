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
  const licenseExpired = Date.parse(profile.licenseExpiresAt) < Date.parse(nowIso);

  if (licenseExpired) {
    blockers.push('Licencia vencida.');
  } else {
    const daysToExpiry = Math.floor((Date.parse(profile.licenseExpiresAt) - Date.parse(nowIso)) / 86_400_000);
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

  // Si licencia vencida, score se fuerza a 0 al final (después de bonus/penalties).
  if (licenseExpired) score = 0;
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
  for (const h of route.hazards) {
    riskScore += HAZARD_WEIGHT[h];
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
