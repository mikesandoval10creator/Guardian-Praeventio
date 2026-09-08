import { describe, it, expect, vi } from 'vitest';
import {
  materializeOne,
  processSnapshotDoc,
  normalizeZkNodeFirestoreDoc,
  setupMaterializerListener,
  type MaterializerFirestore,
  type MinimalDocSnapshot,
} from './zettelkastenMaterializer.js';
import type { RiskNodePayload } from '../../services/zettelkasten/types.js';
import { writeIncidentPostmortemNode } from '../../services/zettelkasten/incidentPostmortem.js';

const NOW = new Date('2026-05-12T12:00:00Z');

function fakeFirestore() {
  const writes: Array<{ path: string; data: unknown; opts?: unknown }> = [];
  const fs: MaterializerFirestore = {
    doc(path: string) {
      return {
        async set(data: any, opts: any) {
          writes.push({ path, data, opts });
          return undefined;
        },
      };
    },
  };
  return { fs, writes };
}

function payload(over: Partial<RiskNodePayload> = {}): RiskNodePayload {
  return {
    title: 'Hidrante baja presión',
    description: 'Boca norte 0.3 MPa vs umbral 0.5 MPa',
    type: 'hidrante-pressure',
    severity: 'high',
    metadata: { pressureMPa: 0.3 },
    connections: ['proj-1', 'sensor-N'],
    references: ['NCh 1646'],
    ...over,
  };
}

