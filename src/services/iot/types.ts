// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket TT — IoT canonical types.
//
// Shared by: mqttAdapter (transport), ingestRuleEngine (filtering),
// routes/iot.ts (HTTP), jobs/checkLostHeartbeats (reaper),
// components/iot/* (UI), pages/IoTEdgeFiltering.tsx.
//
// Decisions captured here:
//   • `kind` is a closed union — adding a new device class requires a
//     code change AND a corresponding rule in `ingestRuleEngine.ts`.
//   • Persistence stamps are numeric epoch ms (NOT Firestore Timestamp)
//     so the same shape flies over MQTT, WSS, REST and unit tests.
//   • `certificateFingerprint` is the SHA-256 digest of the device cert
//     in lowercase hex. We never store the cert PEM itself in Firestore
//     (see ADR 0015 — operator-copy-now-or-rotate model).

/**
 * Device classes recognised by the ingest pipeline. Each kind has its
 * own MVP threshold rules in `ingestRuleEngine.ts::DEFAULT_RULES`.
 */
export type IotDeviceKind =
  | 'wearable'
  | 'gas-sensor'
  | 'co2-monitor'
  | 'machinery'
  | 'environment';

/**
 * Connection status. Transitions:
 *   active → lost-heartbeat   (reaper, after 15 min silence)
 *   active → inactive          (admin manual revoke)
 *   lost-heartbeat → active    (next valid heartbeat)
 *   any → inactive             (admin revoke cert)
 */
export type IotDeviceStatus = 'active' | 'inactive' | 'lost-heartbeat';

export interface IotDevice {
  id: string;
  tenantId: string;
  projectId: string;
  kind: IotDeviceKind;
  /** SHA-256 of the X.509 client cert, lowercase hex. */
  certificateFingerprint: string;
  status: IotDeviceStatus;
  /** Epoch ms of the last heartbeat / telemetry sample. */
  lastSeenAt: number;
  /** Optional human-readable name shown in the dashboard. */
  name?: string;
}

/**
 * Single telemetry sample as seen on the wire. Producers (devices /
 * gateways) MUST emit `timestamp` in epoch ms. The server rejects
 * samples whose timestamp is more than 5 min in the future.
 */
export interface TelemetrySample {
  deviceId: string;
  timestamp: number;
  /** e.g. 'gas_co_ppm', 'heart_rate_bpm', 'temperature_c'. */
  metric: string;
  value: number;
  /** SI unit string. Free-form for now; tighten to enum in Sprint 33. */
  unit: string;
  /** Optional override for rule engine (defaults to device.kind). */
  kind?: IotDeviceKind;
}

/**
 * Threshold rule consumed by `evaluateSample`. Either `gt` or `lt`
 * (or both) MUST be present — a rule with neither is a config error
 * and is rejected at startup.
 */
export interface IngestRule {
  /** Metric name this rule applies to (matches `TelemetrySample.metric`). */
  metric: string;
  /** Optional restriction by device kind (rule applies to all kinds if absent). */
  kind?: IotDeviceKind;
  threshold: { gt?: number; lt?: number };
  severity: 'info' | 'warning' | 'critical';
  /**
   * If true, samples that trip this rule are written to Firestore. If
   * false, the rule still emits an alert (push + audit) but the raw
   * sample is dropped — useful for very-high-frequency metrics.
   */
  persistToFirestore: boolean;
  /** Human label included in alerts (e.g. "CO above 50ppm"). */
  label: string;
}

/**
 * Output of the rule engine for a single sample.
 */
export interface IngestDecision {
  persist: boolean;
  alerts: Array<{
    severity: 'info' | 'warning' | 'critical';
    message: string;
    metric: string;
    value: number;
  }>;
}
