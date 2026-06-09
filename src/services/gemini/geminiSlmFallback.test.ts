import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ONLY the Firestore-backed RAG boundary; everything else is real.
const H = vi.hoisted(() => ({ safeQuery: vi.fn() }));
vi.mock('../rag/safeNormativeQuery.js', () => ({
  safeNormativeQuery: (...a: unknown[]) => H.safeQuery(...a),
}));

import {
  geminiSlmFallback,
  hasServerSlmFallback,
  SERVER_SLM_FALLBACK_ACTIONS,
} from './geminiSlmFallback';

beforeEach(() => {
  H.safeQuery.mockReset();
});

describe('geminiSlmFallback — server-side Gemini->degraded ladder', () => {
  it('returns null for an action with no server fallback wired', async () => {
    expect(hasServerSlmFallback('analyzeRiskWithAI')).toBe(false);
    expect(await geminiSlmFallback('analyzeRiskWithAI', [{}])).toBeNull();
  });

  it('only the three representative text actions are wired', () => {
    expect(Object.keys(SERVER_SLM_FALLBACK_ACTIONS).sort()).toEqual(
      ['getChatResponse', 'getSafetyAdvice', 'queryBCN'],
    );
  });

  it('queryBCN: a verified RAG hit becomes the degraded answer (tier=zettelkasten)', async () => {
    H.safeQuery.mockResolvedValue({
      ok: true,
      snippet: '[Fuente: DS 594] Art. 53 ...',
      bestScore: 0.91,
      matches: [{ title: 'DS 594', score: 0.91, preview: 'Art. 53 ...' }],
    });
    const fb = await geminiSlmFallback('queryBCN', ['¿Qué dice el DS 594 sobre ruido?']);
    expect(fb).not.toBeNull();
    expect(fb!.tier).toBe('zettelkasten');
    expect(fb!.text).toContain('DS 594');
    expect(H.safeQuery).toHaveBeenCalledWith('¿Qué dice el DS 594 sobre ruido?', 3);
  });

  it('getSafetyAdvice: RAG miss -> canned EPP answer with disclaimer (tier=canned, no fabrication)', async () => {
    H.safeQuery.mockResolvedValue({ ok: false, reason: 'no_verified_match', matches: [] });
    const fb = await geminiSlmFallback('getSafetyAdvice', [{ temp: 34, uv: 11, airQuality: 'mala' }]);
    expect(fb).not.toBeNull();
    expect(fb!.tier).toBe('canned');
    expect(fb!.text).toContain('[Respuesta de respaldo');
    expect(fb!.text.toLowerCase()).toContain('epp');
  });

  it('getChatResponse: a RAG outage (safeNormativeQuery throws) degrades to canned, never throws', async () => {
    H.safeQuery.mockRejectedValue(new Error('vector_store down'));
    const fb = await geminiSlmFallback('getChatResponse', ['¿Cómo investigo un incidente?', 'ctx']);
    expect(fb).not.toBeNull();
    expect(fb!.tier).toBe('canned');
    expect(fb!.text.length).toBeGreaterThan(0);
  });
});
