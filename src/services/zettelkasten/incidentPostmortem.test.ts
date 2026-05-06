// SPDX-License-Identifier: MIT
//
// Sprint 34 — incidentPostmortem coverage.

import { describe, it, expect, vi } from 'vitest';
import {
  writeIncidentPostmortemNode,
  shouldWritePostmortem,
  __testOnly_pickAnchorFromType,
  type IncidentDoc,
  type MinimalFirestore,
} from './incidentPostmortem';

// ── Fake store ──────────────────────────────────────────────────────

interface CapturedWrite {
  collection: string;
  docId: string;
  data: Record<string, unknown>;
  merge: boolean;
}

function makeFakeStore(opts: { failOn?: 'nodes' | 'edges' | 'audit' } = {}): {
  store: MinimalFirestore;
  writes: CapturedWrite[];
} {
  const writes: CapturedWrite[] = [];
  const store: MinimalFirestore = {
    collection(path: string) {
      return {
        doc(id: string) {
          return {
            async set(data, opt) {
              if (
                (opts.failOn === 'nodes' && path.endsWith('/zettelkasten_nodes')) ||
                (opts.failOn === 'edges' && path.endsWith('/zettelkasten_edges')) ||
                (opts.failOn === 'audit' && path.endsWith('/audit_log'))
              ) {
                throw new Error(`fake_${opts.failOn}_write_failure`);
              }
              writes.push({
                collection: path,
                docId: id,
                data: data as Record<string, unknown>,
                merge: !!opt?.merge,
              });
              return undefined;
            },
          };
        },
      };
    },
  };
  return { store, writes };
}

const baseIncident: IncidentDoc = {
  id: 'inc-001',
  tenantId: 't1',
  projectId: 'p1',
  status: 'closed',
  type: 'fall-from-height',
  rootCause: 'Trabajador no usó arnés en altura por falta de inspección pre-tarea.',
  workerUid: 'u-7',
  occurredAt: '2026-05-04T10:00:00Z',
  severity: 'Alta',
};

describe('shouldWritePostmortem', () => {
  it('returns true for closed incident with rootCause', () => {
    expect(shouldWritePostmortem(baseIncident)).toBe(true);
  });
  it('returns true for resolved status as well', () => {
    expect(shouldWritePostmortem({ ...baseIncident, status: 'resolved' })).toBe(true);
  });
  it('returns false when status is open', () => {
    expect(shouldWritePostmortem({ ...baseIncident, status: 'open' })).toBe(false);
  });
  it('returns false when rootCause is empty / whitespace', () => {
    expect(shouldWritePostmortem({ ...baseIncident, rootCause: '' })).toBe(false);
    expect(shouldWritePostmortem({ ...baseIncident, rootCause: '   ' })).toBe(false);
  });
  it('returns false when missing tenantId / projectId / id', () => {
    expect(shouldWritePostmortem({ ...baseIncident, tenantId: '' })).toBe(false);
    expect(shouldWritePostmortem({ ...baseIncident, projectId: '' })).toBe(false);
    expect(shouldWritePostmortem({ ...baseIncident, id: '' })).toBe(false);
  });
});

describe('__testOnly_pickAnchorFromType', () => {
  it('maps fall-from-height to DS-594', () => {
    expect(__testOnly_pickAnchorFromType('fall-from-height')).toBe('norma-DS-594');
  });
  it('maps fatality to Ley-16744', () => {
    expect(__testOnly_pickAnchorFromType('fatality')).toBe('norma-Ley-16744');
  });
  it('falls back to DS-594 for unknown type', () => {
    expect(__testOnly_pickAnchorFromType('alien-attack')).toBe('norma-DS-594');
  });
  it('falls back to DS-594 for undefined', () => {
    expect(__testOnly_pickAnchorFromType(undefined)).toBe('norma-DS-594');
  });
});

