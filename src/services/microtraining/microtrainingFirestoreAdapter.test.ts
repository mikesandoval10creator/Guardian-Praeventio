// Praeventio Guard — MicrotrainingAdapter unit tests.
//
// In-memory Firestore stub so the suite stays hermetic — same shape as
// photoEvidenceFirestoreAdapter.test.ts.

import { describe, it, expect } from 'vitest';
import {
  MicrotrainingAdapter,
  buildCertFromSession,
} from './microtrainingFirestoreAdapter.js';
import {
  MICROTRAINING_CATALOG,
  scoreSession,
  type MicroTrainingSession,
} from './lightningTrainingService.js';

interface DocStub {
  data: Record<string, unknown> | null;
}

function makeDb() {
  const store = new Map<string, Map<string, DocStub>>();
  let autoId = 0;
  const getCol = (path: string) => {
    if (!store.has(path)) store.set(path, new Map());
    return store.get(path)!;
  };
  function makeQuery(
    path: string,
    filters: Array<(d: any) => boolean>,
    sortBy?: string,
    sortDir?: 'asc' | 'desc',
    limitN?: number,
  ) {
    return {
      where(field: string, op: string, value: unknown) {
        return makeQuery(
          path,
          [
            ...filters,
            (doc) => {
              const v = (doc as Record<string, unknown>)[field];
              return op === '==' ? v === value : false;
            },
          ],
          sortBy,
          sortDir,
          limitN,
        );
      },
      orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
        return makeQuery(path, filters, field, dir, limitN);
      },
      limit(n: number) {
        return makeQuery(path, filters, sortBy, sortDir, n);
      },
      async get() {
        const col = getCol(path);
        let docs = [...col.entries()]
          .map(([id, d]) => ({ id, data: d.data ?? {} }))
          .filter((doc) => filters.every((f) => f(doc.data)));
        if (sortBy) {
          docs.sort((a, b) => {
            const av = (a.data as Record<string, unknown>)[sortBy!] as number;
            const bv = (b.data as Record<string, unknown>)[sortBy!] as number;
            if (av === bv) return 0;
            return (sortDir === 'desc' ? -1 : 1) * (av < bv ? -1 : 1);
          });
        }
        if (limitN !== undefined) docs = docs.slice(0, limitN);
        return {
          docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
        };
      },
    };
  }
  return {
    collection(path: string) {
      const col = getCol(path);
      return {
        doc(id?: string) {
          const docId = id ?? `auto_${++autoId}`;
          return {
            id: docId,
            async get() {
              const d = col.get(docId);
              return {
                exists: !!d,
                data: () => d?.data ?? undefined,
              };
            },
            async set(
              data: Record<string, unknown>,
              opts?: { merge?: boolean },
            ) {
              const prev = col.get(docId)?.data ?? null;
              if (opts?.merge && prev) {
                col.set(docId, { data: { ...prev, ...data } });
              } else {
                col.set(docId, { data: { ...data } });
              }
            },
          };
        },
        ...makeQuery(path, []),
      };
    },
    __store: store,
  };
}

const TENANT = 'tenant_acme';
const PROJECT = 'project_norte';

function buildPassingSession(): MicroTrainingSession {
  const alturaModule = MICROTRAINING_CATALOG.find(
    (m) => m.id === 'mt-altura-v1',
  )!;
  // Match every quiz block's correctIndex so the session passes.
  const answers = alturaModule.content
    .map((b, i) => ({ block: b, idx: i }))
    .filter((x) => x.block.kind === 'quiz')
    .map((x) => ({
      blockIndex: x.idx,
      selectedIndex:
        x.block.kind === 'quiz' ? x.block.payload.correctIndex : 0,
    }));
  const session: MicroTrainingSession = {
    workerUid: 'worker_pedro',
    moduleId: alturaModule.id,
    startedAt: Date.now() - 4 * 60 * 1000,
    completedAt: Date.now(),
    answers,
  };
  session.score = scoreSession(session, alturaModule);
  return session;
}

describe('MicrotrainingAdapter.saveSession', () => {
  it('persists a session with an auto-generated id', async () => {
    const db = makeDb();
    const adapter = new MicrotrainingAdapter(db, TENANT, PROJECT);
    const session = buildPassingSession();
    const id = await adapter.saveSession(session);
    expect(id).toMatch(/^auto_/);
    const sessions = await adapter.listSessionsForWorker('worker_pedro');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.moduleId).toBe('mt-altura-v1');
  });
});

