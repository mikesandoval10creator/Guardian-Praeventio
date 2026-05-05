// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket TT — Ingest rule engine.
//
// Pure function: given a TelemetrySample and a rule list, decide whether
// to persist the sample to Firestore and what alerts (if any) to dispatch.
//
// MVP rules per device kind are baked in as `DEFAULT_RULES`. Tenants can
// extend them via Firestore (`iot_ingest_rules/{tenantId}`) — that
// loader lands in Sprint 33; for now `DEFAULT_RULES` is the single
// source of truth.
//
// Design choices:
//   • A sample with no matching rule does NOT persist (cost protection).
//   • If multiple rules trip, the most severe wins for `persist` but
//     ALL alerts are emitted (so the dashboard shows the full picture).
//   • `info` severity is emitted as alert but does NOT force persist
//     unless `persistToFirestore: true` on the rule itself.

import type {
  IngestDecision,
  IngestRule,
  IotDeviceKind,
  TelemetrySample,
} from './types.js';

export const DEFAULT_RULES: IngestRule[] = [
  // ---- gas-sensor ----
  {
    metric: 'gas_co_ppm',
    kind: 'gas-sensor',
    threshold: { gt: 50 },
    severity: 'critical',
    persistToFirestore: true,
    label: 'CO above 50 ppm (IDLH-adjacent)',
  },
  {
    metric: 'gas_co_ppm',
    kind: 'gas-sensor',
    threshold: { gt: 25 },
    severity: 'warning',
    persistToFirestore: true,
    label: 'CO above 25 ppm (action level)',
  },
  // ---- wearable ----
  {
    metric: 'heart_rate_bpm',
    kind: 'wearable',
    threshold: { gt: 180 },
    severity: 'warning',
    persistToFirestore: true,
    label: 'Heart rate above 180 bpm',
  },
  {
    metric: 'heart_rate_bpm',
    kind: 'wearable',
    threshold: { lt: 40 },
    severity: 'critical',
    persistToFirestore: true,
    label: 'Heart rate below 40 bpm (bradycardia)',
  },
  // ---- co2-monitor ----
  {
    metric: 'co2_ppm',
    kind: 'co2-monitor',
    threshold: { gt: 5000 },
    severity: 'critical',
    persistToFirestore: true,
    label: 'CO2 above 5000 ppm (8h OSHA PEL)',
  },
  {
    metric: 'co2_ppm',
    kind: 'co2-monitor',
    threshold: { gt: 1000 },
    severity: 'warning',
    persistToFirestore: true,
    label: 'CO2 above 1000 ppm (IAQ degraded)',
  },
  // ---- environment ----
  {
    metric: 'temperature_c',
    kind: 'environment',
    threshold: { gt: 50 },
    severity: 'warning',
    persistToFirestore: true,
    label: 'Ambient temperature above 50°C',
  },
  {
    metric: 'temperature_c',
    kind: 'environment',
    threshold: { lt: -10 },
    severity: 'warning',
    persistToFirestore: true,
    label: 'Ambient temperature below -10°C',
  },
  // ---- machinery ----
  {
    metric: 'vibration_g',
    kind: 'machinery',
    threshold: { gt: 5 },
    severity: 'warning',
    persistToFirestore: true,
    label: 'Vibration above 5 g (bearing wear)',
  },
];

const SEVERITY_RANK: Record<IngestRule['severity'], number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

function tripsRule(sample: TelemetrySample, rule: IngestRule): boolean {
  if (rule.metric !== sample.metric) return false;
  if (rule.kind !== undefined && sample.kind !== undefined && rule.kind !== sample.kind) {
    return false;
  }
  const { gt, lt } = rule.threshold;
  if (gt !== undefined && sample.value > gt) return true;
  if (lt !== undefined && sample.value < lt) return true;
  return false;
}

/**
 * Pure decision function. Caller is responsible for actually writing
 * to Firestore / dispatching push.
 */
export function evaluateSample(
  sample: TelemetrySample,
  rules: IngestRule[] = DEFAULT_RULES,
): IngestDecision {
  const decision: IngestDecision = { persist: false, alerts: [] };
  for (const rule of rules) {
    if (!tripsRule(sample, rule)) continue;
    if (rule.persistToFirestore) decision.persist = true;
    decision.alerts.push({
      severity: rule.severity,
      message: rule.label,
      metric: sample.metric,
      value: sample.value,
    });
  }
  // Sort alerts by severity descending so the supervisor sees the worst
  // first. Stable sort preserves rule order on ties.
  decision.alerts.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
  return decision;
}

/**
 * Defensive boot-time validator — guarantees every rule has at least
 * one threshold side. Throwing here surfaces config errors at server
 * boot rather than at runtime.
 */
export function validateRules(rules: IngestRule[]): void {
  for (const r of rules) {
    if (r.threshold.gt === undefined && r.threshold.lt === undefined) {
      throw new Error(
        `IoT ingest rule for "${r.metric}" has no gt/lt threshold — config error`,
      );
    }
  }
}

export type { IotDeviceKind };