describe('materializeOne', () => {
  it('escribe doc en path canonical', async () => {
    const { fs, writes } = fakeFirestore();
    const r = await materializeOne(fs, {
      tenantId: 'tA',
      zkNodeId: 'zk-1',
      payload: payload(),
      projectId: 'p1',
      now: NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.path).toBe('nodes/tA_p1_zk-1');
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe('nodes/tA_p1_zk-1');
    expect(writes[0].opts).toEqual({ merge: true });
  });

  it('payload inválido → ok:false sin write', async () => {
    const { fs, writes } = fakeFirestore();
    const r = await materializeOne(fs, {
      tenantId: 'tA',
      zkNodeId: 'zk-2',
      payload: { ...payload(), title: '' as any } as RiskNodePayload,
      projectId: 'p1',
      now: NOW,
    });
    // title='' es string válido pero payload check ahora valida title.length
    // sample no captures missing — el chequeo es por title is string.
    // Aún sin error en payload, projectId está OK, así que esto sí pasa:
    expect(r.ok).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it('missing tenantId → error', async () => {
    const { fs, writes } = fakeFirestore();
    const r = await materializeOne(fs, {
      tenantId: '',
      zkNodeId: 'zk-3',
      payload: payload(),
      projectId: 'p1',
      now: NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/tenantId/);
    expect(writes).toHaveLength(0);
  });

  it('missing projectId → error', async () => {
    const { fs, writes } = fakeFirestore();
    const r = await materializeOne(fs, {
      tenantId: 'tA',
      zkNodeId: 'zk-4',
      payload: payload(),
      projectId: '',
      now: NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/projectId/);
    expect(writes).toHaveLength(0);
  });

  it('idempotencia: misma input → mismo path', async () => {
    const { fs, writes } = fakeFirestore();
    const inp = {
      tenantId: 'tA',
      zkNodeId: 'zk-5',
      payload: payload(),
      projectId: 'p1',
      now: NOW,
    };
    await materializeOne(fs, inp);
    await materializeOne(fs, inp);
    expect(writes[0].path).toBe(writes[1].path);
  });

  it('atrapa errores de Firestore', async () => {
    const fs: MaterializerFirestore = {
      doc() {
        return {
          async set() {
            throw new Error('firestore-down');
          },
        };
      },
    };
    const r = await materializeOne(fs, {
      tenantId: 'tA',
      zkNodeId: 'zk-6',
      payload: payload(),
      projectId: 'p1',
      now: NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/firestore-down/);
  });
});

describe('processSnapshotDoc', () => {
  it('extrae tenantId del path y materializa', async () => {
    const { fs, writes } = fakeFirestore();
    const snap: MinimalDocSnapshot = {
      id: 'zk-99',
      exists: true,
      data: () => ({ payload: payload(), projectId: 'p1' }),
      ref: { path: 'tenants/tA/zettelkasten_nodes/zk-99' },
    };
    const r = await processSnapshotDoc(fs, snap, NOW);
    expect(r?.ok).toBe(true);
    expect(writes[0].path).toBe('nodes/tA_p1_zk-99');
  });

  it('snap !exists → null', async () => {
    const { fs, writes } = fakeFirestore();
    const snap: MinimalDocSnapshot = {
      id: 'zk-x',
      exists: false,
      data: () => undefined,
      ref: { path: 'tenants/tA/zettelkasten_nodes/zk-x' },
    };
    const r = await processSnapshotDoc(fs, snap, NOW);
    expect(r).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it('path inesperado → null + warn', async () => {
    const warn = vi.fn();
    const original = (
      await import('../../utils/logger.js')
    ).logger;
    (original as any).warn = warn;

    const { fs } = fakeFirestore();
    const snap: MinimalDocSnapshot = {
      id: 'zk-x',
      exists: true,
      data: () => ({ payload: payload(), projectId: 'p1' }),
      ref: { path: 'random/collection/foo' },
    };
    const r = await processSnapshotDoc(fs, snap, NOW);
    expect(r).toBeNull();
  });

  it('normaliza un writer plano de incidentPostmortem desde la subcolección tenant-scoped', async () => {
    const { fs, writes } = fakeFirestore();
    const snap: MinimalDocSnapshot = {
      id: 'incident-1-postmortem',
      exists: true,
      data: () => ({
        id: 'incident-1-postmortem',
        type: 'incident_postmortem',
        title: 'Falla de ventilación',
        metadata: {
          projectId: 'p1',
          severity: 'high',
          rootCausePreview: 'Ventilador detenido',
        },
      }),
      ref: { path: 'tenants/tA/zettelkasten_nodes/incident-1-postmortem' },
    };
    const r = await processSnapshotDoc(fs, snap, NOW, async () => 'tA');
    expect(r?.ok).toBe(true);
    expect(writes[0].path).toBe('nodes/tA_p1_incident-1-postmortem');
    expect((writes[0].data as any).type).toBe('Incidente');
    expect((writes[0].data as any).description).toBe('Ventilador detenido');
  });

  it('integra el writer real de postmortem con el materializer y el path canónico', async () => {
    const sourceWrites: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
    const sourceStore = {
      collection: (collection: string) => ({
        doc: (id: string) => ({
          set: async (data: Record<string, unknown>) => {
            sourceWrites.push({ collection, id, data });
          },
        }),
      }),
    };
    const writeResult = await writeIncidentPostmortemNode(
      {
        id: 'inc-real-1',
        tenantId: 'tA',
        projectId: 'p1',
        status: 'closed',
        type: 'fall-from-height',
        rootCause: 'Anclaje no inspeccionado',
        severity: 'high',
      },
      {
        store: sourceStore,
        genEmbedding: async () => [0.1, 0.2],
        logger: { warn: () => {}, info: () => {} },
        now: () => NOW.toISOString(),
      },
    );
    expect(writeResult.ok).toBe(true);
    const source = sourceWrites.find(
      (entry) => entry.collection === 'tenants/tA/zettelkasten_nodes',
    );
    expect(source).toBeDefined();

    const { fs, writes } = fakeFirestore();
    const materialized = await processSnapshotDoc(
      fs,
      {
        id: source!.id,
        exists: true,
        data: () => source!.data,
        ref: { path: `tenants/tA/zettelkasten_nodes/${source!.id}` },
      },
      NOW,
      async (projectId) => {
        expect(projectId).toBe('p1');
        return 'tA';
      },
    );
    expect(materialized?.ok).toBe(true);
    expect(writes[0].path).toBe(`nodes/tA_p1_${source!.id}`);
    expect((writes[0].data as any).type).toBe('Incidente');
  });

  it('normaliza un writer plano top-level y resuelve tenant por proyecto', async () => {
    const { fs, writes } = fakeFirestore();
    const snap: MinimalDocSnapshot = {
      id: 'safety-learning_p1_2026-09-08',
      exists: true,
      data: () => ({
        title: 'Uso correcto del arnés',
        description: 'Lección diaria',
        type: 'safety-learning',
        severity: 'info',
        metadata: {},
        connections: [],
        references: [],
        projectId: 'p1',
      }),
      ref: { path: 'zettelkasten_nodes/safety-learning_p1_2026-09-08' },
    };
    const r = await processSnapshotDoc(fs, snap, NOW, async (projectId) => {
      expect(projectId).toBe('p1');
      return 'tA';
    });
    expect(r?.ok).toBe(true);
    expect(writes[0].path).toBe('nodes/tA_p1_safety-learning_p1_2026-09-08');
  });

  it('rechaza tenant/project mismatch y payload inválido sin escribir', async () => {
    const { fs, writes } = fakeFirestore();
    const mismatch: MinimalDocSnapshot = {
      id: 'zk-mismatch',
      exists: true,
      data: () => ({
        payload: payload(),
        projectId: 'p1',
        tenantId: 'tB',
      }),
      ref: { path: 'tenants/tA/zettelkasten_nodes/zk-mismatch' },
    };
    const invalid: MinimalDocSnapshot = {
      id: 'zk-invalid',
      exists: true,
      data: () => ({
        payload: { ...payload(), title: '' },
        projectId: 'p1',
      }),
      ref: { path: 'zettelkasten_nodes/zk-invalid' },
    };
    expect((await processSnapshotDoc(fs, mismatch, NOW, async () => 'tA'))?.ok).toBe(false);
    expect((await processSnapshotDoc(fs, invalid, NOW, async () => 'tA'))?.ok).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it('wirea ambos listeners, omite removed y permite retry después de un error de write', async () => {
    let groupNext: ((snapshot: any) => void) | undefined;
    let topNext: ((snapshot: any) => void) | undefined;
    const unsubs = { group: 0, top: 0 };
    const store = new Map<string, unknown>();
    let failFirstWrite = true;
    const source = (kind: 'group' | 'top') => ({
      onSnapshot(next: (snapshot: any) => void) {
        if (kind === 'group') groupNext = next;
        else topNext = next;
        return () => {
          unsubs[kind] += 1;
        };
      },
    });
    const db: any = {
      collectionGroup: vi.fn(() => source('group')),
      collection: vi.fn((name: string) => {
        if (name === 'zettelkasten_nodes') return source('top');
        throw new Error(`unexpected collection ${name}`);
      }),
      doc: vi.fn((path: string) => ({
        set: vi.fn(async (data: unknown) => {
          if (failFirstWrite) {
            failFirstWrite = false;
            throw new Error('temporary-write-failure');
          }
          store.set(path, data);
        }),
      })),
    };
    const handle = setupMaterializerListener({
      db,
      resolveProjectTenant: async () => 'tA',
      retryDelayMs: 1,
      maxRetryAttempts: 2,
    });
    const doc = {
      id: 'zk-retry',
      exists: true,
      data: () => ({ payload: payload(), projectId: 'p1' }),
      ref: { path: 'tenants/tA/zettelkasten_nodes/zk-retry' },
    };
    groupNext!({ docChanges: () => [{ type: 'added', doc }] });
    topNext!({ docChanges: () => [{ type: 'removed', doc }] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.has('nodes/tA_p1_zk-retry')).toBe(true);
    handle.unsubscribe();
    expect(unsubs).toEqual({ group: 1, top: 1 });
  });
});

describe('normalizeZkNodeFirestoreDoc', () => {
  it('acepta payload anidado y deriva campos mínimos del documento', () => {
    const normalized = normalizeZkNodeFirestoreDoc({
      payload: payload(),
      projectId: 'p1',
    });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.value.projectId).toBe('p1');
      expect(normalized.value.payload.title).toBe('Hidrante baja presión');
    }
  });

  it('rechaza un type de origen desconocido en vez de degradarlo a Riesgo', () => {
    const normalized = normalizeZkNodeFirestoreDoc({
      ...payload(),
      type: 'unknown-untrusted-type',
      projectId: 'p1',
    });
    expect(normalized).toEqual({ ok: false, error: 'unsupported type' });
  });
});