describe('MicrotrainingAdapter.grantCert', () => {
  it('writes a cert doc keyed by moduleId (idempotent on re-grant)', async () => {
    const db = makeDb();
    const adapter = new MicrotrainingAdapter(db, TENANT, PROJECT);
    const session = buildPassingSession();
    const sessionId = await adapter.saveSession(session);
    const module = MICROTRAINING_CATALOG.find((m) => m.id === session.moduleId)!;
    const cert = buildCertFromSession(session, module, sessionId);
    await adapter.grantCert('worker_pedro', session.moduleId, cert);
    const certs = await adapter.listCertsForWorker('worker_pedro');
    expect(certs).toHaveLength(1);
    expect(certs[0]?.moduleId).toBe('mt-altura-v1');
    expect(certs[0]?.score).toBeGreaterThanOrEqual(80);
    // Re-grant: same docId so no duplicates.
    await adapter.grantCert('worker_pedro', session.moduleId, cert);
    const after = await adapter.listCertsForWorker('worker_pedro');
    expect(after).toHaveLength(1);
  });

  it('preserves riskCategory + certifiedAt + sessionId', async () => {
    const db = makeDb();
    const adapter = new MicrotrainingAdapter(db, TENANT, PROJECT);
    const session = buildPassingSession();
    const sessionId = await adapter.saveSession(session);
    const module = MICROTRAINING_CATALOG.find((m) => m.id === session.moduleId)!;
    await adapter.grantCert(
      'worker_pedro',
      session.moduleId,
      buildCertFromSession(session, module, sessionId),
    );
    const certs = await adapter.listCertsForWorker('worker_pedro');
    expect(certs[0]?.riskCategory).toBe('altura');
    expect(certs[0]?.sessionId).toBe(sessionId);
    expect(certs[0]?.certifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('MicrotrainingAdapter.listCertifiedModuleIds', () => {
  it('returns just the moduleId projection for selector consumption', async () => {
    const db = makeDb();
    const adapter = new MicrotrainingAdapter(db, TENANT, PROJECT);
    const session = buildPassingSession();
    const sessionId = await adapter.saveSession(session);
    const module = MICROTRAINING_CATALOG.find((m) => m.id === session.moduleId)!;
    await adapter.grantCert(
      'worker_pedro',
      session.moduleId,
      buildCertFromSession(session, module, sessionId),
    );
    const ids = await adapter.listCertifiedModuleIds('worker_pedro');
    expect(ids).toEqual(['mt-altura-v1']);
  });

  it('returns empty array for a worker with no certs', async () => {
    const db = makeDb();
    const adapter = new MicrotrainingAdapter(db, TENANT, PROJECT);
    const ids = await adapter.listCertifiedModuleIds('worker_new');
    expect(ids).toEqual([]);
  });
});

describe('MicrotrainingAdapter.listSessionsForWorker', () => {
  it('orders by startedAt desc and respects limit', async () => {
    const db = makeDb();
    const adapter = new MicrotrainingAdapter(db, TENANT, PROJECT);
    const base = buildPassingSession();
    // 3 sessions for same worker, different startedAt timestamps
    await adapter.saveSession({ ...base, startedAt: 1000 });
    await adapter.saveSession({ ...base, startedAt: 3000 });
    await adapter.saveSession({ ...base, startedAt: 2000 });
    // Different worker — should be filtered out.
    await adapter.saveSession({ ...base, workerUid: 'worker_other', startedAt: 5000 });

    const list = await adapter.listSessionsForWorker('worker_pedro', 2);
    expect(list).toHaveLength(2);
    expect(list[0]?.startedAt).toBe(3000); // newest first
    expect(list[1]?.startedAt).toBe(2000);
  });
});

describe('buildCertFromSession', () => {
  it('derives risk + sessionId + score from inputs', () => {
    const session = buildPassingSession();
    const module = MICROTRAINING_CATALOG.find((m) => m.id === session.moduleId)!;
    const cert = buildCertFromSession(session, module, 'sess_123');
    expect(cert.score).toBe(session.score);
    expect(cert.riskCategory).toBe('altura');
    expect(cert.sessionId).toBe('sess_123');
  });
});
