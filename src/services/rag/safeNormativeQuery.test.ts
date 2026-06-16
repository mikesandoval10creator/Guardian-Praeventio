// Praeventio Guard — safeNormativeQuery unit tests.
//
// El test cubre los 5 paths críticos:
//   1. Query demasiado corta → reason: 'query_too_short'
//   2. RAG no inicializado → reason: 'rag_not_ready'
//   3. Embedding falla → reason: 'embedding_failed'
//   4. Score < 0.75 → reason: 'no_verified_match'
//   5. Score ≥ 0.75 → ok: true con snippet

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  safeNormativeQuery,
  safeNormativeContextOrFallback,
  __setSafeNormativeDepsForTests,
  __resetSafeNormativeDepsForTests,
  MIN_SIMILARITY,
} from './safeNormativeQuery';

// Mock Firestore vector findNearest. Distance COSINE en [0,2] →
// similarity = 1 - distance/2.
function makeMockDocs(
  items: Array<{ title: string; content: string; distance: number; nodeId?: string; lawId?: string }>,
) {
  return items.map((item) => ({
    data: () => ({
      title: item.title,
      content: item.content,
      distance: item.distance,
      // Normative law vectors carry `lawId` (default); per-project node vectors
      // carry `nodeId` instead — the legal RAG must drop the latter.
      ...(item.nodeId !== undefined
        ? { nodeId: item.nodeId }
        : { lawId: item.lawId ?? 'L1' }),
    }),
  }));
}

function makeMockFirestore(docs: ReturnType<typeof makeMockDocs>) {
  return () =>
    ({
      collection: () => ({
        findNearest: () => ({
          get: async () => ({
            empty: docs.length === 0,
            docs,
          }),
        }),
      }),
    }) as never;
}

const fakeEmbedding = async (_: string) => new Array(768).fill(0);

