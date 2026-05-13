// Praeventio Guard — Sprint 42 Fase F.14: Mapa de Calor de Hallazgos.
//
// Cierra Plan F.14 "Mapa Calor Hallazgos". Agrega coordenadas de
// findings/incidentes en celdas geo simples y produce un dataset
// que el componente UI Maps puede pintar como heatmap o cuadrícula.
//
// 100% determinístico, sin Maps API, sin LLM. El servicio prepara
// el dataset; la UI decide cómo renderizarlo (SVG top-down o Maps).
//
// Notas geográficas:
//   - Se usa una aproximación local-plano: 1° lat ≈ 111_320 m,
//     1° lng ≈ 111_320 * cos(lat) m. Adecuado para celdas de
//     decenas a cientos de metros en una sola faena/obra.
//   - El binning se hace en grados convertidos desde gridSizeM
//     para evitar acumular floating-point en lat/lng.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface FindingPoint {
  id: string;
  lat: number;
  lng: number;
  severity: Severity;
  occurredAt: string; // ISO
  category: string;
}

export interface HeatCell {
  /** Centro de la celda en lat. */
  lat: number;
  /** Centro de la celda en lng. */
  lng: number;
  /** Peso agregado: Σ severityWeight. */
  weight: number;
  /** Cantidad de findings en la celda. */
  count: number;
  /** Severidad dominante (mayoría; empate → la más alta). */
  dominantSeverity: Severity;
}

export interface HeatmapBuildOptions {
  /** Tamaño de la celda en metros (lado). */
  gridSizeM: number;
  /** Filtra celdas con < minCount findings (default 1). */
  minCount?: number;
}

export interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// ────────────────────────────────────────────────────────────────────────
// Severity weights
// ────────────────────────────────────────────────────────────────────────

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 1,
  medium: 3,
  high: 7,
  critical: 12,
};

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const METERS_PER_DEG_LAT = 111_320;

function metersPerDegLng(latDeg: number): number {
  return METERS_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

// ────────────────────────────────────────────────────────────────────────
// BBox
// ────────────────────────────────────────────────────────────────────────

export function bboxOf(points: ReadonlyArray<Pick<FindingPoint, 'lat' | 'lng'>>): BBox | null {
  if (points.length === 0) return null;
  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

// ────────────────────────────────────────────────────────────────────────
// Binning
// ────────────────────────────────────────────────────────────────────────

function dominantSeverity(severities: Severity[]): Severity {
  const counts: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const s of severities) counts[s] += 1;
  let best: Severity = 'low';
  let bestCount = -1;
  for (const s of ['low', 'medium', 'high', 'critical'] as Severity[]) {
    if (counts[s] > bestCount || (counts[s] === bestCount && SEVERITY_RANK[s] > SEVERITY_RANK[best])) {
      best = s;
      bestCount = counts[s];
    }
  }
  return best;
}

export function buildHeatmapCells(
  findings: ReadonlyArray<FindingPoint>,
  options: HeatmapBuildOptions,
): HeatCell[] {
  if (findings.length === 0) return [];
  const minCount = options.minCount ?? 1;
  if (options.gridSizeM <= 0) {
    throw new Error('gridSizeM must be > 0');
  }

  // Usamos lat promedio para convertir metros a grados lng (estable para
  // áreas pequeñas; suficiente para una faena/obra).
  let sumLat = 0;
  for (const f of findings) sumLat += f.lat;
  const meanLat = sumLat / findings.length;

  const dLat = options.gridSizeM / METERS_PER_DEG_LAT;
  const dLng = options.gridSizeM / metersPerDegLng(meanLat);

  const buckets = new Map<
    string,
    { iLat: number; iLng: number; weight: number; count: number; severities: Severity[] }
  >();

  for (const f of findings) {
    const iLat = Math.floor(f.lat / dLat);
    const iLng = Math.floor(f.lng / dLng);
    const key = `${iLat}:${iLng}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { iLat, iLng, weight: 0, count: 0, severities: [] };
      buckets.set(key, bucket);
    }
    bucket.weight += SEVERITY_WEIGHT[f.severity];
    bucket.count += 1;
    bucket.severities.push(f.severity);
  }

  const cells: HeatCell[] = [];
  for (const b of buckets.values()) {
    if (b.count < minCount) continue;
    cells.push({
      // centro de celda
      lat: (b.iLat + 0.5) * dLat,
      lng: (b.iLng + 0.5) * dLng,
      weight: b.weight,
      count: b.count,
      dominantSeverity: dominantSeverity(b.severities),
    });
  }

  // Orden estable: weight desc → count desc → lat asc → lng asc.
  cells.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (b.count !== a.count) return b.count - a.count;
    if (a.lat !== b.lat) return a.lat - b.lat;
    return a.lng - b.lng;
  });

  return cells;
}

// ────────────────────────────────────────────────────────────────────────
// Hotspots
// ────────────────────────────────────────────────────────────────────────

export function pickHotspots(cells: ReadonlyArray<HeatCell>, topN: number): HeatCell[] {
  if (topN <= 0) return [];
  return cells.slice(0, topN);
}
