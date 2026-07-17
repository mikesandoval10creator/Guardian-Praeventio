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
  type: 'incidents' | 'rag' | 'incidentClose';
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

  const runTransaction = async (fn: (tx: any) => Promise<unknown>) =>
    fn({
      get: async (ref: any) => {
        if (!transactionState.has(ref)) {
          const snapshot = typeof ref.get === 'function' ? await ref.get() : { data: () => ({}) };
          transactionState.set(ref, { ...(snapshot.data?.() ?? {}) });
        }
        return { data: () => ({ ...(transactionState.get(ref) ?? {}) }) };
      },
      update: (ref: any, patch: Record<string, unknown>) => {
        transactionState.set(ref, { ...(transactionState.get(ref) ?? {}), ...patch });
        if (typeof ref.update === 'function') void ref.update(patch);
      },
    });

  return { collection, runTransaction } as any;
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

    expect(captured).toHaveLength(3);
    expect(captured.map((c) => c.type).sort()).toEqual(['incidentClose', 'incidents', 'rag']);
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

  it('processes a pending critical incident from the initial snapshot after restart', async () => {
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
    const ref = {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const initialSnapshot = {
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'n1',
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

    await incidents.next(initialSnapshot);
    await new Promise((r) => setImmediate(r));

    expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  it('sends FCM multicast on a critical incident after the initial load', async () => {
    const captured: CapturedListener[] = [];
    const messaging = makeFakeMessaging();
    setupBackgroundTriggers({
      db: makeFakeDb(captured, {
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
      }),
      messaging,
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });

    const incidents = captured.find((c) => c.type === 'incidents')!;
    // Empty snapshot followed by a real change.
    incidents.next({ docChanges: () => [] });
    // Second call = real change
    const n42Update = vi.fn().mockResolvedValue(undefined);
    const n42Get = vi.fn().mockResolvedValue({
      data: () => ({}),
    });
    incidents.next({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'n42',
            ref: { update: n42Update, get: n42Get },
            data: () => ({
              title: 'Caída desde altura',
              metadata: { severity: 'Crítica', location: 'Andamio 3' },
              projectId: 'p1',
            }),
          },
        },
      ],
    });

    // Allow the async forEach iteration to flush
    await new Promise((r) => setImmediate(r));

    expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(1);
    const arg = messaging.sendEachForMulticast.mock.calls[0][0];
    expect(arg.tokens.sort()).toEqual(['tok-1', 'tok-2']); // supervisor+gerente only
    expect(arg.notification.title).toContain('Crítica');
    expect(arg.data).toEqual({ projectId: 'p1', nodeId: 'n42' });
  });

  it('releases a failed critical-alert claim so a later snapshot retries it', async () => {
    const captured: CapturedListener[] = [];
    const messaging = makeFakeMessaging();
    messaging.sendEachForMulticast
      .mockRejectedValueOnce(new Error('temporary FCM outage'))
      .mockResolvedValueOnce({ successCount: 1 });
    setupBackgroundTriggers({
      db: makeFakeDb(captured, {
        members: [{ id: 'u1', role: 'supervisor' }],
        users: { u1: { fcmToken: 'tok-1' } },
      }),
      messaging,
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });

    const ref = {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const snapshot = {
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'n-retry',
            ref,
            data: () => ({
              metadata: { severity: 'Alta' },
              projectId: 'p1',
            }),
          },
        },
      ],
    };
    const listener = captured.find((c) => c.type === 'incidents')!;
    listener.next(snapshot);
    await new Promise((r) => setImmediate(r));
    listener.next(snapshot);
    await new Promise((r) => setImmediate(r));

    expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(ref.update).toHaveBeenCalledWith(
      expect.objectContaining({ _criticalAlertSentAt: '__SERVER_TS__' }),
    );
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

  it('does NOT mark sent and releases for retry when every FCM token fails (no email)', async () => {
    const captured: CapturedListener[] = [];
    const messaging = makeFakeMessaging();
    messaging.sendEachForMulticast.mockResolvedValue({ successCount: 0, failureCount: 1 });
    setupBackgroundTriggers({
      db: makeFakeDb(captured, {
        members: [{ id: 'u1', role: 'supervisor' }],
        users: { u1: { fcmToken: 'tok-dead' } }, // delivery fails, no email on file
      }),
      messaging,
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });
    const ref = {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    captured.find((c) => c.type === 'incidents')!.next(criticalSnap('n-dead', ref));
    await new Promise((r) => setImmediate(r));

    expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(1);
    const patches = ref.update.mock.calls.map((c) => c[0]);
    // Never completed:
    expect(patches.some((p) => '_criticalAlertSentAt' in p)).toBe(false);
    // Released with the failure reason so a later snapshot/lease-expiry retries:
    expect(patches.some((p) => '_criticalAlertLastError' in p)).toBe(true);
  });

  it('marks sent when at least one FCM token succeeds (partial delivery)', async () => {
    const captured: CapturedListener[] = [];
    const messaging = makeFakeMessaging();
    messaging.sendEachForMulticast.mockResolvedValue({ successCount: 1, failureCount: 1 });
    setupBackgroundTriggers({
      db: makeFakeDb(captured, {
        members: [{ id: 'u1', role: 'supervisor' }],
        users: { u1: { fcmTokens: ['tok-ok', 'tok-dead'] } },
      }),
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

    const patches = ref.update.mock.calls.map((c) => c[0]);
    expect(patches.some((p) => p._criticalAlertSentAt === '__SERVER_TS__')).toBe(true);
  });

  it('falls back to the CPHS email and marks sent when a supervisor has no push token', async () => {
    const captured: CapturedListener[] = [];
    const messaging = makeFakeMessaging();
    const resend = makeFakeResend(); // send resolves
    setupBackgroundTriggers({
      db: makeFakeDb(captured, {
        members: [{ id: 'u1', role: 'supervisor' }],
        users: { u1: { email: 'sup@obra.cl' } }, // email only, no push token
        projects: { p1: { name: 'Obra Norte' } },
      }),
      messaging,
      resend,
      firestoreNamespace: fakeFirestoreNamespace,
      resendApiKey: 'test-key',
    });
    const ref = {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    captured.find((c) => c.type === 'incidents')!.next(criticalSnap('n-email', ref));
    await new Promise((r) => setImmediate(r));

    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled(); // no tokens to send to
    expect(resend.emails.send).toHaveBeenCalledTimes(1);
    const patches = ref.update.mock.calls.map((c) => c[0]);
    expect(patches.some((p) => p._criticalAlertSentAt === '__SERVER_TS__')).toBe(true);
  });

  it('does NOT mark sent when there are no push tokens and the email fails', async () => {
    const captured: CapturedListener[] = [];
    const messaging = makeFakeMessaging();
    const resend = makeFakeResend();
    resend.emails.send.mockRejectedValue(new Error('resend 500'));
    setupBackgroundTriggers({
      db: makeFakeDb(captured, {
        members: [{ id: 'u1', role: 'supervisor' }],
        users: { u1: { email: 'sup@obra.cl' } },
        projects: { p1: { name: 'Obra Norte' } },
      }),
      messaging,
      resend,
      firestoreNamespace: fakeFirestoreNamespace,
      resendApiKey: 'test-key',
    });
    const ref = {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    captured.find((c) => c.type === 'incidents')!.next(criticalSnap('n-noone', ref));
    await new Promise((r) => setImmediate(r));

    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
    const patches = ref.update.mock.calls.map((c) => c[0]);
    expect(patches.some((p) => '_criticalAlertSentAt' in p)).toBe(false);
    expect(patches.some((p) => '_criticalAlertLastError' in p)).toBe(true);
  });

  // AUDIT-2026-06 B19/B23 — mobile push was broken in prod: the app
  // registers device tokens via POST /api/push/register-token, which
  // arrayUnions into users/{uid}.fcmTokens[] (canonical, multi-device),
  // but this trigger only read the legacy singular users/{uid}.fcmToken.
  // Result: every mobile-registered supervisor got ZERO critical-incident
  // pushes. The trigger must union both fields (dedup included).
  it('sends to canonical fcmTokens[] (mobile-registered) and dedupes with legacy fcmToken', async () => {
    const captured: CapturedListener[] = [];
    const messaging = makeFakeMessaging();
    setupBackgroundTriggers({
      db: makeFakeDb(captured, {
        members: [
          { id: 'u1', role: 'supervisor' }, // mobile-only: canonical array
          { id: 'u2', role: 'gerente' }, // both fields, one duplicated
        ],
        users: {
          u1: { fcmTokens: ['tok-m1', 'tok-m2'] },
          u2: { fcmToken: 'tok-2', fcmTokens: ['tok-2', 'tok-m3'] },
        },
        projects: { p1: { name: 'Obra Norte' } },
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

    expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(1);
    const arg = messaging.sendEachForMulticast.mock.calls[0][0];
    expect(arg.tokens.sort()).toEqual(['tok-2', 'tok-m1', 'tok-m2', 'tok-m3']);
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
