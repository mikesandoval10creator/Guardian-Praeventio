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
});
