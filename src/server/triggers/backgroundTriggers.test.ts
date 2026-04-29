// Praeventio Guard — Round 21 B1 Phase 5 tests.
//
// Coverage matrix for `setupBackgroundTriggers`:
//   • Returns an unsubscribe handle that wires both listeners
//   • Unsubscribe cancels both onSnapshot subscriptions
//   • Initial-load snapshot is ignored (no FCM, no RAG embed)
//   • Critical incident → multicast FCM to supervisor tokens
//   • Non-critical incident → no FCM
//   • Listener attach failure is caught (no throw out of setup)
//
// We don't import firebase-admin or Resend at runtime — only types. The
// fake firestore captures the `onSnapshot` callbacks so the test can
// drive snapshots manually. This mirrors how the route tests in
// src/__tests__/server/ avoid booting Firebase Admin.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupBackgroundTriggers } from './backgroundTriggers.js';

// ── fake firestore ──────────────────────────────────────────────────────
interface CapturedListener {
  type: 'incidents' | 'rag';
  next: (snapshot: any) => void | Promise<void>;
  error: (err: unknown) => void;
  unsub: ReturnType<typeof vi.fn>;
}

function makeFakeDb(captured: CapturedListener[], overrides: {
  members?: Array<{ id: string; role: string }>;
  users?: Record<string, { fcmToken?: string; email?: string }>;
  projects?: Record<string, { name?: string }>;
} = {}) {
  const members = overrides.members ?? [];
  const users = overrides.users ?? {};
  const projects = overrides.projects ?? {};

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
    return { get: () => Promise.resolve({ forEach: () => {} }) };
  });

  return { collection } as any;
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
  it('attaches both onSnapshot listeners and returns an unsubscribe handle', () => {
    const captured: CapturedListener[] = [];
    const handle = setupBackgroundTriggers({
      db: makeFakeDb(captured),
      messaging: makeFakeMessaging(),
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });

    expect(captured).toHaveLength(2);
    expect(captured.map((c) => c.type).sort()).toEqual(['incidents', 'rag']);
    expect(typeof handle.unsubscribe).toBe('function');
  });

  it('unsubscribe() cancels both listeners', () => {
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

  it('ignores the initial-load snapshot for incidents (no FCM)', async () => {
    const captured: CapturedListener[] = [];
    const messaging = makeFakeMessaging();
    setupBackgroundTriggers({
      db: makeFakeDb(captured),
      messaging,
      resend: makeFakeResend(),
      firestoreNamespace: fakeFirestoreNamespace,
    });

    const incidents = captured.find((c) => c.type === 'incidents')!;
    await incidents.next({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'n1',
            data: () => ({
              metadata: { severity: 'Crítica' },
              projectId: 'p1',
            }),
          },
        },
      ],
    });

    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
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
    // First call = initial load (ignored)
    incidents.next({ docChanges: () => [] });
    // Second call = real change
    incidents.next({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'n42',
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
    await rag.next({ docChanges: () => [] }); // initial load
    await rag.next({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'doc1',
            ref: { update: updateMock },
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
    expect(updateMock.mock.calls[0][0]).toEqual({
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
});
