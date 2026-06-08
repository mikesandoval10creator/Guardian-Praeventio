// Tests — evaluateNormativeImpact maps an unparseable / empty upstream Gemini
// body to a typed throw (gemini_empty_response | SyntaxError) instead of
// silently returning {}. Those throws are what the /api/gemini dispatcher maps
// to HTTP 502 'gemini_bad_response' (src/server/routes/_geminiErrors.ts +
// gemini.ts:573). Pattern mirrors src/services/gemini/emergency.degraded.test.ts:
// set GEMINI_API_KEY and mock @google/genai BEFORE importing the module so the
// module-scope API_KEY const (legalBackend.ts:6) is populated and the real
// network seam is the only thing stubbed.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

process.env.GEMINI_API_KEY = 'test-key';

// Per-test controllable upstream body. Each test sets `nextText` then invokes
// the real backend, which calls the mocked generateContent below.
let nextText: string | undefined;
const generateContentMock = vi.fn(async () => ({ text: nextText }));

vi.mock('@google/genai', () => {
  function GoogleGenAI() {
    return { models: { generateContent: generateContentMock } };
  }
  return {
    GoogleGenAI,
    Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  };
});

let evaluateNormativeImpact: typeof import('./legalBackend').evaluateNormativeImpact;
let auditLegalGap: typeof import('./legalBackend').auditLegalGap;

beforeAll(async () => {
  ({ evaluateNormativeImpact, auditLegalGap } = await import('./legalBackend'));
});

beforeEach(() => {
  generateContentMock.mockClear();
  nextText = undefined;
});

describe('evaluateNormativeImpact — upstream parse hardening (F2)', () => {
  it('malformed Gemini body → throws SyntaxError (dispatcher maps to 502, no crash)', async () => {
    nextText = '{ "procesosAfectados": [  '; // truncated / not valid JSON
    await expect(
      evaluateNormativeImpact('Nueva DS 44/2024', [{ proceso: 'izaje' }]),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it('empty Gemini body → throws gemini_empty_response (NOT a silent {} / 200)', async () => {
    nextText = undefined; // safety-blocked / non-STOP finish / empty completion
    await expect(
      evaluateNormativeImpact('Nueva DS 44/2024', [{ proceso: 'izaje' }]),
    ).rejects.toThrow('gemini_empty_response');
  });

  it('valid Gemini body → resolves and enriches citations (happy path unchanged)', async () => {
    nextText = JSON.stringify({
      procesosAfectados: ['Izaje de cargas'],
      nivelEsfuerzo: 'medio',
      recomendaciones: ['Actualizar PTS'],
      resumen: 'Impacto moderado',
      citations: ['DS 44/2024'],
    });
    const result = await evaluateNormativeImpact('Nueva DS 44/2024', [{ proceso: 'izaje' }]);
    expect(result.procesosAfectados).toEqual(['Izaje de cargas']);
    // RAG-derived citations are unioned in; the model-supplied one survives.
    expect(result.citations).toContain('DS 44/2024');
    expect(Array.isArray(result.citations)).toBe(true);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });
});

// Regression anchor — auditLegalGap already used parseGeminiJson before this PR;
// pin that an empty body there also throws gemini_empty_response so the two
// legal RPCs stay symmetric.
describe('auditLegalGap — already-hardened (regression anchor)', () => {
  it('empty Gemini body → throws gemini_empty_response', async () => {
    nextText = undefined;
    await expect(
      auditLegalGap([{ procedimiento: 'bloqueo' }], [{ norma: 'DS 54' }]),
    ).rejects.toThrow('gemini_empty_response');
  });
});
