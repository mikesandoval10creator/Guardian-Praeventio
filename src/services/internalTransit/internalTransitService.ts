// Praeventio Guard — Sprint 39 Fase L.10: Tránsito Interno + Convivencia.
//
// Cierra: Documento usuario "§363-375" — Top usuario #13
//
// Equipos móviles (camiones, grúas, cargadores) compartiendo espacio
// con peatones es la #1 causa de fatalidades en minería/construcción.
// Este módulo aporta los engines deterministas necesarios:
//
//   - BlindSpotMap: registro de zonas donde operadores no ven peatones
//   - PreOpVehicleChecklist: validación pre-operacional por tipo de vehículo
//   - InternalSpeedZone: geocercas con límite recomendado
//   - NearMissVehicleReport: flujo dedicado near-miss
//   - PersonnelTransportLog: lista pasajeros + conductor + ruta + estado
//   - DriverFatigueRegister: horas al volante + descanso
//   - RouteRiskAssessment: clima + incendios + cortes + estado caminos
//   - RescueRoutePlan: puntos apoyo + contactos + zonas sin señal
//
// Todo puro, sin LLM. Las reglas vienen de MUTUAL ACHS + ISO 39001
// + buenas prácticas Codelco.

// ────────────────────────────────────────────────────────────────────────
// 1. Vehicle pre-op checklist
// ────────────────────────────────────────────────────────────────────────

export type VehicleKind =
  | 'camion_grande'      // >7.5 t
  | 'camioneta'
  | 'cargador_frontal'
  | 'grua_movil'
  | 'minibus_personal'
  | 'bus_personal';

export interface PreOpChecklistItem {
  id: string;
  label: string;
  /** Si la falta de este item bloquea operación. */
  blocking: boolean;
}

const CHECKLIST_BY_VEHICLE: Record<VehicleKind, PreOpChecklistItem[]> = {
  camion_grande: [
    { id: 'frenos', label: 'Frenos operativos (no esponjosos)', blocking: true },
    { id: 'luces', label: 'Luces alta + baja + intermitentes', blocking: true },
    { id: 'alarma_retroceso', label: 'Alarma de retroceso audible', blocking: true },
    { id: 'espejos', label: 'Espejos retrovisores ajustados sin daño', blocking: true },
    { id: 'extintor', label: 'Extintor vigente y accesible', blocking: false },
    { id: 'cinturon', label: 'Cinturón conductor + acompañante operativos', blocking: true },
    { id: 'cabin_clean', label: 'Cabina libre de objetos sueltos', blocking: false },
  ],
  camioneta: [
    { id: 'frenos', label: 'Frenos operativos', blocking: true },
    { id: 'luces', label: 'Luces operativas', blocking: true },
    { id: 'cinturon', label: 'Cinturones operativos para todos los ocupantes', blocking: true },
    { id: 'kit_emergencia', label: 'Kit emergencia (botiquín + agua + radio)', blocking: false },
    { id: 'neumaticos', label: 'Neumáticos con dibujo > 3mm', blocking: true },
  ],
  cargador_frontal: [
    { id: 'frenos', label: 'Frenos hidráulicos sin fuga', blocking: true },
    { id: 'cuchillo_pala', label: 'Pala/cuchillo sin daños', blocking: false },
    { id: 'alarma_retroceso', label: 'Alarma retroceso audible', blocking: true },
    { id: 'rops_fops', label: 'ROPS/FOPS instalados', blocking: true },
    { id: 'extintor', label: 'Extintor vigente', blocking: false },
  ],
  grua_movil: [
    { id: 'frenos', label: 'Frenos sin fuga hidráulica', blocking: true },
    { id: 'cables', label: 'Cables/ganchos sin deformación', blocking: true },
    { id: 'tabla_cargas', label: 'Tabla de cargas en cabina visible', blocking: true },
    { id: 'anemometro', label: 'Anemómetro operativo', blocking: true },
    { id: 'estabilizadores', label: 'Estabilizadores extendidos correctamente', blocking: true },
  ],
  minibus_personal: [
    { id: 'frenos', label: 'Frenos operativos', blocking: true },
    { id: 'cinturones_todos', label: 'Cinturones para todos los pasajeros', blocking: true },
    { id: 'puerta_emergencia', label: 'Puerta emergencia operativa', blocking: true },
    { id: 'extintor', label: 'Extintor vigente', blocking: true },
    { id: 'botiquin', label: 'Botiquín completo', blocking: false },
  ],
  bus_personal: [
    { id: 'frenos', label: 'Frenos operativos', blocking: true },
    { id: 'cinturones_todos', label: 'Cinturones para todos los pasajeros', blocking: true },
    { id: 'salida_emergencia', label: 'Salidas emergencia despejadas', blocking: true },
    { id: 'extintor', label: 'Extintor vigente', blocking: true },
    { id: 'gps', label: 'GPS/Telemetría operativos', blocking: false },
    { id: 'velocimetro', label: 'Velocímetro y limitador operativos', blocking: true },
  ],
};

