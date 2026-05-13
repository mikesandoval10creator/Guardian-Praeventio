// Praeventio Guard — Sprint 41 Fase F.29: Indicadores tendencia incidentes.
//
// Cierra Plan F.29 "Indicadores tendencia incidentes (time series sobre
// NodeType.INCIDENT)".
//
// Convierte historial de incidents en series temporales agregadas:
//   - Conteo por mes/semana/día
//   - Promedio móvil + dirección (rising / stable / falling)
//   - Comparación período actual vs anterior
//   - Detección de outliers (3σ)
//   - Top categorías por período
//
// 100% determinístico, sin ML, sin LLM. Input = lista de incidents
// con timestamp + clasificación. Output = series listas para Recharts.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type Granularity = 'day' | 'week' | 'month';
export type TrendDirection = 'rising' | 'stable' | 'falling';

export interface IncidentRecord {
  id: string;
  /** ISO-8601. */
  occurredAt: string;
  severity: IncidentSeverity;
  /** Categoría: 'caída', 'golpe', 'electrico', etc. */
  category: string;
}

export interface TrendPoint {
  /** Bucket key (YYYY-MM-DD para day, YYYY-Www para week, YYYY-MM para month). */
  bucket: string;
  /** Inicio del bucket en ISO. */
  bucketStartIso: string;
  count: number;
  /** Breakdown por severity. */
  bySeverity: Record<IncidentSeverity, number>;
}

export interface TrendSeries {
  granularity: Granularity;
  points: TrendPoint[];
  /** Promedio simple del count. */
  avgCount: number;
  /** Promedio móvil 3-bucket. */
  movingAvg3: number[];
  /** Dirección de la tendencia (slope del fit lineal). */
  direction: TrendDirection;
  /** Slope numérico (incidents per bucket). */
  slope: number;
}

