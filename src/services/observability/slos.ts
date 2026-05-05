// Praeventio Guard — Sprint 24 differentiators (Bucket MM.4).
//
// SLO definitions + burn-rate math for the `/admin/slo` Error Budget page.
//
// References:
//   • OBSERVABILITY.md — production SLO targets agreed with the platform team.
//   • Google SRE Workbook ch. 5 (alerting on SLOs) for the burn-rate
//     methodology: budget = (1 - target) * windowDays; burn = consumed/budget.
//
// Sources of truth at runtime (wired by SloErrorBudget.tsx):
//   • availability — derived from Sentry "events with status>=500" /
//     "events total" over windowDays.
//   • latency_p95   — Sentry performance percentile metric for /api/* spans.
//   • error_rate    — Sentry issue count / events total.
//
// We keep these definitions pure so they can be unit-tested without
// hitting Sentry. The dashboard component injects real metrics via
// `computeBurn`/`burnRateStatus`.

export type SloMetric = 'availability' | 'latency_p95' | 'error_rate';

export interface Slo {
  id: string;
  name: string;
  metric: SloMetric;
  /**
   * Target as a fraction in [0, 1].
   *   • availability: target uptime, e.g. 0.999 = 99.9%.
   *   • latency_p95:  target p95 latency in ms (NOT a fraction; stored as ms).
   *   • error_rate:   target max error rate as a fraction (e.g. 0.001 = 0.1%).
   */
  target: number;
  /** Rolling window the SLO is evaluated over, in days. */
  windowDays: number;
  /** Burn-rate fraction (0..1) at which the dashboard raises an alert badge. */
  thresholdAlert: number;
  /** Human-readable unit shown in the UI ("%", "ms", etc.). */
  unit: string;
}

export const SLOS: Slo[] = [
  {
    id: 'api-availability',
    name: 'API Availability',
    metric: 'availability',
    target: 0.999, // 99.9%
    windowDays: 30,
    thresholdAlert: 0.5,
    unit: '%',
  },
  {
    id: 'api-latency-p95',
    name: 'API Latency p95',
    metric: 'latency_p95',
    target: 500, // ms
    windowDays: 30,
    thresholdAlert: 0.5,
    unit: 'ms',
  },
  {
    id: 'gemini-error-rate',
    name: 'Gemini Error Rate',
    metric: 'error_rate',
    target: 0.01, // 1% error budget
    windowDays: 30,
    thresholdAlert: 0.5,
    unit: '%',
  },
  {
    id: 'frontend-availability',
    name: 'Frontend Availability',
    metric: 'availability',
    target: 0.995, // 99.5% (PWA tolerates more flakiness than API)
    windowDays: 30,
    thresholdAlert: 0.6,
    unit: '%',
  },
];

export interface BurnInput {
  /** Observed metric value over the SLO window. */
  observed: number;
  /** Total sample count (requests, events) — used for confidence. */
  totalSamples: number;
  /** Days elapsed within the SLO window so far (for ideal-burn comparison). */
  daysElapsed: number;
}

export interface BurnResult {
  /** Fraction of error budget consumed in [0, ∞). >1 means overspent. */
  consumed: number;
  /** Ideal consumption assuming linear burn — daysElapsed / windowDays. */
  ideal: number;
  /** consumed / ideal. >1 means burning faster than budget allows. */
  burnRate: number;
  /** True if burnRate exceeds slo.thresholdAlert + safety. */
  alerting: boolean;
}

/**
 * Compute burn statistics for a given SLO.
 *
 * For availability/error_rate, the budget is (1 - target). For latency_p95
 * we use a softer model: budget consumed = max(0, observed - target) /
 * target, so 600ms observed against a 500ms target = 20% over budget.
 */
export function computeBurn(slo: Slo, input: BurnInput): BurnResult {
  const { observed, daysElapsed } = input;
  const ideal = Math.max(0, Math.min(1, daysElapsed / slo.windowDays));

  let consumed = 0;
  if (slo.metric === 'availability') {
    // observed is uptime fraction (0..1). budget = (1 - target).
    const errorRate = Math.max(0, 1 - observed);
    const budget = Math.max(1e-9, 1 - slo.target);
    consumed = errorRate / budget;
  } else if (slo.metric === 'error_rate') {
    // observed is error rate fraction. budget = slo.target.
    const budget = Math.max(1e-9, slo.target);
    consumed = observed / budget;
  } else {
    // latency_p95: target stored as ms. consumed = (observed-target)/target.
    if (observed <= slo.target) {
      consumed = 0;
    } else {
      consumed = (observed - slo.target) / slo.target;
    }
  }

  const burnRate = ideal > 0 ? consumed / ideal : consumed;
  const alerting = burnRate > 1 + slo.thresholdAlert;

  return { consumed, ideal, burnRate, alerting };
}

/**
 * Discrete status bucket for UI badges.
 *   • healthy: burnRate <= 1
 *   • warn:    1 < burnRate <= 1 + thresholdAlert
 *   • alert:   burnRate > 1 + thresholdAlert
 */
export type BurnStatus = 'healthy' | 'warn' | 'alert';

export function burnRateStatus(slo: Slo, burnRate: number): BurnStatus {
  if (burnRate <= 1) return 'healthy';
  if (burnRate <= 1 + slo.thresholdAlert) return 'warn';
  return 'alert';
}

export function getSlo(id: string): Slo | undefined {
  return SLOS.find((s) => s.id === id);
}
