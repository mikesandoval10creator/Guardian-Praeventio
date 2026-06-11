// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket TT — coverage for the MQTT → Firestore bridge.
// 2026-06 (claude/mqtt-wire) — updated for the consolidated write: the
// telemetry row now lands in the TOP-LEVEL `telemetry_events` collection
// with the exact schema POST /api/telemetry/ingest produces, so the
// confined-space gas gate (workPermits) consumes both rails transparently.
//
// Cases:
//   1. Warning sample → one top-level telemetry_events row, ingest schema.
//   2. Critical sample → telemetry + iot_alerts + audit_logs + FCM fan-out.
//   3. Gas-gate metrics (O₂ / LEL) ALWAYS persist, even with no rule match.
//   4. Non-gas sample with no rule match is dropped (cost protection).
//   5. zoneId pass-through so the gas gate can join work_permits.zoneId.
//
// We mock `firebase-admin` so `admin.firestore.FieldValue.serverTimestamp()`
// resolves without a real Firestore project, and inject an in-memory `db`
// + `messaging` so we can assert on the recorded writes. The
// `sendToProjectSupervisors` symbol is mocked on the emergency module so
// the bridge can call it without booting an Express app.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      FieldValue: {
        serverTimestamp: () => '__server_ts__',
      },
    },
  },
}));

vi.mock('../../server/routes/emergency.js', () => ({
  sendToProjectSupervisors: vi.fn(async () => ({
    notified: 2,
    failed: 0,
    supervisorEmails: [],
  })),
}));

import { bridgeMqttToFirestore, kindToIngestType } from './firestoreBridge.js';
import { sendToProjectSupervisors } from '../../server/routes/emergency.js';
import type { TelemetrySample } from './types.js';

interface MemDoc {
  collection: (n: string) => MemCollection;
  set: (data: any) => Promise<void>;
}
interface MemCollection {
  add: (data: any) => Promise<{ id: string }>;
  doc: (id: string) => MemDoc;
}

function makeMemDb() {
  const writes: { path: string; data: any }[] = [];
  let counter = 0;
  function makeCol(parentPath: string): MemCollection {
    return {
      async add(data: any) {
        const id = `auto_${++counter}`;
        writes.push({ path: `${parentPath}/${id}`, data });
        return { id };
      },
      doc(id: string): MemDoc {
        return {
          collection: (n: string) => makeCol(`${parentPath}/${id}/${n}`),
          async set(data: any) {
            writes.push({ path: `${parentPath}/${id}`, data });
          },
        };
      },
    };
  }
  const db = {
    collection: (n: string) => makeCol(n),
  } as unknown as FirebaseFirestore.Firestore;
  return { db, writes };
}

const topLevelTelemetry = (writes: { path: string; data: any }[]) =>
  writes.filter((w) => w.path.startsWith('telemetry_events/'));

describe('kindToIngestType', () => {
  it('maps every device kind onto the HTTP ingest allowlist', () => {
    expect(kindToIngestType('gas-sensor')).toBe('environmental');
    expect(kindToIngestType('co2-monitor')).toBe('environmental');
    expect(kindToIngestType('environment')).toBe('environmental');
    expect(kindToIngestType('wearable')).toBe('wearable');
    expect(kindToIngestType('machinery')).toBe('machinery');
    expect(kindToIngestType(undefined)).toBe('iot');
  });
});

