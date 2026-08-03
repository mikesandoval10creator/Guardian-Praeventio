// Praeventio Guard — P0 outbox transaccional para notificaciones críticas.
//
// Contrato (deuda 39aaa66d-73fe-815c-94ba-ce873bc5ed94):
//   1. Create-once: dos writers concurrentes sobre el mismo nodo crean UN solo
//      outbox; el payload queda congelado (projectId, título, severity, tokens,
//      emails) para que reintentos no dependan del estado mutable del nodo.
//   2. Claim: pending → processing con lease transaccional; un segundo worker
//      con lease vivo no reenvía; tras expirar el lease puede reclaim.
//   3. Entrega: el worker envía FCM+email; con ≥1 canal entregado → sent
//      (única vez). Con 0 canales → failed, attempts++ y backoff exponencial.
//   4. Dead-letter: tras MAX_ATTEMPTS fallidos → dead_lettered con lastError y
//      auditoría; nunca se marca 'enviado' algo no entregado.
//   5. Espejo del nodo: `_criticalAlertSentAt` SOLO al llegar a sent.

import { describe, expect, it } from 'vitest';
import {
  createCriticalAlertOutbox,
  claimOutboxForDelivery,
  markOutboxSent,
  markOutboxFailed,
  CRITICAL_OUTBOX_MAX_ATTEMPTS,
  type CriticalAlertOutbox,
  type FrozenAlertPayload,
} from './criticalAlertOutbox';

function fakeStore(initial: Record<string, unknown> = {}) {
  let data: Record<string, unknown> = { ...initial };
  const ref = { id: 'outbox-1' };
  const db = {
    runTransaction: async <T>(fn: (tx: {
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
      create: (_ref: unknown, value: Record<string, unknown>) => void;
      update: (_ref: unknown, patch: Record<string, unknown>) => void;
    }) => Promise<T>) =>
      fn({
        get: async () => ({ exists: Object.keys(data).length > 0, data: () => ({ ...data }) }),
        create: (_ref, value) => {
          if (Object.keys(data).length > 0) throw new Error('doc already exists');
          data = { ...value };
        },
        update: (_ref, patch) => {
          data = { ...data, ...patch };
        },
      }),
  };
  return { db, ref, read: (): Record<string, unknown> => ({ ...data }) };
}

const frozenPayload: FrozenAlertPayload = {
  projectId: 'proj-A',
  nodeId: 'node-1',
  title: 'Trabajador caído',
  description: 'Sin respuesta en zona norte',
  severity: 'Crítica',
  location: 'Zona Norte',
  supervisorUids: ['sup-1', 'sup-2'],
  fcmTokens: ['tok-1', 'tok-2'],
  emailRecipients: ['sup-1@test.cl'],
  capturedAtMs: 1_000,
};

const OUTBOX_FIELDS = {
  completedAt: '_sentAt',
  leaseUntilMs: '_leaseUntilMs',
  claimToken: '_claimToken',
  attempts: '_attempts',
};

