/**
 * Épica Rubros SII — slice 4: anonymous per-rubro benchmark engine.
 *
 * Given anonymized per-project metric rows for ALL projects sharing the same
 * SII sector (GP-* id derived from the verified `codigoActividadSii`), this
 * module computes the per-metric distribution a tenant is allowed to see:
 * median / p25 / p75 / contributor count — and NOTHING that identifies any
 * individual project or company.
 *
 * Pure calc module (CLAUDE.md rule #9): deterministic, side-effect free, no
 * Firestore, no clock, no randomness. The server route assembles the rows
 * (Admin SDK) and the engine only aggregates.
 *
 * ── k-anonymity design ────────────────────────────────────────────────────
 * Two thresholds gate publication, both must hold:
 *
 *   K_MIN_PROJECTS = 5  — mirrors the repo's existing anonymity precedent,
 *     the culture-pulse suppression threshold (PULSE_ANONYMITY_THRESHOLD = 5
 *     in src/server/routes/culturePulse.ts, Ley 19.628 rationale). With ≤4
 *     contributors, a viewer who knows their own value can narrow the other
 *     3 values enough to fingerprint small rubros.
 *
 *   K_MIN_TENANTS = 3 — tenancy IS identifiable here: the current data model
 *     is single-tenant-per-uid (`projects/{pid}.createdBy` ≈ tenant), so one
 *     company can own many projects of the same rubro. With only 2 tenants,
 *     everything in the distribution that is not "mine" belongs to EXACTLY
 *     ONE other identifiable company — median/p25/p75 over such a sample is
 *     a thin veil over that company's raw numbers. Requiring ≥3 distinct
 *     tenants means no viewer can attribute the residual mass to a single
 *     counterparty. (3, not 5, because the per-project k=5 already bounds
 *     reconstruction; tenant-k only needs to break 1:1 attribution.)
 *
 * The gates apply at TWO levels: the report as a whole (eligible flag) and
 * each metric independently (a metric reported by fewer than k projects /
 * fewer than 3 tenants is suppressed to null even when the report is
 * eligible).
 *
 * Robust statistics on purpose: median + interquartile band instead of
 * means. Percentiles are resistant to a single outlier project AND harder
 * to reverse (a mean over n=5 leaks the exact sum; order statistics do not).
 *
 * The output contains NO identifiers by construction — see the test
 * "never leaks projectKey / tenantKey values in the serialized report".
 */

export const K_MIN_PROJECTS = 5;
export const K_MIN_TENANTS = 3;

/**
 * The benchmark metrics. All three are CHEAPLY computable today from real,
 * existing data paths (no invented metrics):
 *  - incidentes12m        — incident count over the last 12 months
 *                           (top-level `incidents` + `tenants/{t}/projects/
 *                           {p}/incidents`, the dual path documented in
 *                           src/server/routes/incidentTrends.ts).
 *  - hallazgosAbiertosPct — % of findings still open
 *                           (`projects/{pid}/findings`, same subcollection
 *                           src/server/routes/projectHealth.ts reads).
 *  - obligacionesAlDiaPct — % of legal obligations not overdue
 *                           (`projects/{pid}/legal_obligations`, seeded by
 *                           slice 3 and consumed by LegalCalendar.tsx).
 */
export const RUBRO_METRIC_IDS = [
  'incidentes12m',
  'hallazgosAbiertosPct',
  'obligacionesAlDiaPct',
] as const;

export type RubroMetricId = (typeof RUBRO_METRIC_IDS)[number];

/**
 * One project's metric row. The keys are OPAQUE to the engine — they exist
 * only to count distinct contributors (k) and distinct tenants (tenant-k)
 * and are never copied into the report.
 */
export interface AnonymousProjectMetrics {
  /** Opaque per-project key (dedupe + k counting). Never emitted. */
  projectKey: string;
  /** Opaque per-tenant key (tenant-k counting). Never emitted. */
  tenantKey: string;
  /** Metric values; null/undefined = project has no data for that metric. */
  metrics: Partial<Record<RubroMetricId, number | null>>;
}

export interface MetricDistribution {
  /** Distinct projects that contributed a usable value for this metric. */
  count: number;
  median: number;
  p25: number;
  p75: number;
}

export interface RubroBenchmarkReport {
  /** True when BOTH k gates hold for the sector sample as a whole. */
  eligible: boolean;
  /** Distinct projects with at least one usable metric value. */
  k: number;
  /** Distinct tenants behind those projects. */
  kTenants: number;
  /** Echo of the gates, so callers/UI can render the honest message. */
  requiredProjects: number;
  requiredTenants: number;
  /** Distribution per metric, or null when that metric is suppressed. */
  perMetric: Record<RubroMetricId, MetricDistribution | null>;
}

/** A usable contribution: finite and non-negative (counts and percentages). */
function usable(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Percentile with linear interpolation between closest ranks ("type 7",
 * the R/NumPy default): index = (n-1)*q over the ascending sort.
 */
function percentile(sortedAsc: readonly number[], q: number): number {
  const n = sortedAsc.length;
  if (n === 1) return sortedAsc[0];
  const idx = (n - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, n - 1);
  const frac = idx - lo;
  return sortedAsc[lo] + frac * (sortedAsc[hi] - sortedAsc[lo]);
}

export function computeRubroBenchmarks(
  rows: readonly AnonymousProjectMetrics[],
): RubroBenchmarkReport {
  // Dedupe by projectKey — first occurrence wins (deterministic). A project
  // must never count twice toward k or contribute two values.
  const byProject = new Map<string, AnonymousProjectMetrics>();
  for (const r of rows) {
    if (!byProject.has(r.projectKey)) byProject.set(r.projectKey, r);
  }

  const contributors: AnonymousProjectMetrics[] = [];
  for (const row of byProject.values()) {
    if (RUBRO_METRIC_IDS.some((id) => usable(row.metrics[id]))) {
      contributors.push(row);
    }
  }

  const k = contributors.length;
  const kTenants = new Set(contributors.map((c) => c.tenantKey)).size;
  const eligible = k >= K_MIN_PROJECTS && kTenants >= K_MIN_TENANTS;

  const perMetric = {} as Record<RubroMetricId, MetricDistribution | null>;
  for (const id of RUBRO_METRIC_IDS) {
    perMetric[id] = null;
    if (!eligible) continue;

    const values: number[] = [];
    const tenants = new Set<string>();
    for (const row of contributors) {
      const v = row.metrics[id];
      if (usable(v)) {
        values.push(v);
        tenants.add(row.tenantKey);
      }
    }
    // Per-metric k gate: the report being eligible is not enough — THIS
    // metric's contributors must also satisfy both thresholds, otherwise a
    // sparse metric becomes a side channel on the few projects reporting it.
    if (values.length < K_MIN_PROJECTS || tenants.size < K_MIN_TENANTS) continue;

    values.sort((a, b) => a - b);
    perMetric[id] = {
      count: values.length,
      median: percentile(values, 0.5),
      p25: percentile(values, 0.25),
      p75: percentile(values, 0.75),
    };
  }

  return {
    eligible,
    k,
    kTenants,
    requiredProjects: K_MIN_PROJECTS,
    requiredTenants: K_MIN_TENANTS,
    perMetric,
  };
}
