// Praeventio Guard — Round 21 B1 Phase 5 tests.
//
// Coverage matrix for `setupBackgroundTriggers`:
//   • Returns an unsubscribe handle that wires all three listeners
//   • Unsubscribe cancels all onSnapshot subscriptions
//   • Initial snapshots recover pending FCM, RAG, and post-mortem work
//   • Critical incident → multicast FCM to supervisor tokens
//   • Non-critical incident → no FCM
//   • Listener attach failure is caught (no throw out of setup)
//
// We don't import firebase-admin or Resend at runtime — only types. The
// fake firestore captures the `onSnapshot` callbacks so the test can
// drive snapshots manually. This mirrors how the route tests in
// src/__tests__/server/ avoid booting Firebase Admin.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupBackgroundTriggers,
  serializeByKey,
  _mutexInFlightSize,
} from './backgroundTriggers.js';

// ── fake firestore ──────────────────────────────────────────────────────
interface CapturedListener {
  type: 'incidents' | 'rag' | 'incidentClose' | 'outbox';
  next: (snapshot: any) => void | Promise<void>;
  error: (err: unknown) => void;
  unsub: ReturnType<typeof vi.fn>;
}

function makeFakeDb(captured: CapturedListener[], overrides: {
  members?: Array<{ id: string; role: string }>;
  users?: Record<string, { fcmToken?: string; fcmTokens?: string[]; email?: string }>;
  projects?: Record<string, { name?: string }>;
} = {}) {
  const members = overrides.members ?? [];
  const users = overrides.users ?? {};
  const projects = overrides.projects ?? {};
  const transactionState = new WeakMap<object, Record<string, unknown>>();
  const outboxCreates: Record<string, Record<string, unknown>> = {};

  const collection = vi.fn((name: string) => {
    // Path-based collection (e.g. `projects/p1/members`)
    if (name.startsWith('projects/') && name.endsWith('/members')) {
      return {
        get: () =>
          Promise.resolve({
            forEach: (cb: (d: any) => void) => {
              for (const m of members) {
                cb({ id: m.id, data: () => ({ role: m.role }) });
              }
            },
          }),
      };
    }
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: () =>
            Promise.resolve({
              data: () => users[uid] ?? {},
            }),
        }),
      };
    }
    if (name === 'projects') {
      return {
        doc: (id: string) => ({
          get: () =>
            Promise.resolve({
              data: () => projects[id] ?? {},
            }),
        }),
      };
    }
    if (name === 'nodes') {
      return {
        where: (_field: string, _op: string, vals: string[]) => ({
          onSnapshot: (
            next: (snap: any) => void,
            err: (e: unknown) => void,
          ) => {
            const isIncidents = vals.includes('Hallazgo');
            const unsub = vi.fn();
            captured.push({
              type: isIncidents ? 'incidents' : 'rag',
              next,
              error: err,
              unsub,
            });
            return unsub;
          },
        }),
      };
    }
    if (name === 'critical_alert_outbox' || name === 'incident_claims') {
      return {
        doc: (id: string) => ({
          id,
          path: `${name}/${id}`,
          get: () => Promise.resolve({ exists: false, data: () => ({}) }),
        }),
        where: (_field: string, _op: string, _vals: string[]) => ({
          onSnapshot: (
            next: (snap: any) => void,
            err: (e: unknown) => void,
          ) => {
            const unsub = vi.fn();
            captured.push({ type: 'outbox', next, error: err, unsub });
            return unsub;
          },
        }),
      };
    }
    if (name === 'incidents') {
      return {
        onSnapshot: (
          next: (snap: any) => void,
          err: (e: unknown) => void,
        ) => {
          const unsub = vi.fn();
          captured.push({ type: 'incidentClose', next, error: err, unsub });
          return unsub;
        },
      };
    }
    if (name.startsWith('tenants/')) {
      return {
        doc: () => ({
          get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
          set: vi.fn().mockResolvedValue(undefined),
        }),
      };
    }
    return { get: () => Promise.resolve({ forEach: () => {} }) };
  });

  const txState = new WeakMap<object, Record<string, unknown>>();
  const runTransaction = async (fn: (tx: any) => Promise<unknown>) => {
    const getRefState = (ref: any): Record<string, unknown> => {
      let state = txState.get(ref);
      if (!state) {
        state = {};
        txState.set(ref, state);
      }
      return state;
    };
    const txApi = {
      get: async (ref: any) => {
        const key = typeof ref.path === 'string' ? ref.path : typeof ref.id === 'string' ? ref.id : null;
        if (key && outboxCreates[key]) {
          return { exists: true, data: () => ({ ...outboxCreates[key] }) };
        }
        const state = getRefState(ref);
        let fallback: Record<string, unknown> = { ...state };
        if (Object.keys(fallback).length === 0 && typeof ref.get === 'function') {
          const snap = await ref.get();
          fallback = snap?.data?.() ?? {};
        }
        return { exists: Object.keys(fallback).length > 0, data: () => ({ ...fallback }) };
      },
      create: (ref: any, value: Record<string, unknown>) => {
        const key = typeof ref.path === 'string' ? ref.path : typeof ref.id === 'string' ? ref.id : null;
        if (key) {
          if (outboxCreates[key]) throw new Error('doc already exists');
          outboxCreates[key] = { ...value };
        }
        const state = getRefState(ref);
        if (Object.keys(state).length === 0) {
          Object.assign(state, value);
        } else {
          throw new Error('doc already exists');
        }
      },
      update: (ref: any, patch: Record<string, unknown>) => {
        const key = typeof ref.path === 'string' ? ref.path : typeof ref.id === 'string' ? ref.id : null;
        if (key) {
          outboxCreates[key] = { ...(outboxCreates[key] ?? {}), ...patch };
        }
        const state = getRefState(ref);
        Object.assign(state, patch);
        if (typeof ref.update === 'function') void ref.update(patch);
      },
    };
    return fn(txApi);
  };

  return { collection, runTransaction, outboxCreates } as any;
}

