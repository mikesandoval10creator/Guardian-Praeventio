// Tests §12.5.1 split step 4 — gemini/embeddings.ts.
//
// Cobertura PURE LOGIC: cosineSimilarity (totalmente determinístico).
// Las funciones AI (generateEmbeddingsBatch, autoConnectNodes,
// semanticSearch) requieren mock del SDK; cubrimos los paths sin
// API_KEY + lista vacía que no llaman al SDK.

import { describe, it, expect } from 'vitest';
import { cosineSimilarity, semanticSearch } from './embeddings';
import type { RiskNode } from '../../types';

describe('cosineSimilarity', () => {
  it('vectores idénticos → 1', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it('vectores opuestos → -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it('vectores ortogonales → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('vector zero → 0 (sentinela, no NaN)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('tamaños distintos → 0 (sentinela)', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('vacíos → 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([], [1, 2])).toBe(0);
  });

  it('normalización: magnitudes distintas, mismo dirección → 1', () => {
    expect(cosineSimilarity([2, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([10, 0, 0], [0.5, 0, 0])).toBeCloseTo(1, 5);
  });

  it('similarity intermedia', () => {
    // [1,1,0] vs [1,0,0] = cos 45° = √2/2 ≈ 0.707
    expect(cosineSimilarity([1, 1, 0], [1, 0, 0])).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('determinismo: mismo input → mismo output', () => {
    const a = [0.1, 0.2, 0.3, 0.4];
    const b = [0.4, 0.3, 0.2, 0.1];
    expect(cosineSimilarity(a, b)).toBe(cosineSimilarity(a, b));
  });
});

describe('semanticSearch — paths sin SDK', () => {
  const nodes: Partial<RiskNode>[] = [
    { id: 'n-1', title: 'Riesgo eléctrico' },
    { id: 'n-2', title: 'Riesgo química' },
    { id: 'n-3', title: 'Riesgo mecánico' },
  ];

  it('sin API_KEY → devuelve top-K de candidates sin llamar SDK', async () => {
    // En tests no hay GEMINI_API_KEY → cae al fast path.
    const result = await semanticSearch('riesgo', nodes, 2);
    expect(result).toHaveLength(2);
  });

  it('candidates vacíos (post filter projectId) → []', async () => {
    const filtered: Partial<RiskNode>[] = [];
    const result = await semanticSearch('query', filtered, 5);
    expect(result).toEqual([]);
  });

  it('filtra por projectId antes de búsqueda', async () => {
    const scoped: Partial<RiskNode>[] = [
      { id: 'a', projectId: 'p-1' } as Partial<RiskNode> & { projectId: string },
      { id: 'b', projectId: 'p-2' } as Partial<RiskNode> & { projectId: string },
      { id: 'c', projectId: 'p-1' } as Partial<RiskNode> & { projectId: string },
    ];
    const result = await semanticSearch('q', scoped, 10, 'p-1');
    expect(result.map((n) => n.id).sort()).toEqual(['a', 'c']);
  });

  it('topK respetado en el fast path', async () => {
    const big: Partial<RiskNode>[] = Array.from({ length: 20 }, (_, i) => ({
      id: `n-${i}`,
    }));
    const result = await semanticSearch('q', big, 5);
    expect(result).toHaveLength(5);
  });
});
