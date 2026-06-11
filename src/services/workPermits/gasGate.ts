// Praeventio Guard — gas-telemetry gate for work permits (arista C3, 2026-06-11).
//
// Problem (telemetría→bloqueo operacional): the HMAC ingest persists gas
// sensor readings into `telemetry_events`, but a reading over threshold in a
// zone had no operational consequence — a confined-space permit for that very
// zone could still be signed. "El sensor hoy informa; conectado, detiene."
//
// This module is the PURE half of the wire (CLAUDE.md #9: no side effects, no
// Firestore, deterministic). It receives the recent telemetry readings of the
// permit's zone — the route layer queries Firestore under a hard deadline,
// weatherGate precedent — and computes a SOFT-block verdict:
//
//   { blocked, reasons[], worstReadings, freshReadingCount, note? }
//
// Soft-block semantics (project directive, horometerEngine precedent): the
// app NEVER physically stops work. `blocked: true` means the permit cannot be
// SIGNED/issued while the block stands, unless a supervisor-tier role records
// an explicit, audited override. The route layer enforces that.
//
// Threshold reuse: O₂ 19.5–23.5 % and LEL 10 %/5 % come from
// `criticalPermitValidators.ts` (DS 594 + protocolo MINSAL) — the SAME table
// already applied to declared pre-entry measurements. CO / H₂S metrics are
// recognised as gas but intentionally NOT gated yet: their legal limits need
// normative verification before becoming a blocking table (do not invent
// safety constants). `classifyGasMetric` returns null for them today.
//
// Fail-open on missing data (mirrors weatherGate's unavailability note):
// stale or absent telemetry must NEVER block work by itself — supervisors get
// an es-CL note that the automatic verification did not run, and the manual
// pre-entry measurement (checklist item 'Medición de gases pre-ingreso')
// remains mandatory.

import {
  GAS_OXYGEN_MIN_PCT,
  GAS_OXYGEN_MAX_PCT,
  GAS_LEL_BLOCKING_PCT,
  GAS_LEL_ADVISORY_PCT,
  type CriticalIssue,
} from './criticalPermitValidators.js';

// ────────────────────────────────────────────────────────────────────────
// Types + constants
// ────────────────────────────────────────────────────────────────────────

/** One normalized telemetry reading (route layer maps Firestore docs here). */
export interface GasTelemetryReading {
  /** Raw metric name as ingested (e.g. 'lel_pct', 'o2_pct', 'gas_co_ppm'). */
  metric: string;
  value: number;
  unit?: string;
  /** Epoch ms of the reading (server ingest timestamp). */
  timestampMs: number;
  /** Device / source id, kept for the audit snapshot. */
  source?: string;
}

export type GasMetricKind = 'oxygen_pct' | 'lel_pct';

export interface GasGateResult {
  /** True when at least one fresh reading violates a blocking threshold. */
  blocked: boolean;
  /** Severity-tagged issues, same shape the critical validators emit. */
  reasons: CriticalIssue[];
  /** Worst fresh reading per category — snapshot for audits / UI / 409 body. */
  worstReadings: {
    oxygenLow?: GasTelemetryReading;
    oxygenHigh?: GasTelemetryReading;
    lel?: GasTelemetryReading;
  };
  /** How many fresh, recognised gas readings were considered. */
  freshReadingCount: number;
  /** es-CL note when no fresh telemetry exists — absence of data ≠ block. */
  note?: string;
}

/** Readings older than this are stale and ignored (15 min). */
export const GAS_TELEMETRY_WINDOW_MS = 15 * 60_000;

/**
 * Readings stamped further in the future than this are discarded: the ingest
 * stamps server time, so a large future skew means a corrupt/mapped-wrong
 * timestamp, not a fresher reading.
 */
export const GAS_TELEMETRY_FUTURE_SKEW_MS = 5 * 60_000;

/** User-facing es-CL copy — surfaced when no fresh zone telemetry exists. */
export const GAS_NO_TELEMETRY_NOTE_ES =
  'Sin telemetría reciente en la zona — no fue posible verificar los gases de forma automática. La medición manual pre-ingreso sigue siendo obligatoria.';

// ────────────────────────────────────────────────────────────────────────
// Metric classification
// ────────────────────────────────────────────────────────────────────────

/**
 * Map a free-form ingested metric name onto a gated gas category. Returns
 * null for metrics without a verified blocking table (CO, H₂S, temperature,
 * heart rate, …) — those never influence the gate.
 */