function makeFakeMessaging() {
  return {
    sendEachForMulticast: vi.fn(() => Promise.resolve({ successCount: 1 })),
  } as any;
}

function makeFakeResend() {
  return {
    emails: { send: vi.fn(() => Promise.resolve({ id: 'e1' })) },
  } as any;
}

const fakeFirestoreNamespace = {
  FieldValue: { serverTimestamp: () => '__SERVER_TS__' },
} as any;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('setupBackgroundTriggers', () => {
  it('attaches all onSnapshot listeners and returns an unsubscribe handle', () => {
    const captured: CapturedListener[] = [];
    const handle = setupBackgroundTriggers({
      db: makeFakeDb(captured),
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });

    expect(captured).toHaveLength(4);
    expect(captured.map((c) => c.type).sort()).toEqual([
      'incidentClose',
      'incidents',
      'outbox',
      'rag',
    ]);
    expect(typeof handle.unsubscribe).toBe('function');
  });

  it('unsubscribe() cancels all listeners', () => {
    const captured: CapturedListener[] = [];
    const handle = setupBackgroundTriggers({
      db: makeFakeDb(captured),
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });
    handle.unsubscribe();
    for (const c of captured) {
      expect(c.unsub).toHaveBeenCalledTimes(1);
    }
  });

  it('provisions the outbox from the initial snapshot after a restart (recovery)', async () => {
    const captured: CapturedListener[] = [];
    const db = makeFakeDb(captured, {
      members: [{ id: 'u1', role: 'supervisor' }],
      users: { u1: { fcmToken: 'tok-1' } },
    });
    setupBackgroundTriggers({
      db,
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });

    const incidents = captured.find((c) => c.type === 'incidents')!;
    const ref = {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const initialSnapshot = {
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'n-recovery',
            ref,
            data: () => ({
              metadata: { severity: 'Crítica' },
              projectId: 'p1',
            }),
          },
        },
      ],
    };
    await incidents.next(initialSnapshot);
    await new Promise((r) => setImmediate(r));

    // El primer snapshot tras restart provisiona el outbox.
    expect(db.outboxCreates['critical_alert_outbox/n-recovery']).toMatchObject({
      status: 'pending',
      payload: { supervisorUids: ['u1'], fcmTokens: ['tok-1'] },
    });
    // El segundo snapshot (replay) es idempotente — el claim ya está completado.
    await incidents.next(initialSnapshot);
    await new Promise((r) => setImmediate(r));
    expect(db.outboxCreates['critical_alert_outbox/n-recovery'].status).toBe('pending'); // sin mutar
  });

  it('provisions the outbox with multiple supervisors and union of fcm tokens + emails', async () => {
    const captured: CapturedListener[] = [];
    const db = makeFakeDb(captured, {
      members: [
        { id: 'u1', role: 'supervisor' },
        { id: 'u2', role: 'gerente' },
        { id: 'u3', role: 'trabajador' }, // ignored
      ],
      users: {
        u1: { fcmToken: 'tok-1', email: 'a@example.com' },
        u2: { fcmToken: 'tok-2', email: 'b@example.com' },
        u3: { fcmToken: 'tok-3' },
      },
      projects: { p1: { name: 'Obra Norte' } },
    });
    setupBackgroundTriggers({
      db,
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });

    const incidents = captured.find((c) => c.type === 'incidents')!;
    const n42Update = vi.fn().mockResolvedValue(undefined);
    const n42Get = vi.fn().mockResolvedValue({ data: () => ({}) });
    incidents.next({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'n42',
            ref: { update: n42Update, get: n42Get },
            data: () => ({
              title: 'Atrapamiento',
              metadata: { severity: 'Crítica' },
              projectId: 'p1',
            }),
          },
        },
      ],
    });
    await new Promise((r) => setImmediate(r));

    expect(db.outboxCreates['critical_alert_outbox/n42']).toMatchObject({
      payload: {
        supervisorUids: ['u1', 'u2'],
        fcmTokens: ['tok-1', 'tok-2'],
        emailRecipients: ['a@example.com', 'b@example.com'],
        severity: 'Crítica',
      },
    });
  });

  it('provisions the outbox but does NOT mark the node sent (delivery is the worker\'s job)', async () => {
    const captured: CapturedListener[] = [];
    const db = makeFakeDb(captured, {
      members: [{ id: 'u1', role: 'supervisor' }],
      users: { u1: { fcmToken: 'tok-1' } },
    });
    setupBackgroundTriggers({
      db,
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });

    const incidents = captured.find((c) => c.type === 'incidents')!;
    const ref = {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    incidents.next({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'n-no-sent-yet',
            ref,
            data: () => ({
              metadata: { severity: 'Crítica' },
              projectId: 'p1',
            }),
          },
        },
      ],
    });
    await new Promise((r) => setImmediate(r));

    expect(db.outboxCreates['critical_alert_outbox/n-no-sent-yet']).toMatchObject({ status: 'pending' });
    const patches = ref.update.mock.calls.map((c) => c[0]);
    expect(patches.some((p) => '_criticalAlertSentAt' in p)).toBe(false);
  });

  // [P0][VIDA] Delivery verification. sendEachForMulticast RESOLVES even when
  // every token is stale/unregistered (per-token failures live in the
  // BatchResponse, it does NOT throw). Marking _criticalAlertSentAt on a
  // resolved-but-undelivered send left the alert permanently "sent" and never
  // retried — nobody was told a worker was in danger. These pin the contract:
  // complete only when at least ONE channel (FCM or CPHS email) reached a human.
  const criticalSnap = (id: string, ref: any) => ({
    docChanges: () => [
      {
        type: 'added',
        doc: {
          id,
          ref,
          data: () => ({ metadata: { severity: 'Crítica' }, projectId: 'p1' }),
        },
      },
    ],
  });

  // [P0][VIDA] Outbox transaccional (deuda 94ba): el listener de incidentes
  // YA NO envía FCM/email directamente. Solo PROVISIONA el outbox con payload
  // congelado y marca `_criticalAlertOutboxProvisionedAt` en el nodo. La
  // entrega real la hace el worker del outbox (Trigger 4) con reintento,
  // backoff y dead-letter. Esto evita la ventana de "marcar enviado sin
  // entregar" que dejó alertas perdidas en producción.

  it('provisions the outbox with frozen fcm tokens when critical incident arrives', async () => {
    const captured: CapturedListener[] = [];
    const messaging = makeFakeMessaging();
    const db = makeFakeDb(captured, {
      members: [{ id: 'u1', role: 'supervisor' }],
      users: { u1: { fcmTokens: ['tok-ok', 'tok-dead'] } },
    });
    setupBackgroundTriggers({
      db,
      messaging,
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });
    const ref = {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    captured.find((c) => c.type === 'incidents')!.next(criticalSnap('n-partial', ref));
    await new Promise((r) => setImmediate(r));

    // No FCM directo desde el listener.
    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
    // El nodo se marca como "outbox provisionado".
    const patches = ref.update.mock.calls.map((c) => c[0]);
    expect(patches.some((p) => p._criticalAlertOutboxProvisionedAt === '__SERVER_TS__')).toBe(true);
    // El outbox tiene el payload congelado con tokens + emails.
    expect(db.outboxCreates['critical_alert_outbox/n-partial']).toMatchObject({
      status: 'pending',
      payload: {
        projectId: 'p1',
        nodeId: 'n-partial',
        supervisorUids: ['u1'],
        fcmTokens: ['tok-ok', 'tok-dead'],
        emailRecipients: [],
      },
    });
  });

  it('provisions outbox with frozen email recipients when supervisor has no push token', async () => {
    const captured: CapturedListener[] = [];
    const messaging = makeFakeMessaging();
    const db = makeFakeDb(captured, {
      members: [{ id: 'u1', role: 'supervisor' }],
      users: { u1: { email: 'sup@obra.cl' } },
    });
    setupBackgroundTriggers({
      db,
      messaging,
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
      resendApiKey: 'test-key',
    });
    const ref = {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    captured.find((c) => c.type === 'incidents')!.next(criticalSnap('n-email', ref));
    await new Promise((r) => setImmediate(r));

    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
    expect(db.outboxCreates['critical_alert_outbox/n-email']).toMatchObject({
      status: 'pending',
      payload: {
        fcmTokens: [],
        emailRecipients: ['sup@obra.cl'],
      },
    });
  });

  it('still provisions the outbox when FCM tokens are dead (delivery is the worker\'s job)', async () => {
    const captured: CapturedListener[] = [];
    const db = makeFakeDb(captured, {
      members: [{ id: 'u1', role: 'supervisor' }],
      users: { u1: { fcmToken: 'tok-dead' } },
    });
    setupBackgroundTriggers({
      db,
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });
    const ref = {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    captured.find((c) => c.type === 'incidents')!.next(criticalSnap('n-dead', ref));
    await new Promise((r) => setImmediate(r));

    // El listener no decide si la entrega fue exitosa — solo provisiona.
    expect(db.outboxCreates['critical_alert_outbox/n-dead']).toMatchObject({ status: 'pending' });
    const patches = ref.update.mock.calls.map((c) => c[0]);
    expect(patches.some((p) => '_criticalAlertSentAt' in p)).toBe(false);
    expect(patches.some((p) => p._criticalAlertOutboxProvisionedAt === '__SERVER_TS__')).toBe(true);
  });

  it('provisions the outbox with email recipients even if FCM has no tokens', async () => {
    const captured: CapturedListener[] = [];
    const db = makeFakeDb(captured, {
      members: [{ id: 'u1', role: 'supervisor' }],
      users: { u1: { email: 'sup@obra.cl' } },
      projects: { p1: { name: 'Obra Norte' } },
    });
    setupBackgroundTriggers({
      db,
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
      resendApiKey: 'test-key',
    });
    const ref = {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    captured.find((c) => c.type === 'incidents')!.next(criticalSnap('n-noone', ref));
    await new Promise((r) => setImmediate(r));

    // El listener provisiona el outbox aunque no haya FCM tokens.
    expect(db.outboxCreates['critical_alert_outbox/n-noone']).toMatchObject({
      status: 'pending',
      payload: {
        fcmTokens: [],
        emailRecipients: ['sup@obra.cl'],
      },
    });
    // El nodo no se marca como enviado (es responsabilidad del worker).
    const patches = ref.update.mock.calls.map((c) => c[0]);
    expect(patches.some((p) => '_criticalAlertSentAt' in p)).toBe(false);
    expect(patches.some((p) => p._criticalAlertOutboxProvisionedAt === '__SERVER_TS__')).toBe(true);
  });

  // AUDIT-2026-06 B19/B23 — mobile push was broken in prod: the app
  // registers device tokens via POST /api/push/register-token, which
  // arrayUnions into users/{uid}.fcmTokens[] (canonical, multi-device),
  // but this trigger only read the legacy singular users/{uid}.fcmToken.
  // Result: every mobile-registered supervisor got ZERO critical-incident
  // pushes. The trigger must union both fields (dedup included).
  it('provisions the outbox with the union of canonical fcmTokens[] and legacy fcmToken (deduped)', async () => {
    const captured: CapturedListener[] = [];
    const db = makeFakeDb(captured, {
      members: [
        { id: 'u1', role: 'supervisor' }, // mobile-only: canonical array
        { id: 'u2', role: 'gerente' }, // both fields, one duplicated
      ],
      users: {
        u1: { fcmTokens: ['tok-m1', 'tok-m2'] },
        u2: { fcmToken: 'tok-2', fcmTokens: ['tok-2', 'tok-m3'] },
      },
      projects: { p1: { name: 'Obra Norte' } },
    });
    setupBackgroundTriggers({
      db,
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });

    const incidents = captured.find((c) => c.type === 'incidents')!;
    incidents.next({ docChanges: () => [] }); // initial load
    incidents.next({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'n50',
            ref: {
              update: vi.fn().mockResolvedValue(undefined),
              get: vi.fn().mockResolvedValue({ data: () => ({}) }),
            },
            data: () => ({
              title: 'Atrapamiento',
              metadata: { severity: 'Crítica' },
              projectId: 'p1',
            }),
          },
        },
      ],
    });
    await new Promise((r) => setImmediate(r));

    // El outbox congeló el union de tokens (legacy fcmToken + canonical
    // fcmTokens[]), con dedup: tok-2 aparece en ambas fuentes.
    expect(db.outboxCreates['critical_alert_outbox/n50'].payload.fcmTokens.sort()).toEqual([
      'tok-2',
      'tok-m1',
      'tok-m2',
      'tok-m3',
    ]);
  });

  it('skips FCM when severity is not critical', async () => {
    const captured: CapturedListener[] = [];
    const messaging = makeFakeMessaging();
    setupBackgroundTriggers({
      db: makeFakeDb(captured, {
        members: [{ id: 'u1', role: 'supervisor' }],
        users: { u1: { fcmToken: 'tok-1' } },
      }),
      messaging,
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });

    const incidents = captured.find((c) => c.type === 'incidents')!;
    incidents.next({ docChanges: () => [] }); // initial load
    incidents.next({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'n1',
            data: () => ({
              metadata: { severity: 'Baja' },
              projectId: 'p1',
            }),
          },
        },
      ],
    });
    await new Promise((r) => setImmediate(r));
    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('processes RAG ingestion: writes embedding + completed status', async () => {
    const captured: CapturedListener[] = [];
    const generateEmbeddingsBatch = vi.fn(
      async (_t: string[]) => [[0.1, 0.2, 0.3]],
    );
    const updateMock = vi.fn((_payload: Record<string, unknown>) =>
      Promise.resolve(),
    );

    setupBackgroundTriggers({
      db: makeFakeDb(captured),
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
      generateEmbeddingsBatch,
    });

    const rag = captured.find((c) => c.type === 'rag')!;
    const getMock = vi.fn().mockResolvedValue({
      data: () => ({ _ragProcessingStatus: undefined }),
    });
    await rag.next({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'doc1',
            ref: { update: updateMock, get: getMock },
            data: () => ({
              type: 'normative',
              title: 'DS 54',
              description: 'Comité Paritario',
              content: 'Reglamento DS 54 sobre comités paritarios de higiene y seguridad',
            }),
          },
        },
      ],
    });

    expect(generateEmbeddingsBatch).toHaveBeenCalledTimes(1);
    // First update: processing; second: completed with embedding
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      _ragProcessingStatus: 'processing',
    });
    expect(updateMock.mock.calls[1][0]).toMatchObject({
      embedding: [0.1, 0.2, 0.3],
      _ragProcessingStatus: 'completed',
    });
  });

  it('skips RAG processing when doc already has _ragProcessingStatus=completed', async () => {
    const captured: CapturedListener[] = [];
    const generateEmbeddingsBatch = vi.fn(
      async (_t: string[]) => [[0.1]],
    );
    setupBackgroundTriggers({
      db: makeFakeDb(captured),
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
      generateEmbeddingsBatch,
    });

    const rag = captured.find((c) => c.type === 'rag')!;
    await rag.next({ docChanges: () => [] });
    await rag.next({
      docChanges: () => [
        {
          type: 'modified',
          doc: {
            id: 'doc1',
            ref: { update: vi.fn() },
            data: () => ({
              type: 'pts',
              _ragProcessingStatus: 'completed',
              title: 'X',
            }),
          },
        },
      ],
    });
    expect(generateEmbeddingsBatch).not.toHaveBeenCalled();
  });

  it('reclaims a RAG document left processing without a live lease by a crashed process', async () => {
    const captured: CapturedListener[] = [];
    const generateEmbeddingsBatch = vi.fn(async () => [[0.9, 0.8]]);
    const update = vi.fn().mockResolvedValue(undefined);
    setupBackgroundTriggers({
      db: makeFakeDb(captured),
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
      generateEmbeddingsBatch,
    });

    const rag = captured.find((c) => c.type === 'rag')!;
    await rag.next({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'doc-crashed',
            ref: {
              get: vi.fn().mockResolvedValue({
                data: () => ({ _ragProcessingStatus: 'processing' }),
              }),
              update,
            },
            data: () => ({
              type: 'document',
              title: 'Procedimiento pendiente',
              content: 'Contenido suficiente para recuperar el embedding tras reinicio',
              _ragProcessingStatus: 'processing',
            }),
          },
        },
      ],
    });

    expect(generateEmbeddingsBatch).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ _ragProcessingStatus: 'completed' }),
    );
  });

  it('processes a closed incident post-mortem from the initial snapshot after restart', async () => {
    const captured: CapturedListener[] = [];
    const update = vi.fn().mockResolvedValue(undefined);
    setupBackgroundTriggers({
      db: makeFakeDb(captured),
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
      generateEmbeddingsBatch: vi.fn(async () => [[0.2, 0.4]]),
    });

    const listener = captured.find((c) => c.type === 'incidentClose')!;
    listener.next({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'inc-restart-1',
            ref: {
              get: vi.fn().mockResolvedValue({ data: () => ({}) }),
              update,
            },
            data: () => ({
              tenantId: 'tenant-1',
              projectId: 'project-1',
              status: 'closed',
              rootCause: 'Falla de bloqueo de energía peligrosa',
              type: 'machinery',
            }),
          },
        },
      ],
    });
    await new Promise((r) => setImmediate(r));

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        _postmortemWrittenAt: '__SERVER_TS__',
        _postmortemNodeId: 'incident-inc-restart-1-postmortem',
      }),
    );
  });
});

