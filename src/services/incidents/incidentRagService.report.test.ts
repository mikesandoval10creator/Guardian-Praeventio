// Sprint 33 wire W4 — reportIncident unit tests.
//
// Cubre los invariantes críticos del nuevo entrypoint:
//
//   1. Persistencia en `tenants/{tid}/projects/{pid}/incidents/{id}` con
//      reporterUid SIEMPRE del primer argumento (jamás del payload).
//   2. Auto-generación de incidentId cuando el caller no aporta uno; respeto
//      del id explícito cuando sí lo pasa (idempotencia offline-first).
//   3. XP positivo según tipo:
//        • near_miss → awardXp('near_miss_reported', 10, ctx)
//        • incident  → awardXp('near_miss_reported', 10, ctx) (sigue siendo positivo)
//        • post_mortem → awardXp('incident_post_mortem_completed', 50, ctx)
//   4. Index del embedding para RAG en `incident_vectors/{tid}/items/{id}`.
//   5. Validación de payload (uid vacío, tenant vacío, descripción vacía,
//      tipo/severidad inválidos) → ok: false sin tocar Firestore.
//   6. awardXp throw NO rompe el report (fire-and-forget, xpAwarded: 0).
//   7. Indexing failure NO rompe el report (persist sigue OK, indexed: false).

import { describe, it, expect, vi } from 'vitest';
import {
  reportIncident,
  type ReportIncidentDeps,
  type ReportIncidentInput,
  type MinimalCollection,
  type MinimalDocSnap,
} from './incidentRagService';

interface WriteCapture {
  path: string;
  id: string;
  data: Record<string, unknown>;
}

function makeFakeFirestore(initial: Record<string, MinimalDocSnap[]> = {}) {
  const writes: WriteCapture[] = [];
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

function basePayload(over: Partial<ReportIncidentInput> = {}): ReportIncidentInput {
  return {
    tenantId: 'tenant-A',
    projectId: 'proj-1',
    incidentType: 'near_miss',
    severity: 'med',
    description: 'Caída sin consecuencias en andamio piso 3',
    location: 'Frente 2',
    witnesses: ['uid-w1', 'uid-w2'],
    ts: '2026-05-17T10:00:00.000Z',
    ...over,
  };
}

describe('reportIncident — persistence', () => {
  it('persists under tenants/{tid}/projects/{pid}/incidents/{id} with reporterUid from arg (not body)', async () => {
    const fake = makeFakeFirestore();
    const embed = vi.fn(async () => [0.1, 0.2, 0.3]);
    const awardXp = vi.fn();
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed,
      now: () => 'fixed-ts',
      awardXp,
    };

    const out = await reportIncident(
      'uid-reporter-7',
      basePayload({ id: 'inc-explicit-1' }),
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return; // narrowing
    expect(out.incidentId).toBe('inc-explicit-1');
    expect(out.path).toBe(
      'tenants/tenant-A/projects/proj-1/incidents/inc-explicit-1',
    );

    // El primer write es el incident doc principal.
    const incidentWrite = fake.writes.find(
      (w) => w.path === 'tenants/tenant-A/projects/proj-1/incidents',
    );
    expect(incidentWrite).toBeDefined();
    expect(incidentWrite!.id).toBe('inc-explicit-1');
    expect(incidentWrite!.data).toMatchObject({
      id: 'inc-explicit-1',
      tenantId: 'tenant-A',
      projectId: 'proj-1',
      reporterUid: 'uid-reporter-7', // ← uid del arg, no del body
      incidentType: 'near_miss',
      severity: 'med',
      description: 'Caída sin consecuencias en andamio piso 3',
      location: 'Frente 2',
      witnesses: ['uid-w1', 'uid-w2'],
      ts: '2026-05-17T10:00:00.000Z',
    });
  });

  it('auto-generates incidentId when caller does not provide one', async () => {
    const fake = makeFakeFirestore();
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed: async () => [0.4, 0.5],
      now: () => 'fixed-ts',
    };

    const out = await reportIncident('uid-r', basePayload({ id: undefined }), deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.incidentId).toMatch(/^inc_\d+_[a-z0-9]{6}$/);
  });
});

