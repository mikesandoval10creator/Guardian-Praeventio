// Praeventio Guard — Sprint 52 §219: First Responder Map per site.
//
// Cierra §219 de la 2da tanda usuario. Mapa de respondedores primarios
// por sitio (paramédico, brigadista, supervisor, contacto mutual) +
// dispatch automático del responder más cercano al evento.
//
// 100% determinístico. Sin GPS realtime — el caller le pasa la posición
// actual de cada responder + ubicación del incidente.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ResponderRole =
  | 'paramedic'
  | 'first_aid_certified'
  | 'fire_brigade'
  | 'rescue_specialist'
  | 'supervisor'
  | 'security_guard'
  | 'mutual_contact'
  | 'site_doctor';

export type AvailabilityState = 'on_duty' | 'on_break' | 'off_site' | 'unavailable' | 'in_response';

export interface Responder {
  uid: string;
  name: string;
  roles: ResponderRole[];
  /** Posición actual conocida (último update). */
  currentPosition?: { lat: number; lng: number; floor?: number };
  /** ISO-8601 último ping de posición. */
  lastSeenAt?: string;
  availability: AvailabilityState;
  /** Si tiene certificación SIF (rescate en altura, espacios confinados). */
  sifCertified?: boolean;
  /** Carga actual (cuántos eventos atiende ya). */
  activeAssignments?: number;
  /** Capacidad máxima simultánea. */
  maxConcurrent?: number;
}

export type IncidentKind =
  | 'medical_emergency'
  | 'cardiac_arrest'
  | 'trauma_injury'
  | 'fire'
  | 'chemical_exposure'
  | 'fall_from_height'
  | 'confined_space_rescue'
  | 'electrical_injury'
  | 'mass_casualty';

