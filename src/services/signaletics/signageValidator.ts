// Praeventio Guard — Sprint 49 §223-227: Validación de señalética +
// detección de faltante + ranking + mapa de evacuación dinámico.
//
// Cierra §223 (validación señalética), §224 (mapa), §225 (detector
// faltante), §226 (ranking 5S — ya cubierto en fiveSAudit), §227
// (validación de rutas alternativas) de la 2da tanda usuario.
//
// 100% determinístico. Vocabulario ISO 7010 + ISO 3864 + NCh 1411.

// ────────────────────────────────────────────────────────────────────────
// Señaléticas canónicas (ISO 7010 + NCh 1411 Chile)
// ────────────────────────────────────────────────────────────────────────

export type SignageCategory =
  | 'prohibition'       // Rojo + barra diagonal (no fumar, no encender llama)
  | 'mandatory'         // Azul circular (uso obligatorio EPP)
  | 'warning'           // Amarillo triángulo (peligro caída, alta tensión)
  | 'safe_condition'    // Verde rectangular (salida emergencia, primeros auxilios)
  | 'fire_equipment'    // Rojo rectangular (extintor, manguera, bocatoma)
  | 'directional';      // Flecha indicador de evacuación

export type SignageCode =
  // Prohibition
  | 'P002_no_smoking'
  | 'P003_no_open_flame'
  | 'P004_no_thoroughfare'
  | 'P006_no_pedestrians'
  // Mandatory
  | 'M001_general_mandatory'
  | 'M003_ear_protection'
  | 'M004_eye_protection'
  | 'M008_foot_protection'
  | 'M009_hand_protection'
  | 'M010_protective_clothing'
  | 'M011_wash_hands'
  | 'M013_face_protection'
  | 'M014_head_protection'
  | 'M016_mask'
  | 'M017_respirator'
  | 'M018_safety_harness'
  // Warning
  | 'W001_general_warning'
  | 'W003_radioactive'
  | 'W004_laser_beam'
  | 'W005_non_ionizing'
  | 'W009_biological_hazard'
  | 'W010_low_temperature'
  | 'W011_slippery_surface'
  | 'W012_electricity'
  | 'W014_forklift_trucks'
  | 'W017_hot_surface'
  | 'W024_crushing_hands'
  // Safe condition
  | 'E001_emergency_exit_left'
  | 'E002_emergency_exit_right'
  | 'E003_first_aid'
  | 'E004_emergency_phone'
  | 'E010_AED'
  | 'E012_eye_wash'
  | 'E013_safety_shower'
  // Fire
  | 'F001_fire_extinguisher'
  | 'F002_fire_hose_reel'
  | 'F004_fire_alarm_call_point'
  | 'F005_fire_emergency_telephone'
  | 'F006_directional_arrow_fire';