describe('reportIncident — XP wire', () => {
  it('awards 10 XP via near_miss_reported for incidentType=near_miss', async () => {
    const fake = makeFakeFirestore();
    const awardXp = vi.fn();
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed: async () => [0.1],
      awardXp,
    };

    const out = await reportIncident(
      'uid-r',
      basePayload({ incidentType: 'near_miss', id: 'inc-nm-1' }),
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.xpAwarded).toBe(10);
    expect(awardXp).toHaveBeenCalledWith(
      'near_miss_reported',
      10,
      expect.objectContaining({
        incidentId: 'inc-nm-1',
        tenantId: 'tenant-A',
        projectId: 'proj-1',
        reporterUid: 'uid-r',
        incidentType: 'near_miss',
      }),
    );
  });

  it('awards 10 XP via near_miss_reported for incidentType=incident (positivo-only)', async () => {
    const fake = makeFakeFirestore();
    const awardXp = vi.fn();
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed: async () => [0.1],
      awardXp,
    };

    const out = await reportIncident(
      'uid-r',
      basePayload({ incidentType: 'incident', id: 'inc-i-1' }),
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.xpAwarded).toBe(10);
    expect(awardXp).toHaveBeenCalledWith(
      'near_miss_reported',
      10,
      expect.objectContaining({ incidentType: 'incident' }),
    );
  });

  it('awards 50 XP via incident_post_mortem_completed for incidentType=post_mortem', async () => {
    const fake = makeFakeFirestore();
    const awardXp = vi.fn();
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed: async () => [0.1],
      awardXp,
    };

    const out = await reportIncident(
      'uid-r',
      basePayload({ incidentType: 'post_mortem', id: 'inc-pm-1' }),
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.xpAwarded).toBe(50);
    expect(awardXp).toHaveBeenCalledWith(
      'incident_post_mortem_completed',
      50,
      expect.objectContaining({
        incidentId: 'inc-pm-1',
        reporterUid: 'uid-r',
      }),
    );
  });

  it('survives awardXp throw — xpAwarded becomes 0 but report still ok', async () => {
    const fake = makeFakeFirestore();
    const awardXp = vi.fn(() => {
      throw new Error('xp service down');
    });
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed: async () => [0.1],
      awardXp,
    };

    const out = await reportIncident('uid-r', basePayload({ id: 'inc-xp-fail' }), deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.xpAwarded).toBe(0);
    // El incident write debe haber ocurrido igual.
    const incidentWrite = fake.writes.find(
      (w) => w.path === 'tenants/tenant-A/projects/proj-1/incidents',
    );
    expect(incidentWrite).toBeDefined();
  });
});

describe('reportIncident — RAG index', () => {
  it('indexes the embedding under incident_vectors/{tid}/items/{id}', async () => {
    const fake = makeFakeFirestore();
    const embed = vi.fn(async () => [0.7, 0.8, 0.9]);
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed,
      now: () => 'fixed-ts',
    };

    const out = await reportIncident(
      'uid-r',
      basePayload({ id: 'inc-idx-1', description: 'Quemadura química en bodega' }),
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.indexed).toBe(true);
    expect(embed).toHaveBeenCalledWith('Quemadura química en bodega');

    const vectorWrite = fake.writes.find(
      (w) => w.path === 'incident_vectors/tenant-A/items',
    );
    expect(vectorWrite).toBeDefined();
    expect(vectorWrite!.id).toBe('inc-idx-1');
    expect(vectorWrite!.data).toMatchObject({
      tenantId: 'tenant-A',
      incidentId: 'inc-idx-1',
      projectId: 'proj-1',
      summary: 'Quemadura química en bodega',
      embedding: [0.7, 0.8, 0.9],
    });
  });

  it('keeps report ok even if embedding throws (indexed=false)', async () => {
    const fake = makeFakeFirestore();
    const embed = vi.fn(async () => {
      throw new Error('embedder offline');
    });
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed,
      now: () => 'fixed-ts',
    };

    const out = await reportIncident(
      'uid-r',
      basePayload({ id: 'inc-noembed-1' }),
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.indexed).toBe(false);
    // El incident principal igual se persistió.
    const incidentWrite = fake.writes.find(
      (w) => w.path === 'tenants/tenant-A/projects/proj-1/incidents',
    );
    expect(incidentWrite).toBeDefined();
  });
});

describe('reportIncident — validation', () => {
  it('rejects empty uid without touching Firestore', async () => {
    const fake = makeFakeFirestore();
    const awardXp = vi.fn();
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed: async () => [0.1],
      awardXp,
    };
    const out = await reportIncident('', basePayload(), deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('invalid_uid');
    expect(fake.writes).toHaveLength(0);
    expect(awardXp).not.toHaveBeenCalled();
  });

  it('rejects empty tenantId', async () => {
    const fake = makeFakeFirestore();
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed: async () => [0.1],
    };
    const out = await reportIncident(
      'uid-r',
      basePayload({ tenantId: '' }),
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('invalid_tenant');
    expect(fake.writes).toHaveLength(0);
  });

  it('rejects empty projectId', async () => {
    const fake = makeFakeFirestore();
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed: async () => [0.1],
    };
    const out = await reportIncident(
      'uid-r',
      basePayload({ projectId: '' }),
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('invalid_project');
  });

  it('rejects invalid incidentType', async () => {
    const fake = makeFakeFirestore();
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed: async () => [0.1],
    };
    const out = await reportIncident(
      'uid-r',
      basePayload({ incidentType: 'bogus' as any }),
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('invalid_incident_type');
  });

  it('rejects invalid severity', async () => {
    const fake = makeFakeFirestore();
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed: async () => [0.1],
    };
    const out = await reportIncident(
      'uid-r',
      basePayload({ severity: 'apocalyptic' as any }),
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('invalid_severity');
  });

  it('rejects empty description', async () => {
    const fake = makeFakeFirestore();
    const deps: ReportIncidentDeps = {
      db: fake.db,
      embed: async () => [0.1],
    };
    const out = await reportIncident(
      'uid-r',
      basePayload({ description: '   ' }),
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('empty_description');
  });
});
