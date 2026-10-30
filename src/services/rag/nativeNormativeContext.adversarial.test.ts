import { describe, expect, it, vi } from 'vitest';
import { createNormativeRetriever, formatNormativeContext, searchPublicLawChunks, type LawChunkRow } from './nativeNormativeContext.js';
const row: LawChunkRow = { id: 'law-1234-chunk-0', data: { lawId: '1234', title: 'DS 594 corpus fixture', content: 'Exposición a ruido ocupacional: texto controlado.' } };

describe('native retrieval adversarial boundary', () => {
  it.each(['nodeId', 'projectId', 'tenantId'])('drops private rows even with canonical law IDs: %s', field => {
    expect(searchPublicLawChunks('ruido ocupacional', [{ ...row, data: { ...row.data, [field]: 'private' } }]).matches).toEqual([]);
  });
  it.each(['node-123', 'law-9999-chunk-0', 'law-1234-chunk-not-a-number'])('rejects inconsistent source identities: %s', id => {
    expect(searchPublicLawChunks('ruido ocupacional', [{ ...row, id }]).matches).toEqual([]);
  });
  it('does not truncate or repair a literal law ID', () => {
    const source = { id: 'law-001234-chunk-0', data: { ...row.data, lawId: '001234' } };
    expect(searchPublicLawChunks('ruido ocupacional', [source]).matches[0].lawId).toBe('001234');
  });
  it('abstains on no match, generic stop words and short input without inventing law', () => {
    for (const query of ['pintura acuática', 'de la ley', 'DS', '']) {
      const result = searchPublicLawChunks(query, [row]);
      expect(result.matches).toEqual([]);
      expect(formatNormativeContext(result)).toContain('No tengo información normativa recuperada');
    }
  });
  it('finds an explicit decree number in the title, not arbitrary numbers in body text', () => {
    const result = searchPublicLawChunks('DS 594', [row, { id: 'law-1235-chunk-0', data: { lawId: '1235', title: 'Otro documento', content: 'Medición de 594 unidades de ruido.' } }]);
    expect(result.matches.map(m => m.id)).toEqual(['law-1234-chunk-0']);
  });
  it('returns bounded candidates and never claims a complete corpus', () => {
    const rows = Array.from({ length: 220 }, (_, i) => ({ ...row, id: `law-1234-chunk-${i}` }));
    const result = searchPublicLawChunks('ruido ocupacional', rows, 100);
    expect(result.scanLimited).toBe(true); expect(result.matches).toHaveLength(5);
    expect(formatNormativeContext(result)).toContain('no representa todo el corpus');
  });
  it('keeps excerpts, source URL and method rather than a semantic confidence score', () => {
    const result = searchPublicLawChunks('ruido ocupacional', [row]);
    expect(JSON.stringify(result)).not.toContain('similarity');
    expect(formatNormativeContext(result)).toContain('no equivale a vigencia');
    expect(result.matches[0].sourceStatus).toBe('indexed-unverified');
    expect(result.matches[0].excerpt).toBe(row.data.content);
  });
  it('rejects oversized noncanonical chunks rather than quoting a prefix without the matched evidence', () => {
    const result = searchPublicLawChunks('ruido ocupacional', [{ ...row,
      data: { ...row.data, content: 'x'.repeat(1400) + ' ruido ocupacional' } }]);
    expect(result.matches).toEqual([]);
  });
  it('uses only the injected read boundary and contains read errors', async () => {
    const read = vi.fn(async () => [row]);
    const retrieve = createNormativeRetriever(read);
    expect((await retrieve('ruido ocupacional')).matches).toHaveLength(1);
    expect(read).toHaveBeenCalledWith(201);
    read.mockRejectedValueOnce(new Error('PRIVATE_INFRA_DETAIL'));
    const failed = await retrieve('ruido ocupacional');
    expect(failed).toMatchObject({ method: 'lexical', matches: [], reason: 'store_unavailable' });
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_INFRA_DETAIL');
  });
});
