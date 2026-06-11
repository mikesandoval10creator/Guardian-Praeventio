// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket TT — MQTT → Firestore bridge.
// 2026-06 (claude/mqtt-wire) — telemetry write CONSOLIDATED into the
// top-level `telemetry_events` collection, ingest-schema compatible.
//
// Pure-ish service: takes a TelemetrySample, runs `evaluateSample` against
// the in-process rule set, and persists the result to Firestore using the
// admin SDK.
//
// Behavior contract:
//   1. Writes ONE top-level `telemetry_events` row per sample when EITHER
//      the rule decision says `persist === true` OR the metric is a
//      gas-gate metric (O₂ / LEL — `classifyGasMetric`). The row uses the
//      SAME schema POST /api/telemetry/ingest writes, so every existing
//      consumer (confined-space gas gate in workPermits.ts, Telemetry.tsx,
//      Evacuation.tsx, safetyEngineBackend) sees MQTT samples
//      transparently. Gas metrics bypass the cost filter because the gate
//      needs FRESH normal readings too — a dropped "O₂ 20.9%" would leave
//      the gate blind ("Sin telemetría reciente") while the sensor is
//      reporting fine. Other sub-threshold samples are still dropped
//      (cost protection — same policy as the engine, ADR 0015).
//      SUPERSEDED: the previous `tenants/{tid}/telemetry_events`
//      subcollection write — nothing ever read it (audit 2026-06); the
//      gate and every dashboard query the top-level collection.
//   2. If ANY alert in the decision is severity 'critical', additionally:
//        a. write a row to `tenants/{tenantId}/iot_alerts/{alertId}`
//        b. fan out FCM to project supervisors via `sendToProjectSupervisors`
//        c. emit an `audit_logs` row with action 'iot.critical_threshold'
//   3. Errors at every step are caught + reported via `getErrorTracker()`
//      so a transient Firestore hiccup never crashes the MQTT consumer.
//
// AI validation note: the HTTP ingest calls `autoValidateTelemetry`
// (Gemini) per event. The MQTT path deliberately does NOT — industrial
// sensors publish at high frequency and a model call per sample is
// neither deterministic nor affordable. The local rule engine fills the
// `status`/`threatLevel` fields instead and `aiValidation` is null.
//
// Tenant resolution: the bridge takes an explicit `tenantId` from the
// caller (the MQTT topic carries it — see `buildTopic` in mqttAdapter.ts).
// We never derive tenant from sample fields (those are device-controlled
// and could be spoofed).

import admin from 'firebase-admin';
import type { TelemetrySample, IngestRule, IngestDecision, IotDeviceKind } from './types.js';
import { evaluateSample } from './ingestRuleEngine.js';
import { classifyGasMetric } from '../workPermits/gasGate.js';
import { sendToProjectSupervisors } from '../../server/routes/emergency.js';
import { logger } from '../../utils/logger.js';
import { getErrorTracker } from '../observability/index.js';

export interface BridgeContext {
  tenantId: string;
  projectId: string;
  /**
   * Optional zone tag so gas readings join `work_permits.zoneId` in the
   * confined-space gate (same contract as the HTTP ingest's `zoneId`).
   */
  zoneId?: string | null;
  /** Optional rule override (tests inject smaller rule sets). */
  rules?: IngestRule[];
  /**
   * Optional Firestore handle; defaults to `admin.firestore()` for
   * production. Tests inject their in-memory shim.
   */
  db?: FirebaseFirestore.Firestore;
  /** Optional FCM messaging handle (defaults to `admin.messaging()`). */
  messaging?: admin.messaging.Messaging;
}

/**
 * Map a device kind onto the HTTP ingest's `type` allowlist
 * (`IOT_TYPE_ALLOWLIST` in src/server/routes/telemetry.ts) so rows from
 * both rails are indistinguishable to consumers.
 */
export function kindToIngestType(kind: IotDeviceKind | undefined): string {
  switch (kind) {
    case 'wearable':
      return 'wearable';
    case 'machinery':
      return 'machinery';
    case 'gas-sensor':
    case 'co2-monitor':
    case 'environment':
      return 'environmental';
    default:
      return 'iot';
  }
}

export interface BridgeResult {
  decision: IngestDecision;
  telemetryId: string | null;
  alertId: string | null;
  notified: number;
  failed: number;
}

/**
 * Persist one telemetry sample to Firestore. Idempotent at the
 * collection-shape level (each call writes at most one telemetry row +
 * one alert row + one audit row). Caller is responsible for
 * deduplication if the underlying transport delivers duplicates.
 */
