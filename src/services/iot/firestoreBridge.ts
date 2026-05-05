// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket TT — MQTT → Firestore bridge.
//
// Pure-ish service: takes a TelemetrySample, runs `evaluateSample` against
// the in-process rule set, and persists the result to Firestore using the
// admin SDK. All writes are tenant-scoped under
// `tenants/{tenantId}/...`.
//
// Behavior contract:
//   1. Always writes a `telemetry_events` row (one per sample) when the
//      rule decision says `persist === true`. Sub-threshold samples are
//      dropped on the floor (cost protection — same policy as the engine).
//   2. If ANY alert in the decision is severity 'critical', additionally:
//        a. write a row to `tenants/{tenantId}/iot_alerts/{alertId}`
//        b. fan out FCM to project supervisors via `sendToProjectSupervisors`
//        c. emit an `audit_logs` row with action 'iot.critical_threshold'
//   3. Errors at every step are caught + reported via `getErrorTracker()`
//      so a transient Firestore hiccup never crashes the MQTT consumer.
//
// Tenant resolution: the bridge takes an explicit `tenantId` from the
// caller (the MQTT topic carries it — see `buildTopic` in mqttAdapter.ts).
// We never derive tenant from sample fields (those are device-controlled
// and could be spoofed).

import admin from 'firebase-admin';
import type { TelemetrySample, IngestRule, IngestDecision } from './types.js';
import { evaluateSample } from './ingestRuleEngine.js';
import { sendToProjectSupervisors } from '../../server/routes/emergency.js';
import { logger } from '../../utils/logger.js';
import { getErrorTracker } from '../observability/index.js';

export interface BridgeContext {
  tenantId: string;
  projectId: string;
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

  // Step 1 — telemetry_events row (only when rule says persist).
  if (decision.persist) {
    try {
      const telRef = await db
        .collection('tenants')
        .doc(ctx.tenantId)
        .collection('telemetry_events')
        .add({
          deviceId: sample.deviceId,
          projectId: ctx.projectId,
          type: sample.kind ?? null,
          metric: sample.metric,
          value: sample.value,
          unit: sample.unit,
          severity: isCritical
            ? 'critical'
            : decision.alerts[0]?.severity ?? 'info',
          ingestedAt: admin.firestore.FieldValue.serverTimestamp(),
          deviceTimestamp: sample.timestamp,
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
          { tags: { service: 'iot.firestoreBridge', step: 'telemetry' } } as any,
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
        { tags: { service: 'iot.firestoreBridge', step: 'alert' } } as any,
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
        { tags: { service: 'iot.firestoreBridge', step: 'fcm' } } as any,
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
        { tags: { service: 'iot.firestoreBridge', step: 'audit' } } as any,
      );
    } catch {
      /* swallow */
    }
  }

  return result;
}