describe('safeNormativeQuery', () => {
  beforeEach(() => __resetSafeNormativeDepsForTests());
  afterEach(() => __resetSafeNormativeDepsForTests());

  it('rechaza queries demasiado cortas', async () => {
    const r = await safeNormativeQuery('ab');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('query_too_short');
    expect(r.userMessage).toContain('breve');
  });

  it('rechaza cuando el RAG no está inicializado', async () => {
    __setSafeNormativeDepsForTests({
      isRagInitialized: () => false,
      generateEmbedding: fakeEmbedding,
      firestore: makeMockFirestore([]),
    });
    const r = await safeNormativeQuery('DS 594 ruido');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('rag_not_ready');
    expect(r.userMessage).toContain('no está disponible');
  });

  it('fallback cuando embedding falla', async () => {
    __setSafeNormativeDepsForTests({
      isRagInitialized: () => true,
      generateEmbedding: async () => {
        throw new Error('embedding service down');
      },
      firestore: makeMockFirestore([]),
    });
    const r = await safeNormativeQuery('Ley 16744 accidentes');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('embedding_failed');
    expect(r.userMessage).toMatch(/no tengo información verificada/i);
  });

  it('reporta no_verified_match cuando todos los scores < MIN_SIMILARITY', async () => {
    // distance 1.0 → similarity 0.5 (< 0.75)
    __setSafeNormativeDepsForTests({
      isRagInitialized: () => true,
      generateEmbedding: fakeEmbedding,
      firestore: makeMockFirestore(
        makeMockDocs([
          { title: 'DS 594 art. 70', content: 'ruido', distance: 1.0 },
          { title: 'Ley 16.744', content: 'accidentes', distance: 1.2 },
        ]),
      ),
    });
    const r = await safeNormativeQuery('DS 594 ruido');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_verified_match');
    expect(r.bestScore).toBeCloseTo(0.5, 1);
    expect(r.userMessage).toMatch(/leychile\.cl/);
    expect(r.matches).toHaveLength(2);
  });

  it('returns snippet cuando hay match con score ≥ MIN_SIMILARITY', async () => {
    // distance 0.4 → similarity 0.8 (≥ 0.75)
    __setSafeNormativeDepsForTests({
      isRagInitialized: () => true,
      generateEmbedding: fakeEmbedding,
      firestore: makeMockFirestore(
        makeMockDocs([
          {
            title: 'DS 594/1999 art. 70',
            content:
              'Los límites permisibles ponderados (LPP) para ruido continuo son 85 dB(A) para 8 horas de exposición ocupacional.',
            distance: 0.4,
          },
          { title: 'DS 594 art. 71', content: 'irrelevante', distance: 1.5 },
        ]),
      ),
    });
    const r = await safeNormativeQuery('límite ruido ocupacional DS 594');
    expect(r.ok).toBe(true);
    expect(r.snippet).toBeDefined();
    expect(r.snippet).toContain('DS 594/1999 art. 70');
    expect(r.snippet).toContain('similarity=0.80');
    // Solo el primer match supera el umbral; debe estar incluido.
    expect(r.snippet).not.toContain('irrelevante');
    expect(r.bestScore).toBeCloseTo(0.8, 1);
  });

  it('umbral conservador: distance 0.5 → similarity 0.75 PASA exacto', async () => {
    __setSafeNormativeDepsForTests({
      isRagInitialized: () => true,
      generateEmbedding: fakeEmbedding,
      firestore: makeMockFirestore(
        makeMockDocs([{ title: 'edge', content: 'test', distance: 0.5 }]),
      ),
    });
    const r = await safeNormativeQuery('edge case query');
    expect(r.ok).toBe(true);
    expect(r.bestScore).toBeCloseTo(MIN_SIMILARITY, 2);
  });

  it('vector store vacío → no_verified_match', async () => {
    __setSafeNormativeDepsForTests({
      isRagInitialized: () => true,
      generateEmbedding: fakeEmbedding,
      firestore: makeMockFirestore([]),
    });
    const r = await safeNormativeQuery('cualquier query válida');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_verified_match');
    expect(r.matches).toEqual([]);
  });

  it('cross-tenant: drops per-project node vectors, returns ONLY public law', async () => {
    __setSafeNormativeDepsForTests({
      isRagInitialized: () => true,
      generateEmbedding: fakeEmbedding,
      // A private node from ANOTHER project is the NEAREST hit (distance 0.0)
      // but must be dropped; the law vector (distance 0.4 → score 0.8) is what
      // the legal RAG returns. No cross-tenant PII may reach the prompt.
      firestore: makeMockFirestore(
        makeMockDocs([
          { title: 'OTRO-TENANT incidente', content: 'PII privada de otro proyecto', distance: 0.0, nodeId: 'node-x' },
          { title: 'DS 594', content: 'límite de ruido 85 dB', distance: 0.4 },
        ]),
      ),
    });
    const r = await safeNormativeQuery('límite ruido ocupacional DS 594');
    expect(r.ok).toBe(true);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('OTRO-TENANT');
    expect(serialized).not.toContain('PII privada');
    expect(r.matches?.[0]?.title).toBe('DS 594');
  });
});

describe('safeNormativeContextOrFallback', () => {
  beforeEach(() => __resetSafeNormativeDepsForTests());
  afterEach(() => __resetSafeNormativeDepsForTests());

  it('devuelve { verified: true } cuando hay match seguro', async () => {
    __setSafeNormativeDepsForTests({
      isRagInitialized: () => true,
      generateEmbedding: fakeEmbedding,
      firestore: makeMockFirestore(
        makeMockDocs([
          {
            title: 'DS 594',
            content: 'ruido 85 dB(A) límite ocupacional',
            distance: 0.3,
          },
        ]),
      ),
    });
    const r = await safeNormativeContextOrFallback('DS 594 límite ruido');
    expect(r.verified).toBe(true);
    expect(r.injectable).toContain('DS 594');
  });

  it('devuelve { verified: false } con mensaje canónico en fallback', async () => {
    __setSafeNormativeDepsForTests({
      isRagInitialized: () => false,
    });
    const r = await safeNormativeContextOrFallback('DS 594 algo');
    expect(r.verified).toBe(false);
    expect(r.injectable).toContain('RAG no está disponible');
  });

  it('NUNCA retorna texto normativo hardcoded como Ley 16.744 fallback', async () => {
    // Importante: la searchRelevantContext antigua tenía hardcoded
    // "Contexto legal: Ley 16.744 sobre accidentes..." como fallback.
    // safeNormativeQuery NO debe replicar ese anti-pattern.
    __setSafeNormativeDepsForTests({
      isRagInitialized: () => false,
    });
    const r = await safeNormativeContextOrFallback('algo');
    expect(r.injectable).not.toMatch(/Ley 16\.744 sobre accidentes/);
    expect(r.injectable).not.toMatch(/^Contexto legal: Ley/);
  });
});
