import { describe, expect, it } from 'vitest';
import { searchPublicLawChunks } from './nativeNormativeContext.js';

describe('native normative retrieval (no inference/embeddings)', () => {
  it('retrieves an actual indexed excerpt and its literal source identity', () => {
    const result = searchPublicLawChunks('ruido ocupacional', [{
      id: 'law-1234-chunk-0', data: { lawId: '1234', title: 'Corpus fixture',
        content: 'Texto de prueba: exposición a ruido ocupacional requiere evaluación.' },
    }]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ id: 'law-1234-chunk-0', lawId: '1234',
      title: 'Corpus fixture', sourceUrl: 'https://www.bcn.cl/leychile/navegar?idNorma=1234' });
    expect(result.method).toBe('lexical');
    expect(result.matches[0].excerpt).toContain('ruido ocupacional');
  });
});
