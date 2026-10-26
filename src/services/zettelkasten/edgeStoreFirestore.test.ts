import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';
import { buildEdge } from './edges';
import { buildEdgeStore, EDGE_PATH } from './edgeStoreFirestore';

describe('buildEdgeStore', () => {
  it('replaces stale optional fields on an idempotent upsert', async () => {
    const db = createFakeFirestore();
    const store = buildEdgeStore(db as unknown as Firestore);
    const first = buildEdge({
      fromNodeId: 'risk-1',
      toNodeId: 'control-1',
      type: 'mitigates',
      tenantId: 'tenant-1',
      projectId: 'project-1',
      createdBy: 'system',
      decayFn: 'exp',
      decayHalfLifeMs: 86_400_000,
      validFrom: '2026-01-01T00:00:00.000Z',
    });
    const replacement = { ...first };
    delete replacement.projectId;
    delete replacement.decayHalfLifeMs;
    replacement.decayFn = 'none';

    await store.saveEdge(first);
    await store.saveEdge(replacement);

    const stored = db._dump()[`${EDGE_PATH('tenant-1')}/${first.id}`];
    expect(stored).toMatchObject({
      id: first.id,
      decayFn: 'none',
      tenantId: 'tenant-1',
    });
    expect(stored).not.toHaveProperty('projectId');
    expect(stored).not.toHaveProperty('decayHalfLifeMs');
  });

  it('round-trips every semantic edge field through directional queries', async () => {
    const db = createFakeFirestore();
    const store = buildEdgeStore(db as unknown as Firestore);
    const edge = buildEdge({
      fromNodeId: 'control-1',
      toNodeId: 'risk-1',
      type: 'mitigates',
      tenantId: 'tenant-1',
      projectId: 'project-1',
      createdBy: 'user-1',
      createdAt: '2026-02-03T04:05:06.000Z',
      weight: 0.73,
      validFrom: '2026-02-01T00:00:00.000Z',
      validUntil: '2026-12-31T23:59:59.000Z',
      decayFn: 'exp',
      decayHalfLifeMs: 86_400_000,
    });

    await store.saveEdge(edge);

    await expect(store.findOutgoing(edge.fromNodeId, edge.tenantId)).resolves.toEqual([edge]);
    await expect(store.findIncoming(edge.toNodeId, edge.tenantId)).resolves.toEqual([edge]);
    await expect(
      store.findOutgoing(edge.fromNodeId, edge.tenantId, edge.type),
    ).resolves.toEqual([edge]);
  });

  it('keeps project listing scoped while tenant listing includes legacy edges', async () => {
    const db = createFakeFirestore();
    const store = buildEdgeStore(db as unknown as Firestore);
    const scoped = buildEdge({
      fromNodeId: 'risk-1',
      toNodeId: 'control-1',
      type: 'mitigates',
      tenantId: 'tenant-1',
      projectId: 'project-1',
      createdBy: 'system',
    });
    const legacy = { ...scoped, id: `${scoped.id}-legacy` };
    delete legacy.projectId;

    await store.saveEdge(scoped);
    await store.saveEdge(legacy);

    await expect(store.listByProject?.('tenant-1', 'project-1')).resolves.toEqual([scoped]);
    await expect(store.listByProject?.('tenant-1', 'project-2')).resolves.toEqual([]);
    await expect(store.listByTenant('tenant-1')).resolves.toHaveLength(2);
  });
});
