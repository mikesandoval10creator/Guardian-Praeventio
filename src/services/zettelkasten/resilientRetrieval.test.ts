import { describe, it, expect, vi } from 'vitest';
import {
  makeSeedAdapter,
  retrieveResilient,
  SEED_NODES,
  type ResilientNode,
  type RetrievalQuery,
  type SourceAdapter,
} from './resilientRetrieval';

function ok(nodes: ResilientNode[]): SourceAdapter {
  return async () => nodes;
}

function nullish(): SourceAdapter {
  return async () => null;
}

function empty(): SourceAdapter {
  return async () => [];
}

function fail(msg = 'boom'): SourceAdapter {
  return async () => {
    throw new Error(msg);
  };
}

const node = (id: string, over: Partial<ResilientNode> = {}): ResilientNode => ({
  id,
  type: 'NORMATIVE',
  label: id,
  ...over,
});

describe('retrieveResilient', () => {
  it('memory primero: stamp __source="memory", NO degraded', async () => {
    const r = await retrieveResilient(
      { keyword: 'sos' },
      { memory: ok([node('n1')]) },
    );
    expect(r.source).toBe('memory');
    expect(r.degraded).toBe(false);
    expect(r.nodes[0]!.__source).toBe('memory');
  });

  it('memory falla → IndexedDB → degraded=true + sourceError', async () => {
    const r = await retrieveResilient(
      { keyword: 'sos' },
      {
        memory: fail('store not hydrated'),
        indexeddb: ok([node('n1')]),
      },
    );
    expect(r.source).toBe('indexeddb');
    expect(r.degraded).toBe(true);
    expect(r.sourceErrors).toHaveLength(1);
    expect(r.sourceErrors[0]!.source).toBe('memory');
    expect(r.sourceErrors[0]!.error).toContain('store not hydrated');
  });

  it('memory + idb fallan → firestore', async () => {
    const r = await retrieveResilient(
      { keyword: 'sos' },
      {
        memory: fail(),
        indexeddb: fail(),
        firestore: ok([node('fs1')]),
      },
    );
    expect(r.source).toBe('firestore');
    expect(r.sourceErrors).toHaveLength(2);
  });

  it('todas fallan → empty result + degraded + source=seed', async () => {
    const r = await retrieveResilient(
      { keyword: 'xxxxx' },
      {
        memory: fail(),
        indexeddb: fail(),
        firestore: fail(),
        seed: empty(),
      },
    );
    expect(r.nodes).toEqual([]);
    expect(r.degraded).toBe(true);
    expect(r.source).toBe('seed');
  });

  it('returned null se trata como fall-through', async () => {
    const r = await retrieveResilient(
      { keyword: 'sos' },
      {
        memory: nullish(),
        indexeddb: ok([node('idb')]),
      },
    );
    expect(r.source).toBe('indexeddb');
    expect(r.sourceErrors[0]!.error).toContain('returned null');
  });

  it('returned [] (empty) se trata como fall-through', async () => {
    const r = await retrieveResilient(
      { keyword: 'sos' },
      {
        memory: empty(),
        indexeddb: ok([node('idb')]),
      },
    );
    expect(r.source).toBe('indexeddb');
    expect(r.sourceErrors[0]!.error).toContain('empty');
  });

  it('source sin adapter se salta limpiamente', async () => {
    const r = await retrieveResilient(
      { keyword: 'sos' },
      { firestore: ok([node('fs')]) }, // memory + idb sin adapter
    );
    expect(r.source).toBe('firestore');
    expect(r.sourceErrors.map((e) => e.error)).toEqual([
      'no adapter',
      'no adapter',
    ]);
  });

  it('timeout cae al siguiente source', async () => {
    const slowMem: SourceAdapter = () =>
      new Promise((res) => setTimeout(() => res([node('m1')]), 5000));
    const r = await retrieveResilient(
      { keyword: 'sos' },
      { memory: slowMem, indexeddb: ok([node('fast')]) },
      { perSourceTimeoutMs: 50 },
    );
    expect(r.source).toBe('indexeddb');
    expect(r.sourceErrors[0]!.error).toContain('timeout');
  });

  it('sourceOrder override', async () => {
    const r = await retrieveResilient(
      { keyword: 'sos' },
      {
        memory: fail(),
        firestore: ok([node('fs')]),
      },
      { sourceOrder: ['firestore', 'memory'] },
    );
    expect(r.source).toBe('firestore');
    expect(r.degraded).toBe(false); // firestore es PRIMERO en el override
  });

  it('mergeAllSources: dedupe por id, prefer primer match', async () => {
    const r = await retrieveResilient(
      { keyword: 'sos' },
      {
        memory: ok([node('a', { label: 'from-mem' })]),
        indexeddb: ok([
          node('a', { label: 'from-idb-stale' }),
          node('b', { label: 'from-idb' }),
        ]),
        firestore: ok([node('c', { label: 'from-fs' })]),
      },
      { mergeAllSources: true },
    );
    expect(r.nodes).toHaveLength(3);
    const byId = new Map(r.nodes.map((n) => [n.id, n]));
    expect(byId.get('a')!.label).toBe('from-mem');
    expect(byId.get('b')!.label).toBe('from-idb');
    expect(byId.get('c')!.label).toBe('from-fs');
    // primary = memory (primera que respondió)
    expect(r.source).toBe('memory');
    expect(r.degraded).toBe(false);
  });

  it('mergeAllSources: primary cuando la primera falla', async () => {
    const r = await retrieveResilient(
      { keyword: 'sos' },
      {
        memory: fail(),
        indexeddb: ok([node('a')]),
        firestore: ok([node('b')]),
      },
      { mergeAllSources: true },
    );
    expect(r.nodes).toHaveLength(2);
    expect(r.source).toBe('indexeddb');
    expect(r.degraded).toBe(true);
  });

  it('seed adapter como último recurso devuelve algo siempre que matchee', async () => {
    const seedAdapter = makeSeedAdapter();
    const r = await retrieveResilient(
      { keyword: 'samu', limit: 5 },
      {
        memory: fail(),
        indexeddb: fail(),
        firestore: fail(),
        seed: seedAdapter,
      },
    );
    expect(r.source).toBe('seed');
    expect(r.nodes.length).toBeGreaterThan(0);
    expect(r.nodes[0]!.id).toContain('samu');
  });

  it('latencyMs incluido', async () => {
    let t = 1000;
    const r = await retrieveResilient(
      { keyword: 'x' },
      { memory: ok([node('n')]) },
      {
        nowMs: () => {
          const v = t;
          t += 5;
          return v;
        },
      },
    );
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('SEED_NODES', () => {
  it('cubre los 3 números emergencia chilenos', () => {
    const samu = SEED_NODES.find((n) => n.id.includes('samu'));
    const bomberos = SEED_NODES.find((n) => n.id.includes('bomberos'));
    const carabineros = SEED_NODES.find((n) => n.id.includes('carabineros'));
    expect(samu).toBeDefined();
    expect(bomberos).toBeDefined();
    expect(carabineros).toBeDefined();
    expect(samu!.tags).toContain('131');
    expect(bomberos!.tags).toContain('132');
    expect(carabineros!.tags).toContain('133');
  });

  it('incluye las 3 normativas core (16.744, DS 594, DS 132)', () => {
    expect(SEED_NODES.find((n) => n.id.includes('16744'))).toBeDefined();
    expect(SEED_NODES.find((n) => n.id.includes('ds-594'))).toBeDefined();
    expect(SEED_NODES.find((n) => n.id.includes('ds-132'))).toBeDefined();
  });

  it('incluye procedimientos básicos (SOS, RCP, evacuación)', () => {
    expect(SEED_NODES.find((n) => n.id.includes('procedure:sos'))).toBeDefined();
    expect(SEED_NODES.find((n) => n.id.includes('rcp'))).toBeDefined();
    expect(SEED_NODES.find((n) => n.id.includes('evacuation'))).toBeDefined();
  });
});

describe('makeSeedAdapter', () => {
  it('filtra por tipo', async () => {
    const adapter = makeSeedAdapter();
    const r = await adapter({ type: 'NORMATIVE' });
    expect(r).not.toBeNull();
    expect(r!.every((n) => n.type === 'NORMATIVE')).toBe(true);
  });

  it('filtra por keyword en searchText (case insensitive)', async () => {
    const adapter = makeSeedAdapter();
    const r = await adapter({ keyword: 'AMBULANCIA' });
    expect(r).not.toBeNull();
    expect(r!.some((n) => n.id.includes('samu'))).toBe(true);
  });

  it('filtra por tags (AND)', async () => {
    const adapter = makeSeedAdapter();
    const r = await adapter({ tags: ['emergency', 'fire'] });
    expect(r).not.toBeNull();
    expect(r!.every((n) => n.tags!.includes('emergency') && n.tags!.includes('fire'))).toBe(
      true,
    );
  });

  it('respeta limit', async () => {
    const adapter = makeSeedAdapter();
    const r = await adapter({ tags: ['chile'], limit: 2 });
    expect(r).not.toBeNull();
    expect(r!.length).toBe(2);
  });

  it('sin matches → null (caller cae fuera del seed)', async () => {
    const adapter = makeSeedAdapter();
    const r = await adapter({ keyword: 'palabra-imposible-zzz' });
    expect(r).toBeNull();
  });

  it('custom seed bundle', async () => {
    const customSeed: ResilientNode[] = [
      { id: 'cust:1', type: 'CUSTOM', label: 'one', searchText: 'foo' },
    ];
    const adapter = makeSeedAdapter(customSeed);
    const r = await adapter({ keyword: 'foo' });
    expect(r).not.toBeNull();
    expect(r![0]!.id).toBe('cust:1');
  });
});
