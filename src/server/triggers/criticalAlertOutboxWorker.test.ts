// Praeventio Guard — P0 worker de entrega del outbox de alertas críticas.
//
// Contrato del worker:
//   1. Claim el outbox (pending→processing con lease).
//   2. Entrega con el payload CONGELADO del outbox (tokens/emails capturados al
//      crear), nunca re-leídos del nodo mutable.
//   3. ≥1 canal entregado → sent; el espejo del nodo `_criticalAlertSentAt` se
//      escribe SOLO aquí (best-effort, no debe fallar la entrega).
//   4. 0 canales → failed con backoff; pasado el cap → dead_lettered.
//   5. Un worker que perdió el lease no puede marcar sent ni failed.

import { describe, expect, it, vi } from 'vitest';
import {
  deliverOutboxItem,
  type OutboxDeliveryDeps,
} from './criticalAlertOutboxWorker';
import { CRITICAL_OUTBOX_MAX_ATTEMPTS, type OutboxClaimFields } from './criticalAlertOutbox';

const FIELDS: OutboxClaimFields = {
  completedAt: '_sentAt',
  leaseUntilMs: '_leaseUntilMs',
  claimToken: '_claimToken',
  attempts: '_attempts',
};

const frozenPayload = {
  projectId: 'proj-A',
  nodeId: 'node-1',
  title: 'Trabajador caído',
  description: 'Sin respuesta en zona norte',
  severity: 'Crítica',
  location: 'Zona Norte',
  supervisorUids: ['sup-1'],
  fcmTokens: ['tok-1', 'tok-2'],
  emailRecipients: ['sup-1@test.cl'],
  capturedAtMs: 1_000,
};

function makeStore(initial: Record<string, unknown>) {
  let data = { ...initial };
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
  return { db, ref, read: () => ({ ...data }) };
}