export function getPreOpChecklist(kind: VehicleKind): PreOpChecklistItem[] {
  return CHECKLIST_BY_VEHICLE[kind];
}

export interface PreOpResponse {
  itemId: string;
  passed: boolean;
  notes?: string;
}

export interface PreOpResult {
  vehicleKind: VehicleKind;
  passed: boolean;
  blockingFailures: string[];
  warnings: string[];
}

export function validatePreOpChecklist(
  kind: VehicleKind,
  responses: PreOpResponse[],
): PreOpResult {
  const checklist = getPreOpChecklist(kind);
  const blockingFailures: string[] = [];
  const warnings: string[] = [];
  const responseById = new Map(responses.map((r) => [r.itemId, r]));

  for (const item of checklist) {
    const resp = responseById.get(item.id);
    if (!resp || !resp.passed) {
      if (item.blocking) blockingFailures.push(item.id);
      else warnings.push(item.id);
    }
  }

  return {
    vehicleKind: kind,
    passed: blockingFailures.length === 0,
    blockingFailures,
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 2. Blind spot map
// ────────────────────────────────────────────────────────────────────────

export interface BlindSpot {
  /** UUID. */
  id: string;
  /** Vehículo asociado (el operador de este vehículo no ve esta zona). */
  vehicleKind: VehicleKind;
  /** Tipo de zona ciega. */
  position: 'trasera' | 'lateral_izq' | 'lateral_der' | 'frontal_baja' | 'frontal_alta';
  /** Distancia desde el vehículo (m) hasta donde se extiende la zona ciega. */
  reachMeters: number;
  /** Recomendación canónica. */
  mitigation: string;
}

/** Distancia mínima recomendada peatón ↔ vehículo en operación. */
export const PEDESTRIAN_BUFFER_METERS: Record<VehicleKind, number> = {
  camion_grande: 5,
  camioneta: 2,
  cargador_frontal: 8,
  grua_movil: 10,
  minibus_personal: 2,
  bus_personal: 3,
};

export function recommendedPedestrianBuffer(kind: VehicleKind): number {
  return PEDESTRIAN_BUFFER_METERS[kind];
}

// ────────────────────────────────────────────────────────────────────────
// 3. Internal speed zones
// ────────────────────────────────────────────────────────────────────────

export interface SpeedZone {
  id: string;
  label: string;
  /** Polígono GeoJSON simplificado: array de [lng, lat]. */
  polygon: Array<[number, number]>;
  /** Velocidad máxima permitida (km/h). */
  maxSpeedKmh: number;
}

/**
 * Determina si un punto está dentro de un polígono (ray casting).
 * Sin libs externas — para uso ligero en client + server.
 */
export function pointInPolygon(
  point: [number, number],
  polygon: Array<[number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface SpeedComplianceCheck {
  zone: SpeedZone | null;
  currentSpeedKmh: number;
  /** Si va por encima del límite de la zona donde está. */
  isOverLimit: boolean;
  /** Excedencia % sobre límite. */
  excessPercent: number;
}

export function checkSpeedCompliance(
  point: [number, number],
  currentSpeedKmh: number,
  zones: SpeedZone[],
): SpeedComplianceCheck {
  const zone = zones.find((z) => pointInPolygon(point, z.polygon)) ?? null;
  if (!zone) {
    return { zone: null, currentSpeedKmh, isOverLimit: false, excessPercent: 0 };
  }
  const isOverLimit = currentSpeedKmh > zone.maxSpeedKmh;
  const excessPercent = isOverLimit
    ? Math.round(((currentSpeedKmh - zone.maxSpeedKmh) / zone.maxSpeedKmh) * 100)
    : 0;
  return { zone, currentSpeedKmh, isOverLimit, excessPercent };
}

// ────────────────────────────────────────────────────────────────────────
// 4. Driver fatigue
// ────────────────────────────────────────────────────────────────────────

export interface DriverShiftRecord {
  driverUid: string;
  startedAt: string;
  /** Horas al volante en este turno (acumuladas). */
  hoursAtWheel: number;
  /** Horas de descanso desde último turno (al inicio de este). */
  restHoursBefore: number;
}

export interface FatigueAssessment {
  driverUid: string;
  /** 0-100, mayor = más fatigado. */
  fatigueScore: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  shouldRotate: boolean;
  recommendations: string[];
}

/**
 * Combina horas al volante + descanso previo. Reglas:
 *   - >5h volante seguidas = high
 *   - >8h volante = critical
 *   - <8h descanso previo = medium baseline
 *   - <6h descanso previo = high baseline
 */
export function assessDriverFatigue(record: DriverShiftRecord): FatigueAssessment {
  let score = 0;
  const recommendations: string[] = [];

  if (record.hoursAtWheel >= 8) {
    score += 60;
    recommendations.push('Rotar conductor inmediatamente: >8h al volante');
  } else if (record.hoursAtWheel >= 5) {
    score += 35;
    recommendations.push('Pausa obligatoria 30min; preparar conductor de relevo');
  } else if (record.hoursAtWheel >= 3) {
    score += 15;
    recommendations.push('Pausa de 15min recomendada');
  }

  if (record.restHoursBefore < 6) {
    score += 35;
    recommendations.push('Descanso previo insuficiente (<6h) — NO debería conducir');
  } else if (record.restHoursBefore < 8) {
    score += 15;
    recommendations.push('Descanso previo justo (<8h) — monitorear');
  }

  let level: 'low' | 'medium' | 'high' | 'critical';
  if (score >= 70) level = 'critical';
  else if (score >= 45) level = 'high';
  else if (score >= 20) level = 'medium';
  else level = 'low';

  return {
    driverUid: record.driverUid,
    fatigueScore: Math.min(score, 100),
    level,
    shouldRotate: level === 'high' || level === 'critical',
    recommendations,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 5. Route risk assessment
// ────────────────────────────────────────────────────────────────────────

export interface RouteCondition {
  weather: 'clear' | 'rain' | 'snow' | 'fog' | 'dust_storm';
  roadState: 'good' | 'wet' | 'icy' | 'damaged' | 'closed';
  externalAlerts: Array<'fire' | 'roadblock' | 'protest' | 'flood' | 'rockfall'>;
}

export interface RouteRiskReport {
  riskScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  shouldDelay: boolean;
  factors: string[];
}

export function assessRouteRisk(condition: RouteCondition): RouteRiskReport {
  let score = 0;
  const factors: string[] = [];

  const weatherScore: Record<RouteCondition['weather'], number> = {
    clear: 0,
    rain: 20,
    snow: 40,
    fog: 30,
    dust_storm: 35,
  };
  score += weatherScore[condition.weather];
  if (condition.weather !== 'clear') factors.push(`Clima: ${condition.weather}`);

  const roadScore: Record<RouteCondition['roadState'], number> = {
    good: 0,
    wet: 15,
    icy: 50,
    damaged: 30,
    closed: 100,
  };
  score += roadScore[condition.roadState];
  if (condition.roadState !== 'good') factors.push(`Estado camino: ${condition.roadState}`);

  for (const alert of condition.externalAlerts) {
    const alertScore: Record<string, number> = {
      fire: 60,
      roadblock: 80,
      protest: 50,
      flood: 70,
      rockfall: 55,
    };
    score += alertScore[alert] ?? 30;
    factors.push(`Alerta externa: ${alert}`);
  }

  score = Math.min(score, 100);
  let riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  if (score >= 80) riskLevel = 'extreme';
  else if (score >= 50) riskLevel = 'high';
  else if (score >= 25) riskLevel = 'medium';
  else riskLevel = 'low';

  return {
    riskScore: score,
    riskLevel,
    shouldDelay: riskLevel === 'extreme' || condition.roadState === 'closed',
    factors,
  };
}