describe('bridgeMqttToFirestore', () => {
  beforeEach(() => {
    vi.mocked(sendToProjectSupervisors).mockClear();
  });

  it('writes a single TOP-LEVEL telemetry_events row (ingest schema) for a warning-level sample', async () => {
    const { db, writes } = makeMemDb();
    const sample: TelemetrySample = {
      deviceId: 'dev-100',
      timestamp: 1_700_000_000_000,
      metric: 'gas_co_ppm',
      value: 30, // > 25 (warning) but ≤ 50 (critical)
      unit: 'ppm',
      kind: 'gas-sensor',
    };
    const result = await bridgeMqttToFirestore(sample, {
      tenantId: 't1',
      projectId: 'p1',
      db,
      messaging: {} as any,
    });
    expect(result.telemetryId).toBeTruthy();
    expect(result.alertId).toBeNull();
    expect(result.notified).toBe(0);
    const tel = topLevelTelemetry(writes);
    expect(tel).toHaveLength(1);
    // Schema parity with POST /api/telemetry/ingest — the gas gate reads
    // (projectId, zoneId, timestamp, metric, value, unit, source).
    expect(tel[0].data).toMatchObject({
      type: 'environmental',
      source: 'dev-100',
      metric: 'gas_co_ppm',
      value: 30,
      unit: 'ppm',
      status: 'alert',
      threatLevel: 'Medium',
      aiValidation: null,
      projectId: 'p1',
      tenantId: 't1',
      zoneId: null,
      deviceTimestamp: 1_700_000_000_000,
      timestamp: '__server_ts__',
    });
    expect(writes.filter((w) => w.path.includes('/iot_alerts/'))).toHaveLength(0);
    expect(writes.filter((w) => w.path.startsWith('audit_logs/'))).toHaveLength(0);
    expect(sendToProjectSupervisors).not.toHaveBeenCalled();
  });

  it('writes telemetry + alert + audit and fans out FCM for a critical sample', async () => {
    const { db, writes } = makeMemDb();
    const sample: TelemetrySample = {
      deviceId: 'dev-101',
      timestamp: 1_700_000_000_000,
      metric: 'gas_co_ppm',
      value: 75, // > 50 → critical
      unit: 'ppm',
      kind: 'gas-sensor',
    };
    const result = await bridgeMqttToFirestore(sample, {
      tenantId: 't1',
      projectId: 'p1',
      db,
      messaging: {} as any,
    });
    expect(result.telemetryId).toBeTruthy();
    expect(result.alertId).toBeTruthy();
    expect(result.notified).toBe(2);

    const tel = topLevelTelemetry(writes);
    const alerts = writes.filter((w) => w.path.includes('/iot_alerts/'));
    const audits = writes.filter((w) => w.path.startsWith('audit_logs/'));
    expect(tel).toHaveLength(1);
    expect(tel[0].data.status).toBe('alert');
    expect(tel[0].data.threatLevel).toBe('High');
    expect(alerts).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0].data.action).toBe('iot.critical_threshold');
    expect(sendToProjectSupervisors).toHaveBeenCalledTimes(1);
  });

  it('ALWAYS persists gas-gate metrics (O₂) even when no rule matches', async () => {
    const { db, writes } = makeMemDb();
    // o2_pct has NO rule in DEFAULT_RULES — the old bridge dropped it,
    // leaving the confined-space gate blind to fresh normal readings.
    const sample: TelemetrySample = {
      deviceId: 'gas-7',
      timestamp: 1_700_000_000_000,
      metric: 'o2_pct',
      value: 20.9,
      unit: '%',
      kind: 'gas-sensor',
    };
    const result = await bridgeMqttToFirestore(sample, {
      tenantId: 't1',
      projectId: 'p1',
      zoneId: 'zona-estanque-3',
      db,
      messaging: {} as any,
    });
    expect(result.telemetryId).toBeTruthy();
    const tel = topLevelTelemetry(writes);
    expect(tel).toHaveLength(1);
    expect(tel[0].data).toMatchObject({
      metric: 'o2_pct',
      value: 20.9,
      status: 'normal',
      threatLevel: 'None',
      zoneId: 'zona-estanque-3',
    });
  });

  it('ALWAYS persists LEL readings (zone join intact)', async () => {
    const { db, writes } = makeMemDb();
    const sample: TelemetrySample = {
      deviceId: 'gas-7',
      timestamp: 1_700_000_000_000,
      metric: 'lel_pct',
      value: 12,
      unit: '%',
      kind: 'gas-sensor',
    };
    await bridgeMqttToFirestore(sample, {
      tenantId: 't1',
      projectId: 'p1',
      zoneId: 'zona-estanque-3',
      db,
      messaging: {} as any,
    });
    const tel = topLevelTelemetry(writes);
    expect(tel).toHaveLength(1);
    expect(tel[0].data.zoneId).toBe('zona-estanque-3');
    expect(tel[0].data.metric).toBe('lel_pct');
  });

  it('drops non-gas samples with no matching rule (cost protection, ADR 0015)', async () => {
    const { db, writes } = makeMemDb();
    const sample: TelemetrySample = {
      deviceId: 'wear-1',
      timestamp: 1_700_000_000_000,
      metric: 'heart_rate_bpm',
      value: 72, // within range — no rule trips
      unit: 'bpm',
      kind: 'wearable',
    };
    const result = await bridgeMqttToFirestore(sample, {
      tenantId: 't1',
      projectId: 'p1',
      db,
      messaging: {} as any,
    });
    expect(result.telemetryId).toBeNull();
    expect(topLevelTelemetry(writes)).toHaveLength(0);
  });
});