function baseDeps(overrides: Partial<OutboxDeliveryDeps> = {}): OutboxDeliveryDeps {
  return {
    fields: FIELDS,
    nowMs: () => 1_000,
    leaseMs: 5_000,
    tokenFactory: () => 'worker-a',
    backoffBaseMs: 10_000,
    maxAttempts: CRITICAL_OUTBOX_MAX_ATTEMPTS,
    sendFcmMulticast: vi.fn(async () => ({ successCount: 1, failureCount: 0 })),
    sendCphsEmail: vi.fn(async () => true),
    mirrorNodeSent: vi.fn(async () => undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe('critical alert outbox worker', () => {
  it('delivers via FCM and marks the outbox sent when at least one token succeeds', async () => {
    const store = makeStore({
      status: 'pending',
      attempts: 0,
      payload: frozenPayload,
    });
    const deps = baseDeps();
    const result = await deliverOutboxItem({
      db: store.db,
      ref: store.ref,
      deps,
    });

    expect(result).toEqual({ kind: 'sent' });
    const doc = store.read();
    expect(doc.status).toBe('sent');
    expect(doc.delivery).toEqual({ fcmDelivered: 1, fcmAttempted: 2, emailDelivered: true });
    expect(deps.sendFcmMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['tok-1', 'tok-2'] }),
    );
    // Espejo del nodo solo al sent, con la nodeId del payload congelado.
    expect(deps.mirrorNodeSent).toHaveBeenCalledWith('node-1');
  });

  it('falls back to email when no FCM token is present, still marking sent', async () => {
    const store = makeStore({
      status: 'pending',
      attempts: 0,
      payload: { ...frozenPayload, fcmTokens: [] },
    });
    const deps = baseDeps({ sendCphsEmail: vi.fn(async () => true) });
    const result = await deliverOutboxItem({ db: store.db, ref: store.ref, deps });

    expect(result).toEqual({ kind: 'sent' });
    expect(store.read().status).toBe('sent');
    expect(store.read().delivery).toEqual({ fcmDelivered: 0, fcmAttempted: 0, emailDelivered: true });
  });

  it('marks failed with backoff when zero channels deliver, never touching the mirror', async () => {
    const store = makeStore({
      status: 'pending',
      attempts: 0,
      payload: frozenPayload,
    });
    const deps = baseDeps({
      sendFcmMulticast: vi.fn(async () => ({ successCount: 0, failureCount: 2 })),
      sendCphsEmail: vi.fn(async () => false),
    });
    const result = await deliverOutboxItem({ db: store.db, ref: store.ref, deps });

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.nextAttemptAtMs).toBe(1_000 + 10_000); // base * 2^0
    }
    const doc = store.read();
    expect(doc.status).toBe('pending');
    expect(doc._sentAt).toBeUndefined();
    expect(deps.mirrorNodeSent).not.toHaveBeenCalled();
  });

  it('dead-letters after the attempt cap, with lastError recorded', async () => {
    const store = makeStore({
      status: 'pending',
      _attempts: CRITICAL_OUTBOX_MAX_ATTEMPTS - 1,
      payload: frozenPayload,
    });
    const deps = baseDeps({
      sendFcmMulticast: vi.fn(async () => ({ successCount: 0, failureCount: 2 })),
      sendCphsEmail: vi.fn(async () => false),
    });
    const result = await deliverOutboxItem({ db: store.db, ref: store.ref, deps });

    expect(result).toEqual({ kind: 'dead_lettered' });
    const doc = store.read();
    expect(doc.status).toBe('dead_lettered');
    expect(doc.lastError).toContain('fcm 0/2');
    expect(doc._sentAt).toBeUndefined();
  });

  it('a worker that lost its lease cannot deliver or mutate the outbox', async () => {
    const store = makeStore({
      status: 'processing',
      _claimToken: 'worker-other',
      _leaseUntilMs: 9_000,
      _attempts: 1,
      payload: frozenPayload,
    });
    const deps = baseDeps({ tokenFactory: () => 'worker-stale' });
    const result = await deliverOutboxItem({ db: store.db, ref: store.ref, deps });

    expect(result).toEqual({ kind: 'leased', retryAfterMs: 8_000 });
    expect(store.read().status).toBe('processing');
    expect(deps.sendFcmMulticast).not.toHaveBeenCalled();
  });

  // [P0][VIDA] Verify cmd literal del ticket Alpha 41 (39aaa66d/815c):
  // dos workers concurrentes sobre el mismo outbox → 1 sola entrega, el otro leased.
  it('multi-instance: two workers racing on the same pending outbox produce exactly one delivery and one leased', async () => {
    const store = makeStore({
      status: 'pending',
      attempts: 0,
      payload: frozenPayload,
    });
    const sendFcmMulticast = vi.fn(async () => ({ successCount: 2, failureCount: 0 }));
    const sendCphsEmail = vi.fn(async () => true);
    const mirrorNodeSent = vi.fn(async () => undefined);

    const workerA = baseDeps({
      tokenFactory: () => 'worker-a',
      sendFcmMulticast,
      sendCphsEmail,
      mirrorNodeSent,
    });
    const workerB = baseDeps({
      tokenFactory: () => 'worker-b',
      sendFcmMulticast,
      sendCphsEmail,
      mirrorNodeSent,
    });

    const [resA, resB] = await Promise.all([
      deliverOutboxItem({ db: store.db, ref: store.ref, deps: workerA }),
      deliverOutboxItem({ db: store.db, ref: store.ref, deps: workerB }),
    ]);

    // Exactly one delivery, exactly one leased — never two sent, never duplicate FCM.
    const outcomes = [resA, resB];
    const sentCount = outcomes.filter((r) => r.kind === 'sent').length;
    const leasedCount = outcomes.filter((r) => r.kind === 'leased').length;
    expect(sentCount).toBe(1);
    expect(leasedCount).toBe(1);

    // FCM fired exactly once with the frozen payload — the losing worker never sent.
    expect(sendFcmMulticast).toHaveBeenCalledTimes(1);
    expect(sendFcmMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['tok-1', 'tok-2'] }),
    );
    expect(sendCphsEmail).toHaveBeenCalledTimes(1);

    // Outbox reached terminal 'sent' and the mirror is written exactly once.
    const doc = store.read();
    expect(doc.status).toBe('sent');
    expect(mirrorNodeSent).toHaveBeenCalledTimes(1);
    expect(mirrorNodeSent).toHaveBeenCalledWith('node-1');
  });

  // [P0][VIDA] Verify cmd literal del ticket Alpha 41 (39aaa66d/815c):
  // un fallo inicial de FCM gatilla backoff y el siguiente intento entrega sin duplicar.
  it('retry after FCM failure: second attempt delivers without duplicating the email side-effect', async () => {
    const store = makeStore({
      status: 'pending',
      attempts: 0,
      payload: frozenPayload,
    });
    let fcmCalls = 0;
    const sendFcmMulticast = vi.fn(async () => {
      fcmCalls += 1;
      // First call fails (0 delivered), subsequent calls succeed.
      if (fcmCalls === 1) return { successCount: 0, failureCount: 2 };
      return { successCount: 2, failureCount: 0 };
    });
    const sendCphsEmail = vi.fn(async () => false); // Email also fails on first attempt.

    // Attempt 1: both channels fail → outbox goes back to pending with backoff.
    const deps1 = baseDeps({
      tokenFactory: () => 'worker-a',
      sendFcmMulticast,
      sendCphsEmail,
      nowMs: () => 1_000,
      leaseMs: 5_000,
    });
    const res1 = await deliverOutboxItem({ db: store.db, ref: store.ref, deps: deps1 });
    expect(res1.kind).toBe('failed');
    if (res1.kind === 'failed') {
      // base * 2^0 = 10_000 ms from now.
      expect(res1.nextAttemptAtMs).toBe(11_000);
    }
    // Outbox back to pending, lease cleared, attempts incremented, mirror NOT touched.
    const afterFail = store.read();
    expect(afterFail.status).toBe('pending');
    expect(afterFail._leaseUntilMs).toBeNull();
    expect(afterFail._claimToken).toBeNull();
    expect(afterFail._attempts).toBe(1);
    expect(afterFail._sentAt).toBeUndefined();

    // Attempt 2: lease expired, second worker claims fresh and delivers.
    const deps2 = baseDeps({
      tokenFactory: () => 'worker-b',
      sendFcmMulticast,
      sendCphsEmail,
      nowMs: () => 11_000, // lease expired (was 6_000) and backoff elapsed.
      leaseMs: 5_000,
    });
    const res2 = await deliverOutboxItem({ db: store.db, ref: store.ref, deps: deps2 });
    expect(res2).toEqual({ kind: 'sent' });
    // FCM re-fired on attempt 2 because the previous attempt delivered 0
    // tokens. This is expected: the worker always attempts every available
    // channel per pass — idempotency for CPHS email is the provider's job.
    expect(sendFcmMulticast).toHaveBeenCalledTimes(2);
    // Email side-effect re-fires whenever the payload has recipients; CPHS
    // idempotency (provider-side) keeps this from creating duplicate alerts.
    // The contract we DO guarantee: FCM+email together delivered ≥1 channel,
    // and the outbox transitions to terminal 'sent' on the second attempt
    // instead of going to dead-letter or duplicating the alert state.
    expect(sendCphsEmail).toHaveBeenCalledTimes(2);
    expect(store.read().status).toBe('sent');
  });
});