// ── H23 Per-entity mutex (E.5 P2) ──────────────────────────────────────
//
// `serializeByKey` is the seam used by every handler in this module so
// that concurrent triggers on the SAME doc id run strictly sequentially,
// while different ids stay parallel.
describe('serializeByKey (H23 mutex)', () => {
  it('serializes concurrent calls with the SAME key (no overlap)', async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];

    function task(id: number) {
      return async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        // Yield several microtasks to give any concurrent task a chance
        // to interleave — if the mutex is broken, `maxActive` will go > 1.
        await new Promise((r) => setTimeout(r, 5));
        order.push(id);
        active--;
      };
    }

    const p1 = serializeByKey('same-uid', task(1));
    const p2 = serializeByKey('same-uid', task(2));
    const p3 = serializeByKey('same-uid', task(3));

    await Promise.all([p1, p2, p3]);

    expect(maxActive).toBe(1); // strictly sequential
    expect(order).toEqual([1, 2, 3]); // FIFO ordering preserved
  });

  it('runs DIFFERENT keys in parallel (no contention across entities)', async () => {
    let active = 0;
    let maxActive = 0;

    function task() {
      return async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
      };
    }

    await Promise.all([
      serializeByKey('uid-A', task()),
      serializeByKey('uid-B', task()),
      serializeByKey('uid-C', task()),
    ]);

    expect(maxActive).toBeGreaterThanOrEqual(2); // parallel allowed
  });

  it('releases the slot after settle so a later call does not hang', async () => {
    await serializeByKey('release-test', async () => 'first');
    // A microtask hop for the self-clean .finally().
    await new Promise((r) => setTimeout(r, 0));
    expect(_mutexInFlightSize()).toBe(0);

    const result = await serializeByKey('release-test', async () => 'second');
    expect(result).toBe('second');
  });

  it('a rejection in one call does NOT poison the chain', async () => {
    const p1 = serializeByKey('poison', async () => {
      throw new Error('boom');
    });
    // Attach a catch handler synchronously so vitest does not flag the
    // rejection as unhandled.
    const p1Handled = p1.catch((e: Error) => e.message);
    const p2 = serializeByKey('poison', async () => 'ok');

    await expect(p1Handled).resolves.toBe('boom');
    await expect(p2).resolves.toBe('ok');
  });
});
