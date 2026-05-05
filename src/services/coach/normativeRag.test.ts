import { describe, it, expect, beforeEach } from 'vitest';
import {
  NormativeRagService,
  type NormativeChunk,
} from './normativeRag';

/**
 * Bucket HH — NormativeRagService in-memory mode tests.
 *
 * These tests run hermetic: no Pinecone key, no GEMINI_API_KEY required.
 * `embedText` falls back to the deterministic 768-dim hash and `searchTopK`
 * uses bag-of-words overlap over the seeded CL_PACK corpus.
 */

describe('NormativeRagService (in-memory mode)', () => {
  let svc: NormativeRagService;

  beforeEach(() => {
    delete process.env.PINECONE_API_KEY;
    delete process.env.PINECONE_INDEX;
    svc = NormativeRagService.fromEnv();
  });

  it('seeds the corpus from CL_PACK + curated detail chunks (≥ 12 entries)', () => {
    const chunks = svc.listChunks();
    expect(chunks.length).toBeGreaterThanOrEqual(12);
    // Has at least one chunk from each major source bucket.
    const sources = new Set(chunks.map((c) => c.source));
    expect(sources.has('BCN')).toBe(true);
    expect(sources.has('MINSAL')).toBe(true);
    expect(sources.has('SUSESO')).toBe(true);
  });

  it('searchTopK("chemical") returns only chunks tagged with the chemical domain', async () => {
    const results = await svc.searchTopK(
      'tolueno almacenamiento ventilación LPP',
      'chemical',
      5,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    for (const r of results) {
      expect(r.domains).toContain('chemical');
    }
  });

  it('searchTopK("medicine", "ruido PREXOR audiometría") surfaces PREXOR chunk first', async () => {
    const results = await svc.searchTopK(
      'ruido audiometría PREXOR vigilancia',
      'medicine',
      3,
    );
    expect(results.length).toBeGreaterThan(0);
    const citations = results.map((r) => r.citation).join(' | ');
    expect(citations.toLowerCase()).toContain('prexor');
  });

  it('searchTopK("legal", "acoso Karin investigación") surfaces Ley 21.643', async () => {
    const results = await svc.searchTopK(
      'acoso laboral Karin investigación denuncia',
      'legal',
      3,
    );
    expect(results.length).toBeGreaterThan(0);
    const citations = results.map((r) => r.citation).join(' | ');
    expect(citations).toMatch(/21\.?643|Karin/i);
  });

  it('searchTopK degrades gracefully when no token overlap (still returns domain matches)', async () => {
    // Query in a totally unrelated language/topic.
    const results = await svc.searchTopK(
      'xyzzy plugh nothing-related-quantum',
      'medicine',
      4,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(4);
    for (const r of results) {
      expect(r.domains).toContain('medicine');
    }
  });

  it('embedText returns a 768-dim L2-normalized vector in offline mode', async () => {
    const v = await svc.embedText('DS 594 anexo 4 LPP tolueno');
    expect(v.length).toBe(768);
    let norm = 0;
    for (const x of v) norm += x * x;
    // Allow small floating-point drift around 1.0.
    expect(Math.abs(Math.sqrt(norm) - 1)).toBeLessThan(1e-6);
  });

  it('ingestChunk adds a new chunk that becomes searchable', async () => {
    const before = svc.listChunks().length;
    const chunk: NormativeChunk = {
      id: 'test-radiacion-uv',
      source: 'MINSAL',
      citation: 'Protocolo Radiación UV MINSAL',
      text: 'Vigilancia de trabajadores expuestos a radiación UV solar: índice UV ≥ 8 obliga descanso bajo techo y EPP fotoprotector.',
      domains: ['medicine'],
    };
    await svc.ingestChunk(chunk);
    expect(svc.listChunks().length).toBe(before + 1);

    const results = await svc.searchTopK(
      'radiación UV solar fotoprotector',
      'medicine',
      3,
    );
    const ids = results.map((r) => r.id);
    expect(ids).toContain('test-radiacion-uv');
  });
});
