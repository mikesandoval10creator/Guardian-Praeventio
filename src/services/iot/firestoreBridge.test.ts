// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket TT — coverage for the MQTT → Firestore bridge.
//
// Two cases:
//   1. Normal warning sample → telemetry_events row only.
//   2. Critical sample → triple write (telemetry_events + iot_alerts +
//      audit_logs) + FCM fan-out via the emergency module.
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

import { bridgeMqttToFirestore } from './firestoreBridge.js';
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

describe('bridgeMqttToFirestore', () => {
  beforeEach(() => {
    vi.mocked(sendToProjectSupervisors).mockClear();
  });

  it('writes a single telemetry_events row for a warning-level sample', async () => {
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
    const tel = writes.filter((w) => w.path.includes('/telemetry_events/'));
    const alerts = writes.filter((w) => w.path.includes('/iot_alerts/'));
    const audits = writes.filter((w) => w.path.startsWith('audit_logs/'));
    expect(tel).toHaveLength(1);
    expect(alerts).toHaveLength(0);
    expect(audits).toHaveLength(0);
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

    const tel = writes.filter((w) => w.path.includes('/telemetry_events/'));
    const alerts = writes.filter((w) => w.path.includes('/iot_alerts/'));
    const audits = writes.filter((w) => w.path.startsWith('audit_logs/'));
    expect(tel).toHaveLength(1);
    expect(alerts).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0].data.action).toBe('iot.critical_threshold');
    expect(sendToProjectSupervisors).toHaveBeenCalledTimes(1);
  });
});