export function classifyGasMetric(metric: string): GasMetricKind | null {
  const m = metric.toLowerCase();
  // LEL first: 'lel', 'lel_pct', 'gas_lel_pct'.
  if (/(^|_)lel(_|$)/.test(m)) return 'lel_pct';
  // Oxygen: 'o2', 'o2_pct', 'gas_o2_pct', 'oxygen_pct'.
  if (/(^|_)o2(_|$)/.test(m) || m.includes('oxygen')) return 'oxygen_pct';
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Gate
// ────────────────────────────────────────────────────────────────────────

function isFresh(r: GasTelemetryReading, nowMs: number, windowMs: number): boolean {
  return (
    Number.isFinite(r.value) &&
    Number.isFinite(r.timestampMs) &&
    r.timestampMs >= nowMs - windowMs &&
    r.timestampMs <= nowMs + GAS_TELEMETRY_FUTURE_SKEW_MS
  );
}

/**
 * Evaluate the recent gas telemetry of a zone against the confined-space
 * thresholds. Pure + deterministic; worst reading wins per category.
 */
export function evaluateGasTelemetry(
  readings: GasTelemetryReading[],
  nowMs: number,
  windowMs: number = GAS_TELEMETRY_WINDOW_MS,
): GasGateResult {
  const fresh = readings.filter(
    (r) => classifyGasMetric(r.metric) !== null && isFresh(r, nowMs, windowMs),
  );

  if (fresh.length === 0) {
    return {
      blocked: false,
      reasons: [],
      worstReadings: {},
      freshReadingCount: 0,
      note: GAS_NO_TELEMETRY_NOTE_ES,
    };
  }

  const oxygen = fresh.filter((r) => classifyGasMetric(r.metric) === 'oxygen_pct');
  const lel = fresh.filter((r) => classifyGasMetric(r.metric) === 'lel_pct');

  const worstReadings: GasGateResult['worstReadings'] = {};
  const reasons: CriticalIssue[] = [];

  if (oxygen.length > 0) {
    const low = oxygen.reduce((a, b) => (b.value < a.value ? b : a));
    const high = oxygen.reduce((a, b) => (b.value > a.value ? b : a));
    worstReadings.oxygenLow = low;
    worstReadings.oxygenHigh = high;
    if (low.value < GAS_OXYGEN_MIN_PCT) {
      reasons.push({
        severity: 'blocking',
        code: 'GAS_OXYGEN_LOW',
        message: `O₂ ${low.value}% bajo el mínimo seguro ${GAS_OXYGEN_MIN_PCT}% según telemetría de la zona. Riesgo de asfixia.`,
        context: { oxygenPct: low.value, ...(low.source ? { source: low.source } : {}) },
      });
    }
    if (high.value > GAS_OXYGEN_MAX_PCT) {
      reasons.push({
        severity: 'blocking',
        code: 'GAS_OXYGEN_HIGH',
        message: `O₂ ${high.value}% sobre el máximo seguro ${GAS_OXYGEN_MAX_PCT}% según telemetría de la zona. Atmósfera sobreoxigenada (riesgo de combustión acelerada).`,
        context: { oxygenPct: high.value, ...(high.source ? { source: high.source } : {}) },
      });
    }
  }

  if (lel.length > 0) {
    const worst = lel.reduce((a, b) => (b.value > a.value ? b : a));
    worstReadings.lel = worst;
    if (worst.value >= GAS_LEL_BLOCKING_PCT) {
      reasons.push({
        severity: 'blocking',
        code: 'GAS_LEL_HIGH',
        message: `LEL ${worst.value}% ≥ ${GAS_LEL_BLOCKING_PCT}% según telemetría de la zona. Atmósfera potencialmente explosiva.`,
        context: { lelPct: worst.value, ...(worst.source ? { source: worst.source } : {}) },
      });
    } else if (worst.value >= GAS_LEL_ADVISORY_PCT) {
      reasons.push({
        severity: 'advisory',
        code: 'GAS_LEL_ELEVATED',
        message: `LEL ${worst.value}% entre ${GAS_LEL_ADVISORY_PCT}%–${GAS_LEL_BLOCKING_PCT}% según telemetría de la zona. Re-medir antes de ingresar.`,
        context: { lelPct: worst.value, ...(worst.source ? { source: worst.source } : {}) },
      });
    }
  }

  return {
    blocked: reasons.some((i) => i.severity === 'blocking'),
    reasons,
    worstReadings,
    freshReadingCount: fresh.length,
  };
}