export interface SignagePlacement {
  id: string;
  code: SignageCode;
  category: SignageCategory;
  /** Ubicación 3D en faena. */
  position: { lat: number; lng: number; floor?: number };
  /** ISO-8601 cuándo se instaló (auditoría). */
  installedAt: string;
  /** Si requiere mantenimiento periódico (limpieza, retroiluminación, etc.). */
  lastMaintenanceAt?: string;
  /** Si se reportó daño/falta de visibilidad. */
  reportedIssue?: 'damaged' | 'obscured' | 'illegible' | 'wrong_position';
  /** Si está iluminada/reflectiva (requerido en algunas zonas). */
  illuminated?: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Required signage per zone kind
// ────────────────────────────────────────────────────────────────────────

export type ZoneKind =
  | 'office'
  | 'corridor'
  | 'production_floor'
  | 'electrical_room'
  | 'chemical_storage'
  | 'restricted_area'
  | 'evacuation_route'
  | 'first_aid_room'
  | 'maintenance_workshop'
  | 'forklift_area'
  | 'high_temperature_area'
  | 'biological_lab'
  | 'fueling_station'
  | 'confined_space_access';

/**
 * Mapeo de zone → signage codes REQUERIDOS por normativa.
 * Conservador — caller puede sobreescribir/ampliar.
 */
const REQUIRED_SIGNAGE_BY_ZONE: Record<ZoneKind, SignageCode[]> = {
  office: ['E001_emergency_exit_left', 'F001_fire_extinguisher', 'E004_emergency_phone'],
  corridor: ['E001_emergency_exit_left', 'F001_fire_extinguisher', 'F006_directional_arrow_fire'],
  production_floor: [
    'E001_emergency_exit_left',
    'F001_fire_extinguisher',
    'M008_foot_protection',
    'M014_head_protection',
    'E004_emergency_phone',
    'W011_slippery_surface',
  ],
  electrical_room: [
    'W012_electricity',
    'P003_no_open_flame',
    'M001_general_mandatory',
    'F001_fire_extinguisher',
    'F002_fire_hose_reel',
  ],
  chemical_storage: [
    'P002_no_smoking',
    'P003_no_open_flame',
    'M013_face_protection',
    'M016_mask',
    'E012_eye_wash',
    'E013_safety_shower',
    'W009_biological_hazard',
  ],
  restricted_area: ['P004_no_thoroughfare', 'M001_general_mandatory'],
  evacuation_route: [
    'E001_emergency_exit_left',
    'E002_emergency_exit_right',
    'F006_directional_arrow_fire',
  ],
  first_aid_room: ['E003_first_aid', 'E010_AED', 'E004_emergency_phone'],
  maintenance_workshop: [
    'M004_eye_protection',
    'M009_hand_protection',
    'F001_fire_extinguisher',
    'W024_crushing_hands',
  ],
  forklift_area: ['W014_forklift_trucks', 'P006_no_pedestrians', 'M014_head_protection'],
  high_temperature_area: ['W017_hot_surface', 'M010_protective_clothing', 'E013_safety_shower'],
  biological_lab: [
    'W009_biological_hazard',
    'M011_wash_hands',
    'M013_face_protection',
    'M016_mask',
    'E012_eye_wash',
  ],
  fueling_station: [
    'P002_no_smoking',
    'P003_no_open_flame',
    'F001_fire_extinguisher',
    'F002_fire_hose_reel',
  ],
  confined_space_access: [
    'P004_no_thoroughfare',
    'W001_general_warning',
    'M017_respirator',
    'M018_safety_harness',
    'E004_emergency_phone',
  ],
};

export function requiredSignageForZone(zone: ZoneKind, extra: SignageCode[] = []): SignageCode[] {
  const base = REQUIRED_SIGNAGE_BY_ZONE[zone] ?? [];
  return Array.from(new Set([...base, ...extra]));
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

export interface SignageZoneAudit {
  zoneId: string;
  zoneKind: ZoneKind;
  /** Señaléticas instaladas presentes en la zona. */
  placedSignage: SignagePlacement[];
  /** Codes adicionales requeridos para esta zone (custom). */
  extraRequired?: SignageCode[];
}

export type SignageFinding =
  | 'missing_required'
  | 'present_but_damaged'
  | 'present_but_obscured'
  | 'present_but_illegible'
  | 'wrong_position'
  | 'maintenance_overdue';

export interface SignageGap {
  kind: SignageFinding;
  code: SignageCode;
  detail: string;
  /** Peso para el ranking 0-10 (más = más crítico). */
  weight: number;
}

export interface ZoneAuditResult {
  zoneId: string;
  zoneKind: ZoneKind;
  gaps: SignageGap[];
  /** 0..100 — 100 = todo presente y en buen estado. */
  complianceScore: number;
  /** Si requiere intervención inmediata (gap weight ≥8). */
  criticalIntervention: boolean;
}

const CODE_CRITICALITY: Partial<Record<SignageCode, number>> = {
  // Critical safety
  E001_emergency_exit_left: 10,
  E002_emergency_exit_right: 10,
  F001_fire_extinguisher: 10,
  F002_fire_hose_reel: 9,
  E013_safety_shower: 10,
  E012_eye_wash: 10,
  E010_AED: 9,
  P002_no_smoking: 9, // gasolinera / químicos
  P003_no_open_flame: 9,
  W012_electricity: 9,
  M017_respirator: 9, // confined space
  M018_safety_harness: 9,
  // Important
  E003_first_aid: 7,
  E004_emergency_phone: 7,
  F006_directional_arrow_fire: 7,
  W001_general_warning: 6,
  M014_head_protection: 6,
  M008_foot_protection: 6,
  // Standard mandatory
  M001_general_mandatory: 4,
  M013_face_protection: 5,
};

function criticalityOf(code: SignageCode): number {
  return CODE_CRITICALITY[code] ?? 4;
}

const MAINTENANCE_INTERVAL_DAYS = 180;

export function auditZoneSignage(audit: SignageZoneAudit, now: Date): ZoneAuditResult {
  const required = requiredSignageForZone(audit.zoneKind, audit.extraRequired);
  const placed = audit.placedSignage;
  const placedCodes = new Set(placed.map((p) => p.code));
  const gaps: SignageGap[] = [];

  // Detect missing
  for (const code of required) {
    if (!placedCodes.has(code)) {
      gaps.push({
        kind: 'missing_required',
        code,
        detail: `Señalética requerida ${code} no instalada en la zona ${audit.zoneId}.`,
        weight: criticalityOf(code),
      });
    }
  }

  // Detect issues in placed signage
  for (const p of placed) {
    if (p.reportedIssue === 'damaged') {
      gaps.push({
        kind: 'present_but_damaged',
        code: p.code,
        detail: `Señalética ${p.code} reportada como dañada.`,
        weight: criticalityOf(p.code),
      });
    } else if (p.reportedIssue === 'obscured') {
      gaps.push({
        kind: 'present_but_obscured',
        code: p.code,
        detail: `Señalética ${p.code} obstruida (no visible).`,
        weight: criticalityOf(p.code) * 0.8,
      });
    } else if (p.reportedIssue === 'illegible') {
      gaps.push({
        kind: 'present_but_illegible',
        code: p.code,
        detail: `Señalética ${p.code} ilegible.`,
        weight: criticalityOf(p.code) * 0.9,
      });
    } else if (p.reportedIssue === 'wrong_position') {
      gaps.push({
        kind: 'wrong_position',
        code: p.code,
        detail: `Señalética ${p.code} en posición incorrecta.`,
        weight: criticalityOf(p.code) * 0.7,
      });
    }

    // Maintenance overdue
    const baseRef = p.lastMaintenanceAt ?? p.installedAt;
    const daysSince = (now.getTime() - Date.parse(baseRef)) / 86_400_000;
    if (daysSince > MAINTENANCE_INTERVAL_DAYS) {
      gaps.push({
        kind: 'maintenance_overdue',
        code: p.code,
        detail: `Señalética ${p.code} sin mantenimiento desde ${Math.floor(daysSince)} días.`,
        weight: criticalityOf(p.code) * 0.5,
      });
    }
  }

  // Compute compliance score
  const requiredTotalWeight = required.reduce((s, c) => s + criticalityOf(c), 0);
  const gapsWeight = gaps.reduce((s, g) => s + g.weight, 0);
  const complianceScore = requiredTotalWeight === 0
    ? 100
    : Math.max(0, Math.round(100 - (gapsWeight / requiredTotalWeight) * 100));

  const criticalIntervention = gaps.some((g) => g.weight >= 8);

  return {
    zoneId: audit.zoneId,
    zoneKind: audit.zoneKind,
    gaps,
    complianceScore,
    criticalIntervention,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Ranking de gaps por sitio (multi-zona)
// ────────────────────────────────────────────────────────────────────────

export interface SiteRanking {
  /** Ordenadas por gaps weight desc. */
  zonesByPriority: Array<{ zoneId: string; zoneKind: ZoneKind; gapsCount: number; totalWeight: number; complianceScore: number }>;
  /** Gaps acumulados por code para detectar patrones (siempre falta extintor, etc.). */
  topPatterns: Array<{ code: SignageCode; occurrences: number; totalWeight: number }>;
  /** Sitios que requieren intervención inmediata. */
  criticalZones: string[];
}

export function rankSiteSignage(audits: ZoneAuditResult[]): SiteRanking {
  const zonesByPriority = audits
    .map((a) => ({
      zoneId: a.zoneId,
      zoneKind: a.zoneKind,
      gapsCount: a.gaps.length,
      totalWeight: a.gaps.reduce((s, g) => s + g.weight, 0),
      complianceScore: a.complianceScore,
    }))
    .sort((a, b) => b.totalWeight - a.totalWeight);

  const patternMap = new Map<SignageCode, { occurrences: number; totalWeight: number }>();
  for (const audit of audits) {
    for (const gap of audit.gaps) {
      const cur = patternMap.get(gap.code) ?? { occurrences: 0, totalWeight: 0 };
      cur.occurrences += 1;
      cur.totalWeight += gap.weight;
      patternMap.set(gap.code, cur);
    }
  }
  const topPatterns = Array.from(patternMap.entries())
    .map(([code, stats]) => ({ code, ...stats }))
    .sort((a, b) => b.totalWeight - a.totalWeight)
    .slice(0, 10);

  const criticalZones = audits.filter((a) => a.criticalIntervention).map((a) => a.zoneId);

  return { zonesByPriority, topPatterns, criticalZones };
}

// ────────────────────────────────────────────────────────────────────────
// Mapa de evacuación dinámico — recomienda ruta primaria + alternativas
// ────────────────────────────────────────────────────────────────────────

export interface EvacuationNode {
  id: string;
  position: { lat: number; lng: number; floor?: number };
  /** Salida final (true = salida del edificio). */
  isExit?: boolean;
  /** Si está bloqueada/comprometida (smoke, fire, collapse). */
  blocked?: boolean;
  /** Conexiones a otros nodos. */
  connectsTo: string[];
}

export interface EvacuationPath {
  /** Secuencia de IDs desde start hasta exit. */
  nodes: string[];
  /** Distancia total estimada en metros. */
  distanceMeters: number;
  /** Si pasa por zonas críticas. */
  riskyZonesTouched: string[];
}

function distanceMeters(a: EvacuationNode, b: EvacuationNode): number {
  const dLat = (b.position.lat - a.position.lat) * 111_000;
  const dLng = (b.position.lng - a.position.lng) * 111_000 * Math.cos(a.position.lat * Math.PI / 180);
  const dFloor = ((b.position.floor ?? 0) - (a.position.floor ?? 0)) * 3.5; // 3.5m por piso
  return Math.sqrt(dLat * dLat + dLng * dLng + dFloor * dFloor);
}

/**
 * BFS hasta encontrar todas las exits desde startId. Devuelve top-3
 * rutas más cortas no bloqueadas.
 */
export function findEvacuationPaths(
  nodes: ReadonlyArray<EvacuationNode>,
  startId: string,
  riskyZones: Set<string> = new Set(),
  maxRoutes = 3,
): EvacuationPath[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const start = byId.get(startId);
  if (!start) return [];

  const exits = nodes.filter((n) => n.isExit && !n.blocked);
  if (exits.length === 0) return [];

  // BFS con tracking de path
  const results: EvacuationPath[] = [];
  const queue: Array<{ path: string[]; visited: Set<string> }> = [
    { path: [startId], visited: new Set([startId]) },
  ];

  while (queue.length > 0 && results.length < maxRoutes * 3) {
    const { path, visited } = queue.shift()!;
    const last = byId.get(path[path.length - 1]!);
    if (!last) continue;

    if (last.isExit && !last.blocked) {
      let dist = 0;
      const risky: string[] = [];
      for (let i = 0; i < path.length - 1; i++) {
        const a = byId.get(path[i]!)!;
        const b = byId.get(path[i + 1]!)!;
        dist += distanceMeters(a, b);
        if (riskyZones.has(path[i + 1]!)) risky.push(path[i + 1]!);
      }
      results.push({ nodes: path, distanceMeters: Math.round(dist), riskyZonesTouched: risky });
      continue;
    }

    for (const neighborId of last.connectsTo) {
      const neighbor = byId.get(neighborId);
      if (!neighbor || neighbor.blocked || visited.has(neighborId)) continue;
      queue.push({
        path: [...path, neighborId],
        visited: new Set([...visited, neighborId]),
      });
    }
  }

  // Sort: zonas riesgosas asc (menos = mejor), luego distancia asc.
  results.sort((a, b) => {
    if (a.riskyZonesTouched.length !== b.riskyZonesTouched.length) {
      return a.riskyZonesTouched.length - b.riskyZonesTouched.length;
    }
    return a.distanceMeters - b.distanceMeters;
  });

  return results.slice(0, maxRoutes);
}