describe('critical alert outbox', () => {
  it('create-once: concurrent writers produce exactly one outbox', async () => {
    const store = fakeStore();
    const first = await createCriticalAlertOutbox({
      ...store,
      ref: store.ref,
      payload: frozenPayload,
      nowMs: 1_000,
    });
    expect(first).toBe(true);

    // Second writer observing the same node must NOT overwrite.
    const second = await createCriticalAlertOutbox({
      ...store,
      ref: store.ref,
      payload: { ...frozenPayload, title: 'título manipulado' },
      nowMs: 1_100,
    });
    expect(second).toBe(false);
    const doc = store.read() as Record<string, unknown> & { payload: { title: string; fcmTokens: string[] } };
    expect(doc.status).toBe('pending');
    expect(doc.payload.title).toBe('Trabajador caído');
    expect(doc.payload.fcmTokens).toEqual(['tok-1', 'tok-2']);
    expect(doc.attempts).toBe(0);
  });

  it('claim transitions pending→processing with a lease and increments attempts', async () => {
    const store = fakeStore({
      status: 'pending',
      attempts: 0,
      payload: frozenPayload,
    });
    const result = await claimOutboxForDelivery({
      ...store,
      ref: store.ref,
      fields: OUTBOX_FIELDS,
      nowMs: 2_000,
      leaseMs: 5_000,
      token: 'worker-a',
    });
    expect(result).toEqual({ kind: 'claimed', token: 'worker-a' });
    expect(store.read()).toMatchObject({
      status: 'processing',
      _leaseUntilMs: 7_000,
      _claimToken: 'worker-a',
      _attempts: 1,
    });
  });

  it('a live lease blocks a second worker; expiry allows reclaim', async () => {
    const store = fakeStore({
      status: 'processing',
      _leaseUntilMs: 3_000,
      _claimToken: 'worker-a',
      _attempts: 1,
      payload: frozenPayload,
    });
    await expect(
      claimOutboxForDelivery({
        ...store,
        ref: store.ref,
        fields: OUTBOX_FIELDS,
        nowMs: 2_500,
        leaseMs: 5_000,
        token: 'worker-b',
      }),
    ).resolves.toEqual({ kind: 'leased', retryAfterMs: 500 });

    await expect(
      claimOutboxForDelivery({
        ...store,
        ref: store.ref,
        fields: OUTBOX_FIELDS,
        nowMs: 3_001,
        leaseMs: 5_000,
        token: 'worker-b',
      }),
    ).resolves.toEqual({ kind: 'claimed', token: 'worker-b' });
  });

  it('delivered via at least one channel → sent exactly once', async () => {
    const store = fakeStore({
      status: 'processing',
      _claimToken: 'worker-a',
      _leaseUntilMs: 7_000,
      _attempts: 1,
      payload: frozenPayload,
    });
    const ok = await markOutboxSent({
      ...store,
      ref: store.ref,
      fields: OUTBOX_FIELDS,
      token: 'worker-a',
      delivery: { fcmDelivered: 1, fcmAttempted: 2, emailDelivered: true },
      nowMs: 3_000,
    });
    expect(ok).toBe(true);
    expect(store.read()).toMatchObject({
      status: 'sent',
      _sentAt: 3_000,
      delivery: { fcmDelivered: 1, fcmAttempted: 2, emailDelivered: true },
    });
    // Stale worker cannot double-complete.
    const stale = await markOutboxSent({
      ...store,
      ref: store.ref,
      fields: OUTBOX_FIELDS,
      token: 'worker-b',
      delivery: { fcmDelivered: 2, fcmAttempted: 2, emailDelivered: true },
      nowMs: 3_100,
    });
    expect(stale).toBe(false);
  });

  it('zero channels delivered → failed with exponential backoff, never sent', async () => {
    const store = fakeStore({
      status: 'processing',
      _claimToken: 'worker-a',
      _leaseUntilMs: 7_000,
      _attempts: 1,
      payload: frozenPayload,
    });
    const res = await markOutboxFailed({
      ...store,
      ref: store.ref,
      fields: OUTBOX_FIELDS,
      token: 'worker-a',
      lastError: 'fcm 0/2 email false',
      nowMs: 3_000,
      backoffBaseMs: 10_000,
    });
    expect(res).toEqual({ kind: 'failed', nextAttemptAtMs: 3_000 + 10_000 * 2 ** 0 });
    const doc = store.read();
    expect(doc.status).toBe('pending');
    expect(doc._sentAt).toBeUndefined();
    expect(doc.lastError).toBe('fcm 0/2 email false');
    expect(doc._leaseUntilMs).toBeNull();
    expect(doc._claimToken).toBeNull();
  });

  it('after MAX_ATTEMPTS failures → dead_lettered with audit trail', async () => {
    const store = fakeStore({
      status: 'processing',
      _claimToken: 'worker-a',
      _leaseUntilMs: 7_000,
      _attempts: CRITICAL_OUTBOX_MAX_ATTEMPTS, // already at cap → this attempt is the last
      payload: frozenPayload,
    });
    const res = await markOutboxFailed({
      ...store,
      ref: store.ref,
      fields: OUTBOX_FIELDS,
      token: 'worker-a',
      lastError: 'fcm 0/0 email false',
      nowMs: 3_000,
      backoffBaseMs: 10_000,
    });
    expect(res).toEqual({ kind: 'dead_lettered' });
    const doc = store.read();
    expect(doc.status).toBe('dead_lettered');
    expect(doc.lastError).toContain('fcm 0/0');
    expect(doc._sentAt).toBeUndefined();
    expect(doc.deadLetteredAtMs).toBe(3_000);
  });
});