export interface IncidentLocation {
  lat: number;
  lng: number;
  floor?: number;
  /** ID de la zona si conocido. */
  zoneId?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Role priorities per incident kind
// ────────────────────────────────────────────────────────────────────────

const REQUIRED_ROLES_BY_KIND: Record<IncidentKind, ResponderRole[]> = {
  medical_emergency: ['paramedic', 'first_aid_certified', 'site_doctor'],
  cardiac_arrest: ['paramedic', 'first_aid_certified', 'site_doctor'],
  trauma_injury: ['paramedic', 'first_aid_certified'],
  fire: ['fire_brigade'],
  chemical_exposure: ['paramedic', 'fire_brigade', 'site_doctor'],
  fall_from_height: ['paramedic', 'rescue_specialist'],
  confined_space_rescue: ['rescue_specialist', 'paramedic'],
  electrical_injury: ['paramedic', 'first_aid_certified'],
  mass_casualty: ['paramedic', 'fire_brigade', 'site_doctor', 'mutual_contact'],
};

/** Algunos eventos REQUIEREN un SIF certified además del paramedic. */
const SIF_CERT_REQUIRED: IncidentKind[] = [
  'fall_from_height',
  'confined_space_rescue',
];

// ────────────────────────────────────────────────────────────────────────
// Geo distance (3D approximation)
// ────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

function distance3D(
  a: Responder,
  incident: IncidentLocation,
): number | null {
  if (!a.currentPosition) return null;
  const horiz = haversineMeters(a.currentPosition, incident);
  const dFloor = ((incident.floor ?? 0) - (a.currentPosition.floor ?? 0)) * 4; // 4m por piso (incluye escaleras lentas)
  return Math.sqrt(horiz * horiz + dFloor * dFloor);
}

// ────────────────────────────────────────────────────────────────────────
// Dispatch decision
// ────────────────────────────────────────────────────────────────────────

export interface DispatchCandidate {
  responderUid: string;
  matchedRole: ResponderRole;
  distanceMeters: number;
  estimatedArrivalSeconds: number;
  /** Si está disponible para asignarse. */
  available: boolean;
  /** Si tiene SIF cert si fue requerido. */
  sifCertOk: boolean;
  /** Score 0..100 (mayor = mejor candidato). */
  matchScore: number;
  reasonIfRejected?: string;
}

export interface DispatchPlan {
  incidentKind: IncidentKind;
  /** Primary responder seleccionado. */
  primary?: DispatchCandidate;
  /** Backups en orden. */
  backups: DispatchCandidate[];
  /** Si no hay ningún candidate apto. */
  noEligibleResponder: boolean;
  /** Recomendaciones para el caller. */
  recommendations: string[];
}

interface DispatchOptions {
  /** Velocidad asumida en m/s para ETA. Default 1.5 (caminando con prisa). */
  walkSpeedMps?: number;
  /** Si la posición último ping es >X segundos vieja, no usar. */
  maxLastSeenStaleSeconds?: number;
}

export function buildDispatchPlan(
  responders: ReadonlyArray<Responder>,
  incident: { kind: IncidentKind; location: IncidentLocation },
  now: Date,
  options: DispatchOptions = {},
): DispatchPlan {
  const requiredRoles = REQUIRED_ROLES_BY_KIND[incident.kind];
  const requiresSif = SIF_CERT_REQUIRED.includes(incident.kind);
  const walkSpeed = options.walkSpeedMps ?? 1.5;
  const maxStale = options.maxLastSeenStaleSeconds ?? 300; // 5 min

  const candidates: DispatchCandidate[] = [];

  for (const r of responders) {
    // Hallar mejor rol matching para esta emergencia
    let matchedRole: ResponderRole | null = null;
    let rolePriority = Infinity;
    for (const role of r.roles) {
      const priority = requiredRoles.indexOf(role);
      if (priority >= 0 && priority < rolePriority) {
        matchedRole = role;
        rolePriority = priority;
      }
    }
    if (matchedRole === null) continue;

    const dist = distance3D(r, incident.location);
    if (dist === null) {
      candidates.push({
        responderUid: r.uid,
        matchedRole,
        distanceMeters: Infinity,
        estimatedArrivalSeconds: Infinity,
        available: false,
        sifCertOk: false,
        matchScore: 0,
        reasonIfRejected: 'no_position_known',
      });
      continue;
    }

    // Last-seen staleness
    let staleOk = true;
    if (r.lastSeenAt) {
      const staleS = (now.getTime() - Date.parse(r.lastSeenAt)) / 1000;
      if (staleS > maxStale) staleOk = false;
    } else {
      staleOk = false;
    }

    const eta = dist / walkSpeed;
    const availability = r.availability === 'on_duty' || r.availability === 'on_break';
    const capacityOk = !r.maxConcurrent || (r.activeAssignments ?? 0) < r.maxConcurrent;
    const sifOk = !requiresSif || r.sifCertified === true;

    let matchScore = 100;
    // Role priority — first in array gana, perderá 15 pts por posición
    matchScore -= rolePriority * 15;
    // On-break responder es elegible pero scored más bajo que on-duty.
    if (r.availability === 'on_break') matchScore -= 10;
    // Distance penalty — cada 100m resta 5
    matchScore -= Math.floor(dist / 100) * 5;
    // ETA penalty — cada 60s resta 5
    matchScore -= Math.floor(eta / 60) * 5;
    // Boost si SIF requerido y tiene
    if (requiresSif && r.sifCertified) matchScore += 15;
    // Capacity penalty
    if (!capacityOk) matchScore -= 30;
    matchScore = Math.max(0, matchScore);

    let reasonIfRejected: string | undefined;
    if (!staleOk) reasonIfRejected = 'last_seen_stale';
    else if (!availability) reasonIfRejected = `availability_${r.availability}`;
    else if (!capacityOk) reasonIfRejected = 'at_capacity';
    else if (!sifOk) reasonIfRejected = 'sif_cert_required_missing';

    candidates.push({
      responderUid: r.uid,
      matchedRole,
      distanceMeters: Math.round(dist),
      estimatedArrivalSeconds: Math.round(eta),
      available: !reasonIfRejected,
      sifCertOk: sifOk,
      matchScore,
      reasonIfRejected,
    });
  }

  // Sort: available first, by matchScore desc
  candidates.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return b.matchScore - a.matchScore;
  });

  const available = candidates.filter((c) => c.available);
  const primary = available[0];
  const backups = available.slice(1, 4);

  const recommendations: string[] = [];
  if (!primary) {
    recommendations.push('🚨 Sin responder disponible — escalar a mutual emergency line + 131 SAMU.');
  } else {
    if (primary.estimatedArrivalSeconds > 600) {
      recommendations.push(`Primary ETA ${Math.round(primary.estimatedArrivalSeconds / 60)} min — considerar contacto mutual paralelo.`);
    }
    if (backups.length === 0) {
      recommendations.push('Sin backups — verificar contactabilidad de responders off-duty.');
    }
    if (requiresSif && primary.sifCertOk) {
      recommendations.push(`SIF cert verificada en primary (${primary.matchedRole}).`);
    }
  }

  return {
    incidentKind: incident.kind,
    primary,
    backups,
    noEligibleResponder: !primary,
    recommendations,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Coverage analysis — para detectar zonas sin coverage
// ────────────────────────────────────────────────────────────────────────

export interface CoverageGap {
  kind: 'no_paramedic'|'no_fire_brigade'|'no_rescue_specialist'|'no_sif_certified'|'undermanned';
  detail: string;
  severity: 'info'|'warning'|'critical';
}

export function analyzeCoverage(responders: ReadonlyArray<Responder>): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  const onDuty = responders.filter((r) => r.availability === 'on_duty');

  const hasParamedic = onDuty.some((r) => r.roles.includes('paramedic'));
  const hasFire = onDuty.some((r) => r.roles.includes('fire_brigade'));
  const hasRescue = onDuty.some((r) => r.roles.includes('rescue_specialist'));
  const hasSif = onDuty.some((r) => r.sifCertified === true);

  if (!hasParamedic) {
    gaps.push({ kind: 'no_paramedic', detail: 'Sin paramédico on-duty — único path es mutual externa.', severity: 'critical' });
  }
  if (!hasFire) {
    gaps.push({ kind: 'no_fire_brigade', detail: 'Sin brigada de emergencia on-duty.', severity: 'warning' });
  }
  if (!hasRescue) {
    gaps.push({ kind: 'no_rescue_specialist', detail: 'Sin rescatista especializado — trabajos en altura/confinados sin backup.', severity: 'warning' });
  }
  if (!hasSif) {
    gaps.push({ kind: 'no_sif_certified', detail: 'Sin SIF cert on-duty.', severity: 'critical' });
  }
  if (onDuty.length < 2) {
    gaps.push({ kind: 'undermanned', detail: `Solo ${onDuty.length} responder on-duty. Mínimo recomendado: 3.`, severity: 'warning' });
  }

  return gaps;
}