// ────────────────────────────────────────────────────────────────────────
// Bucket helpers
// ────────────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function bucketKeyFor(date: Date, granularity: Granularity): string {
  const y = date.getUTCFullYear();
  if (granularity === 'month') {
    return `${y}-${pad(date.getUTCMonth() + 1)}`;
  }
  if (granularity === 'week') {
    // ISO week-of-year approximation: día Jueves de la semana
    const target = new Date(Date.UTC(y, date.getUTCMonth(), date.getUTCDate()));
    const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0, Sun=6
    target.setUTCDate(target.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const diff = target.getTime() - firstThursday.getTime();
    const week = 1 + Math.round(diff / (7 * 86_400_000));
    return `${target.getUTCFullYear()}-W${pad(week)}`;
  }
  // day
  return `${y}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function bucketStartIso(date: Date, granularity: Granularity): string {
  if (granularity === 'month') {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    return d.toISOString();
  }
  if (granularity === 'week') {
    const d = new Date(date);
    const dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  // day
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ────────────────────────────────────────────────────────────────────────
// Series builder
// ────────────────────────────────────────────────────────────────────────

function emptySeverityCount(): Record<IncidentSeverity, number> {
  return { low: 0, medium: 0, high: 0, critical: 0 };
}

function movingAverage(values: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    out.push(slice.reduce((s, n) => s + n, 0) / slice.length);
  }
  return out;
}

/**
 * Linear regression slope (least squares) sobre los counts.
 * Slope positivo = rising; negativo = falling.
 */
function linearSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function slopeToDirection(slope: number, avgCount: number): TrendDirection {
  // Si slope / avg < 5%, consideramos stable.
  if (avgCount === 0) return 'stable';
  const ratio = slope / Math.max(1, avgCount);
  if (ratio > 0.05) return 'rising';
  if (ratio < -0.05) return 'falling';
  return 'stable';
}

function nextBucketStart(d: Date, granularity: Granularity): Date {
  if (granularity === 'month') {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  if (granularity === 'week') {
    const next = new Date(d);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function buildTrendSeries(
  incidents: IncidentRecord[],
  granularity: Granularity = 'month',
): TrendSeries {
  const buckets = new Map<string, { startIso: string; count: number; bySev: Record<IncidentSeverity, number> }>();

  for (const i of incidents) {
    const t = Date.parse(i.occurredAt);
    if (!Number.isFinite(t)) continue;
    const d = new Date(t);
    const key = bucketKeyFor(d, granularity);
    if (!buckets.has(key)) {
      buckets.set(key, { startIso: bucketStartIso(d, granularity), count: 0, bySev: emptySeverityCount() });
    }
    const b = buckets.get(key)!;
    b.count += 1;
    b.bySev[i.severity] += 1;
  }

  // Codex P2 PR #102: rellenar buckets vacíos entre el primer y último
  // ocurrido para que slope/moving-average no traten períodos no-adyacentes
  // como adyacentes.
  if (buckets.size > 0) {
    const startsByKey = new Map<string, Date>();
    for (const [k, v] of buckets) startsByKey.set(k, new Date(v.startIso));
    const sortedStartIsoKeys = [...buckets.keys()].sort(
      (a, b) => startsByKey.get(a)!.getTime() - startsByKey.get(b)!.getTime(),
    );
    const firstKey = sortedStartIsoKeys[0];
    const lastKey = sortedStartIsoKeys[sortedStartIsoKeys.length - 1];
    let cursor = new Date(buckets.get(firstKey)!.startIso);
    const endStart = new Date(buckets.get(lastKey)!.startIso);
    let safety = 0;
    while (cursor.getTime() <= endStart.getTime() && safety < 5000) {
      safety += 1;
      const key = bucketKeyFor(cursor, granularity);
      if (!buckets.has(key)) {
        buckets.set(key, {
          startIso: bucketStartIso(cursor, granularity),
          count: 0,
          bySev: emptySeverityCount(),
        });
      }
      cursor = nextBucketStart(cursor, granularity);
    }
  }

  // Sort by bucketStartIso parsed (no por string — más seguro con week 'YYYY-Www').
  const allKeys = [...buckets.keys()];
  const sortedKeys = allKeys.sort((a, b) => {
    const ta = Date.parse(buckets.get(a)!.startIso);
    const tb = Date.parse(buckets.get(b)!.startIso);
    return ta - tb;
  });
  const points: TrendPoint[] = sortedKeys.map((k) => {
    const b = buckets.get(k)!;
    return {
      bucket: k,
      bucketStartIso: b.startIso,
      count: b.count,
      bySeverity: b.bySev,
    };
  });

  const counts = points.map((p) => p.count);
  const avgCount = counts.length > 0 ? counts.reduce((s, n) => s + n, 0) / counts.length : 0;
  const movingAvg3 = movingAverage(counts, 3);
  const slope = linearSlope(counts);
  const direction = slopeToDirection(slope, avgCount);

  return { granularity, points, avgCount, movingAvg3, direction, slope };
}

// ────────────────────────────────────────────────────────────────────────
// Period-to-period comparison
// ────────────────────────────────────────────────────────────────────────

export interface PeriodComparison {
  currentTotal: number;
  previousTotal: number;
  /** Delta % positivo = aumentó. */
  deltaPercent: number;
  direction: TrendDirection;
}

export function comparePeriods(
  incidents: IncidentRecord[],
  options: { currentStart: Date; currentEnd: Date; previousStart: Date; previousEnd: Date },
): PeriodComparison {
  const inRange = (iso: string, a: Date, b: Date) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= a.getTime() && t < b.getTime();
  };
  const cur = incidents.filter((i) => inRange(i.occurredAt, options.currentStart, options.currentEnd)).length;
  const prev = incidents.filter((i) => inRange(i.occurredAt, options.previousStart, options.previousEnd)).length;
  let deltaPercent = 0;
  if (prev > 0) deltaPercent = Math.round(((cur - prev) / prev) * 100);
  else if (cur > 0) deltaPercent = 100;
  let direction: TrendDirection = 'stable';
  if (deltaPercent > 5) direction = 'rising';
  else if (deltaPercent < -5) direction = 'falling';
  return { currentTotal: cur, previousTotal: prev, deltaPercent, direction };
}

// ────────────────────────────────────────────────────────────────────────
// Outliers (3σ)
// ────────────────────────────────────────────────────────────────────────

export interface OutlierPoint {
  bucket: string;
  count: number;
  /** Standard deviations from mean. */
  zScore: number;
}

export function detectOutliers(series: TrendSeries, sigmaThreshold = 3): OutlierPoint[] {
  const counts = series.points.map((p) => p.count);
  if (counts.length < 3) return [];

  // Codex P2 PR #102: leave-one-out baseline. Para cada candidato p,
  // recalcular mean/stdev SIN incluir p. Sin esto, en series cortas el
  // máximo z-score posible es < 3 incluso ante spikes obvios.
  const total = counts.reduce((s, n) => s + n, 0);
  const totalSq = counts.reduce((s, n) => s + n * n, 0);
  const out: OutlierPoint[] = [];

  for (let i = 0; i < counts.length; i++) {
    const x = counts[i];
    const otherCount = counts.length - 1;
    if (otherCount < 2) continue;
    const otherMean = (total - x) / otherCount;
    const otherSqMean = (totalSq - x * x) / otherCount;
    const otherVar = otherSqMean - otherMean * otherMean;
    const otherStd = Math.sqrt(Math.max(0, otherVar));
    if (otherStd === 0) {
      // Todos los demás iguales — si el candidato difiere, ES el outlier.
      if (Math.abs(x - otherMean) > 0) {
        out.push({ bucket: series.points[i].bucket, count: x, zScore: Number.POSITIVE_INFINITY });
      }
      continue;
    }
    const z = (x - otherMean) / otherStd;
    if (Math.abs(z) >= sigmaThreshold) {
      out.push({
        bucket: series.points[i].bucket,
        count: x,
        zScore: Math.round(z * 100) / 100,
      });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Top categories
// ────────────────────────────────────────────────────────────────────────

export interface CategoryRank {
  category: string;
  count: number;
  percentOfTotal: number;
}

export function rankCategories(
  incidents: IncidentRecord[],
  topN = 5,
): CategoryRank[] {
  const counts = new Map<string, number>();
  for (const i of incidents) {
    counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  }
  const total = incidents.length;
  return [...counts.entries()]
    .map(([category, count]) => ({
      category,
      count,
      percentOfTotal: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}
