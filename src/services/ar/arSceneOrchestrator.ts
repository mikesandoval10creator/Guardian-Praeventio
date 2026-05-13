// Praeventio Guard — Sprint 48 E.1 (cierre): AR scene orchestrator.
//
// Dado un set de RiskNode con posición geográfica + posición del usuario
// + capabilities AR, decide qué markers proyectar en la escena AR + cómo
// (color por severidad, escala por distancia, anchor type).
//
// 100% determinístico. NO interactúa con WebXR — produce un "scene plan"
// que el componente AR consume y renderiza.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface GeoPosition {
  lat: number;
  lng: number;
  /** Altitud opcional. */
  altMeters?: number;
}

export interface ArRiskNode {
  id: string;
  /** Posición geográfica del riesgo. */
  geo: GeoPosition;
  /** Severidad para color/escala. */
  severity: 'low' | 'medium' | 'high' | 'critical' | 'sif';
  /** Nombre corto para el label. */
  label: string;
  /** Kind para iconografía. */
  kind: 'fall' | 'electric' | 'chemical' | 'mechanical' | 'thermal' | 'ambient' | 'restricted_zone';
}

export interface ArSceneOptions {
  /** Radio máximo (metros) — riesgos fuera del radio se descartan. */
  maxDistanceMeters?: number;
  /** Máximo de markers a mostrar (saturation prevention). */
  maxMarkers?: number;
  /** Si solo se muestran severidades high+. */
  criticalOnly?: boolean;
  /** Soporta anchors persistentes (depende de plataforma). */
  hasAnchors?: boolean;
}

export interface ArMarker {
  id: string;
  /** Coordenadas locales respecto al usuario (East, Up, North en metros). */
  localOffset: { east: number; up: number; north: number };
  distanceMeters: number;
  severity: ArRiskNode['severity'];
  /** Color hex para el marker. */
  color: string;
  /** Escala 0..1 — más lejos = más chico. */
  scale: number;
  label: string;
  kind: ArRiskNode['kind'];
  /** Si el marker está fuera del FOV del usuario. */
  outOfFov: boolean;
}

export interface ArScenePlan {
  markers: ArMarker[];
  /** Markers omitidos + razón (para audit). */
  skipped: Array<{ id: string; reason: 'out_of_range' | 'over_cap' | 'severity_filter' }>;
  /** Stats. */
  stats: {
    inputCount: number;
    rendered: number;
    skippedOutOfRange: number;
    skippedOverCap: number;
    skippedSeverityFilter: number;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Geo math
// ────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

/**
 * Haversine — distancia en metros entre 2 puntos geográficos.
 */
export function haversineMeters(a: GeoPosition, b: GeoPosition): number {
  const dLat = deg2rad(b.lat - a.lat);
  const dLng = deg2rad(b.lng - a.lng);
  const lat1 = deg2rad(a.lat);
  const lat2 = deg2rad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

/**
 * Bearing inicial en radianes desde `from` hacia `to` (norte=0, este=π/2).
 */
function bearingRadians(from: GeoPosition, to: GeoPosition): number {
  const lat1 = deg2rad(from.lat);
  const lat2 = deg2rad(to.lat);
  const dLng = deg2rad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.atan2(y, x);
}

/**
 * Proyecta el riesgo a coordenadas locales East/Up/North respecto al usuario.
 */
function toLocalOffset(user: GeoPosition, risk: GeoPosition): { east: number; up: number; north: number } {
  const distance = haversineMeters(user, risk);
  const bearing = bearingRadians(user, risk);
  return {
    east: distance * Math.sin(bearing),
    north: distance * Math.cos(bearing),
    up: (risk.altMeters ?? 0) - (user.altMeters ?? 0),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Color / scale per severity
// ────────────────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<ArRiskNode['severity'], string> = {
  low: '#10b981',
  medium: '#fbbf24',
  high: '#fb923c',
  critical: '#ef4444',
  sif: '#7f1d1d',
};

const SEVERITY_RANK: Record<ArRiskNode['severity'], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
  sif: 5,
};

function scaleForDistance(distanceMeters: number, maxRange: number): number {
  // Cerca (≤5m) → 1.0, lejos (=maxRange) → 0.3
  const t = Math.min(1, distanceMeters / maxRange);
  return 1 - 0.7 * t;
}

// ────────────────────────────────────────────────────────────────────────
// Main API
// ────────────────────────────────────────────────────────────────────────

const DEFAULTS: Required<ArSceneOptions> = {
  maxDistanceMeters: 200,
  maxMarkers: 25,
  criticalOnly: false,
  hasAnchors: false,
};

export function buildArScenePlan(
  user: GeoPosition,
  /** Heading del usuario en radianes (0=norte). Por ahora ignorado en
   *  FOV check — el caller que aplique para "out_of_fov" si quiere. */
  userHeadingRadians: number,
  risks: ReadonlyArray<ArRiskNode>,
  options: ArSceneOptions = {},
): ArScenePlan {
  const opts: Required<ArSceneOptions> = { ...DEFAULTS, ...options };
  const skipped: ArScenePlan['skipped'] = [];

  // 1. Filter by severity (criticalOnly)
  const severityFiltered: Array<{ risk: ArRiskNode; distance: number }> = [];
  for (const r of risks) {
    if (opts.criticalOnly && SEVERITY_RANK[r.severity] < 3) {
      skipped.push({ id: r.id, reason: 'severity_filter' });
      continue;
    }
    const distance = haversineMeters(user, r.geo);
    if (distance > opts.maxDistanceMeters) {
      skipped.push({ id: r.id, reason: 'out_of_range' });
      continue;
    }
    severityFiltered.push({ risk: r, distance });
  }

  // 2. Sort: severity desc, then distance asc (más relevante primero)
  severityFiltered.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.risk.severity] - SEVERITY_RANK[a.risk.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.distance - b.distance;
  });

  // 3. Cap N markers
  const capped = severityFiltered.slice(0, opts.maxMarkers);
  for (const { risk } of severityFiltered.slice(opts.maxMarkers)) {
    skipped.push({ id: risk.id, reason: 'over_cap' });
  }

  // 4. Build markers
  const markers: ArMarker[] = capped.map(({ risk, distance }) => ({
    id: risk.id,
    localOffset: toLocalOffset(user, risk.geo),
    distanceMeters: distance,
    severity: risk.severity,
    color: SEVERITY_COLOR[risk.severity],
    scale: scaleForDistance(distance, opts.maxDistanceMeters),
    label: risk.label,
    kind: risk.kind,
    outOfFov: false, // FOV calculation requires more state — placeholder
  }));

  // FOV check rough: marker.outOfFov si bearing - userHeading > 60°
  if (Number.isFinite(userHeadingRadians)) {
    const halfFov = Math.PI / 3; // 60° → ±60° = 120° total
    for (const m of markers) {
      const markerBearing = Math.atan2(m.localOffset.east, m.localOffset.north);
      let delta = Math.abs(markerBearing - userHeadingRadians);
      if (delta > Math.PI) delta = 2 * Math.PI - delta;
      m.outOfFov = delta > halfFov;
    }
  }

  return {
    markers,
    skipped,
    stats: {
      inputCount: risks.length,
      rendered: markers.length,
      skippedOutOfRange: skipped.filter((s) => s.reason === 'out_of_range').length,
      skippedOverCap: skipped.filter((s) => s.reason === 'over_cap').length,
      skippedSeverityFilter: skipped.filter((s) => s.reason === 'severity_filter').length,
    },
  };
}