describe('writeIncidentPostmortemNode', () => {
  it('Test 1: closed incident with rootCause → writes node + edge + audit', async () => {
    const { store, writes } = makeFakeStore();
    const genEmbedding = vi.fn(async () => [0.1, 0.2, 0.3]);

    const res = await writeIncidentPostmortemNode(baseIncident, {
      store,
      genEmbedding,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.nodeId).toBe('incident-inc-001-postmortem');
    expect(res.anchorNodeId).toBe('norma-DS-594');
    expect(res.edgeId).toBe('incident-inc-001-postmortem__to__norma-DS-594');

    expect(genEmbedding).toHaveBeenCalledWith(baseIncident.rootCause);

    const nodeWrite = writes.find((w) => w.collection === 'tenants/t1/zettelkasten_nodes');
    const edgeWrite = writes.find((w) => w.collection === 'tenants/t1/zettelkasten_edges');
    const auditWrite = writes.find((w) => w.collection === 'tenants/t1/audit_log');

    expect(nodeWrite).toBeDefined();
    expect(edgeWrite).toBeDefined();
    expect(auditWrite).toBeDefined();

    expect(nodeWrite!.docId).toBe('incident-inc-001-postmortem');
    expect(nodeWrite!.merge).toBe(true);
    expect(nodeWrite!.data.type).toBe('incident_postmortem');
    expect(nodeWrite!.data.embedding).toEqual([0.1, 0.2, 0.3]);
    expect((nodeWrite!.data.metadata as any).projectId).toBe('p1');
    expect((nodeWrite!.data.metadata as any).incidentId).toBe('inc-001');
    expect((nodeWrite!.data.metadata as any).workerUid).toBe('u-7');

    expect(edgeWrite!.data.fromNodeId).toBe('incident-inc-001-postmortem');
    expect(edgeWrite!.data.toNodeId).toBe('norma-DS-594');
    expect(edgeWrite!.data.label).toBe('derives_from_norm');

    expect(auditWrite!.data.action).toBe('zettelkasten.incident_postmortem_written');
  });

  it('Test 2: incident closed without rootCause → skip silent', async () => {
    const { store, writes } = makeFakeStore();
    const genEmbedding = vi.fn(async () => [0.1]);

    const res = await writeIncidentPostmortemNode(
      { ...baseIncident, rootCause: '' },
      { store, genEmbedding },
    );

    expect(res.ok).toBe(false);
    expect((res as { ok: false; reason: string }).reason).toBe('precondition_not_met');
    expect(genEmbedding).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('Test 3: embedding throws → no rompe path, error logged + captured', async () => {
    const { store, writes } = makeFakeStore();
    const captureError = vi.fn();
    const logger = { warn: vi.fn(), info: vi.fn() };
    const genEmbedding = vi.fn(async () => {
      throw new Error('gemini_quota_exceeded');
    });

    const res = await writeIncidentPostmortemNode(baseIncident, {
      store,
      genEmbedding,
      captureError,
      logger,
    });

    expect(res.ok).toBe(false);
    expect((res as { ok: false; reason: string }).reason).toBe('embedding_failed');
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][1]).toMatchObject({
      module: 'zettelkasten',
      action: 'incident_postmortem_embedding',
      incidentId: 'inc-001',
    });
    expect(logger.warn).toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('Test 3b: embedding returns empty array → treated as failure', async () => {
    const { store, writes } = makeFakeStore();
    const captureError = vi.fn();
    const genEmbedding = vi.fn(async () => []);

    const res = await writeIncidentPostmortemNode(baseIncident, {
      store,
      genEmbedding,
      captureError,
      logger: { warn: vi.fn(), info: vi.fn() },
    });

    expect(res.ok).toBe(false);
    expect((res as { ok: false; reason: string }).reason).toBe('embedding_failed');
    expect(writes).toHaveLength(0);
  });

  it('Test 4: ragSearch returns no normativa match → fallback anchor (DS-594)', async () => {
    const { store, writes } = makeFakeStore();
    const genEmbedding = vi.fn(async () => [0.5]);
    const ragSearch = vi.fn(async () => []); // no hits

    const res = await writeIncidentPostmortemNode(
      { ...baseIncident, type: 'totally-unknown-type' },
      { store, genEmbedding, ragSearch },
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.anchorNodeId).toBe('norma-DS-594');
    expect(ragSearch).toHaveBeenCalledTimes(1);

    const edgeWrite = writes.find((w) => w.collection === 'tenants/t1/zettelkasten_edges');
    expect(edgeWrite!.data.toNodeId).toBe('norma-DS-594');
  });

  it('Test 4b: ragSearch returns a normativa match → use it as anchor', async () => {
    const { store, writes } = makeFakeStore();
    const genEmbedding = vi.fn(async () => [0.5]);
    const ragSearch = vi.fn(async () => [
      { id: 'norma-Ley-16744', citation: 'Ley 16.744', source: 'BCN' },
    ]);

    const res = await writeIncidentPostmortemNode(baseIncident, {
      store,
      genEmbedding,
      ragSearch,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.anchorNodeId).toBe('norma-Ley-16744');

    const edgeWrite = writes.find((w) => w.collection === 'tenants/t1/zettelkasten_edges');
    expect(edgeWrite!.data.toNodeId).toBe('norma-Ley-16744');
  });

  it('Test 4c: ragSearch throws → falls back to type-based anchor without breaking', async () => {
    const { store, writes } = makeFakeStore();
    const genEmbedding = vi.fn(async () => [0.5]);
    const ragSearch = vi.fn(async () => {
      throw new Error('rag_index_unavailable');
    });
    const captureError = vi.fn();

    const res = await writeIncidentPostmortemNode(baseIncident, {
      store,
      genEmbedding,
      ragSearch,
      captureError,
      logger: { warn: vi.fn(), info: vi.fn() },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.anchorNodeId).toBe('norma-DS-594'); // type fallback for fall-from-height
    expect(captureError).toHaveBeenCalled(); // ragSearch error captured
    expect(writes.length).toBeGreaterThan(0);
  });

  it('Test 5: store write failure → captureError called, returns store_write_failed', async () => {
    const { store } = makeFakeStore({ failOn: 'nodes' });
    const captureError = vi.fn();
    const genEmbedding = vi.fn(async () => [0.5]);

    const res = await writeIncidentPostmortemNode(baseIncident, {
      store,
      genEmbedding,
      captureError,
      logger: { warn: vi.fn(), info: vi.fn() },
    });

    expect(res.ok).toBe(false);
    expect((res as { ok: false; reason: string }).reason).toBe('store_write_failed');
    expect(captureError).toHaveBeenCalled();
    expect(captureError.mock.calls[0][1]).toMatchObject({
      action: 'incident_postmortem_write',
    });
  });
});
