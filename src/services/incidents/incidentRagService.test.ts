// Sprint 29 Bucket AA F-B — incidentRagService unit tests.
//
// Cubre los tres casos críticos:
//   1. indexIncident escribe en el path tenant-scoped con la forma correcta.
//   2. searchIncidents respeta el scope del tenant (el findNearest se llama
//      sobre incident_vectors/{tenantId}/items y no leakea cross-tenant).
//   3. searchIncidents con query vacío hace skip sin llamar al embedder.

import { describe, it, expect, vi } from 'vitest';
import {
  indexIncident,
  searchIncidents,
  type IncidentRagDeps,
  type MinimalCollection,
  type MinimalDocSnap,
} from './incidentRagService';

function makeFakeFirestore(initial: Record<string, MinimalDocSnap[]> = {}) {
  const writes: Array<{ path: string; id: string; data: Record<string, unknown> }> = [];
  const findNearestCalls: Array<{ path: string; vector: unknown; opts: any }> = [];
  const collections: Record<string, MinimalDocSnap[]> = { ...initial };

  const db = {
    collection(path: string): MinimalCollection {
      return {
        doc(id: string) {
          return {
            async set(data: Record<string, unknown>) {
              writes.push({ path, id, data });
              return undefined;
            },
          };
        },
        findNearest(_field: string, vector: unknown, opts: any) {
          findNearestCalls.push({ path, vector, opts });
          const docs = collections[path] ?? [];
          return {
            async get() {
              return { docs, empty: docs.length === 0 };
            },
          };
        },
      } as unknown as MinimalCollection;
    },
  };
  return { db, writes, findNearestCalls };
}

describe('indexIncident', () => {
  it('persists embedding under incident_vectors/{tenantId}/items/{id} with expected shape', async () => {
    const fake = makeFakeFirestore();
    const embed = vi.fn(async (_t: string) => [0.1, 0.2, 0.3]);
    const deps: IncidentRagDeps = { db: fake.db, embed, now: () => 'fixed-ts' };

    const out = await indexIncident(
      {
        id: 'inc-1',
        tenantId: 'tenant-A',
        projectId: 'proj-1',
        summary: 'Caída en altura sin arnés',
        occurredAt: '2026-04-15',
      },
      deps,
    );

    expect(out.ok).toBe(true);
    expect(embed).toHaveBeenCalledWith('Caída en altura sin arnés');
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].path).toBe('incident_vectors/tenant-A/items');
    expect(fake.writes[0].id).toBe('inc-1');
    expect(fake.writes[0].data).toMatchObject({
      tenantId: 'tenant-A',
      incidentId: 'inc-1',
      projectId: 'proj-1',
      summary: 'Caída en altura sin arnés',
      occurredAt: '2026-04-15',
      embedding: [0.1, 0.2, 0.3],
      indexedAt: 'fixed-ts',
    });
  });

  it('rejects empty summary without embedding', async () => {
    const fake = makeFakeFirestore();
    const embed = vi.fn(async () => [1, 2, 3]);
    const out = await indexIncident(
      { id: 'i', tenantId: 't', projectId: 'p', summary: '' },
      { db: fake.db, embed },
    );
    expect(out.ok).toBe(false);
    expect(embed).not.toHaveBeenCalled();
    expect(fake.writes).toHaveLength(0);
  });
});

describe('searchIncidents — tenant scoping', () => {
  it('uses incident_vectors/{tenantId}/items collection for findNearest', async () => {
    const tenantADocs: MinimalDocSnap[] = [
      {
        id: 'inc-A1',
        data: () => ({
          tenantId: 'tenant-A',
          incidentId: 'inc-A1',
          projectId: 'proj-A',
          summary: 'Tenant A: caída de altura',
          occurredAt: '2026-04-10',
        }),
      },
    ];
    const tenantBDocs: MinimalDocSnap[] = [
      {
        id: 'inc-B1',
        data: () => ({
          tenantId: 'tenant-B',
          incidentId: 'inc-B1',
          projectId: 'proj-B',
          summary: 'Tenant B: derrame',
        }),
      },
    ];
    const fake = makeFakeFirestore({
      'incident_vectors/tenant-A/items': tenantADocs,
      'incident_vectors/tenant-B/items': tenantBDocs,
    });

    const result = await searchIncidents(
      'tenant-A',
      'caída altura',
      3,
      { db: fake.db, embed: async () => [0.5, 0.5] },
    );

    expect(fake.findNearestCalls).toHaveLength(1);
    expect(fake.findNearestCalls[0].path).toBe('incident_vectors/tenant-A/items');
    expect(fake.findNearestCalls[0].opts).toEqual({ limit: 3, distanceMeasure: 'COSINE' });
    expect(result.results.map((r) => r.incidentId)).toEqual(['inc-A1']);
    // Citations include the incident id.
    expect(result.citations[0]).toContain('inc-A1');
  });
});

describe('searchIncidents — empty query skip', () => {
  it('returns empty results without calling embedder when query is empty', async () => {
    const fake = makeFakeFirestore();
    const embed = vi.fn(async () => [1]);
    const result = await searchIncidents('tenant-A', '   ', 5, {
      db: fake.db,
      embed,
    });
    expect(result.results).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
    expect(fake.findNearestCalls).toHaveLength(0);
  });
});