export async function bridgeMqttToFirestore(
  sample: TelemetrySample,
  ctx: BridgeContext,
): Promise<BridgeResult> {
  const decision = evaluateSample(sample, ctx.rules);
  const result: BridgeResult = {
    decision,
    telemetryId: null,
    alertId: null,
    notified: 0,
    failed: 0,
  };

  const db = ctx.db ?? admin.firestore();
  const isCritical = decision.alerts.some((a) => a.severity === 'critical');
  const hasWarning = decision.alerts.some((a) => a.severity === 'warning');

  // Step 1 — top-level telemetry_events row, ingest-schema compatible.
  // Gas-gate metrics (O₂/LEL) ALWAYS persist — the confined-space gate
  // needs fresh normal readings, not just anomalies (see header).
  const mustPersist = decision.persist || classifyGasMetric(sample.metric) !== null;
  if (mustPersist) {
    try {
      const telRef = await db.collection('telemetry_events').add({
        type: kindToIngestType(sample.kind),
        source: sample.deviceId,
        metric: sample.metric,
        value: sample.value,
        unit: sample.unit,
        status: isCritical || hasWarning ? 'alert' : 'normal',
        threatLevel: isCritical ? 'High' : hasWarning ? 'Medium' : 'None',
        // MQTT rail uses the deterministic rule engine, not Gemini (header).
        aiValidation: null,
        projectId: ctx.projectId,
        tenantId: ctx.tenantId,
        zoneId: ctx.zoneId ?? null,
        deviceTimestamp: sample.timestamp,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      result.telemetryId = telRef.id;
    } catch (err: any) {
      logger.error('iot_bridge_telemetry_write_failed', err, {
        tenantId: ctx.tenantId,
        deviceId: sample.deviceId,
      });
      try {
        getErrorTracker().captureException(
          err instanceof Error ? err : new Error(String(err)),
          { tags: { service: 'iot.firestoreBridge', step: 'telemetry' } },
        );
      } catch {
        /* observability never breaks the bridge */
      }
    }
  }

  if (!isCritical) return result;

  // Step 2a — iot_alerts row.
  try {
    const alertRef = await db
      .collection('tenants')
      .doc(ctx.tenantId)
      .collection('iot_alerts')
      .add({
        deviceId: sample.deviceId,
        projectId: ctx.projectId,
        metric: sample.metric,
        value: sample.value,
        unit: sample.unit,
        severity: 'critical',
        alerts: decision.alerts,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        deviceTimestamp: sample.timestamp,
      });
    result.alertId = alertRef.id;
  } catch (err: any) {
    logger.error('iot_bridge_alert_write_failed', err, {
      tenantId: ctx.tenantId,
      deviceId: sample.deviceId,
    });
    try {
      getErrorTracker().captureException(
        err instanceof Error ? err : new Error(String(err)),
        { tags: { service: 'iot.firestoreBridge', step: 'alert' } },
      );
    } catch {
      /* swallow */
    }
  }

  // Step 2b — FCM fan-out to project supervisors.
  try {
    const messaging = ctx.messaging ?? admin.messaging();
    const fan = await sendToProjectSupervisors(
      ctx.projectId,
      {
        title: 'Alerta IoT crítica',
        body: `${sample.metric}=${sample.value}${sample.unit} en ${sample.deviceId}`,
        data: {
          deviceId: sample.deviceId,
          projectId: ctx.projectId,
          metric: sample.metric,
          alertId: result.alertId ?? '',
          source: 'iot.mqtt',
        },
      },
      db,
      messaging,
    );
    result.notified = fan.notified;
    result.failed = fan.failed;
  } catch (err: any) {
    logger.error('iot_bridge_fcm_fanout_failed', err, {
      tenantId: ctx.tenantId,
      projectId: ctx.projectId,
    });
    try {
      getErrorTracker().captureException(
        err instanceof Error ? err : new Error(String(err)),
        { tags: { service: 'iot.firestoreBridge', step: 'fcm' } },
      );
    } catch {
      /* swallow */
    }
  }

  // Step 2c — audit row.
  try {
    await db.collection('audit_logs').add({
      action: 'iot.critical_threshold',
      module: 'iot',
      details: {
        tenantId: ctx.tenantId,
        projectId: ctx.projectId,
        deviceId: sample.deviceId,
        metric: sample.metric,
        value: sample.value,
        alerts: decision.alerts,
        alertId: result.alertId,
        telemetryId: result.telemetryId,
      },
      userId: 'system:iot.bridge',
      projectId: ctx.projectId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err: any) {
    logger.error('iot_bridge_audit_write_failed', err, {
      tenantId: ctx.tenantId,
      deviceId: sample.deviceId,
    });
    try {
      getErrorTracker().captureException(
        err instanceof Error ? err : new Error(String(err)),
        { tags: { service: 'iot.firestoreBridge', step: 'audit' } },
      );
    } catch {
      /* swallow */
    }
  }

  return result;
}
