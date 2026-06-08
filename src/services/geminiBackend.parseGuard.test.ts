// Tests — generatePredictiveForecast now routes its Gemini body through the
// hardened `parseGeminiJson` contract (PR fix/gemini-parse-hardening).
//
// geminiBackend.ts captures GEMINI_API_KEY at import time and parses a real
// Gemini `generateContent` response. We set the key and mock @google/genai
// (the SDK boundary) BEFORE importing the module, then drive the real exported
// function against controlled upstream bodies:
//   - empty completion (safety-blocked / non-STOP) → throws gemini_empty_response
//   - malformed JSON                                → throws SyntaxError
// The /api/gemini dispatcher maps both to a typed 502 (see _geminiErrors.ts).
// Previously the naked `JSON.parse(response.text || '{}')` silently coerced an
// empty body to `{}` and threw an unattributable SyntaxError on garbage.

import { describe, it, expect, vi, beforeAll } from 'vitest';

process.env.GEMINI_API_KEY = 'test-key';

let upstreamText: string | undefined;

const generateContent = vi.fn(async () => ({ text: upstreamText }));

vi.mock('@google/genai', () => {
  function GoogleGenAI() {
    return { models: { generateContent } };
  }
  return {
    GoogleGenAI,
    Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
    Modality: { TEXT: 'TEXT', IMAGE: 'IMAGE' },
  };
});

let generatePredictiveForecast: typeof import('./geminiBackend').generatePredictiveForecast;

beforeAll(async () => {
  ({ generatePredictiveForecast } = await import('./geminiBackend'));
});

describe('generatePredictiveForecast — parseGeminiJson hardening', () => {
  it('empty Gemini body → throws gemini_empty_response (not a silent {})', async () => {
    upstreamText = undefined;
    await expect(generatePredictiveForecast('Proyecto', 'ctx')).rejects.toThrow(
      'gemini_empty_response',
    );
  });

  it('malformed Gemini body → throws SyntaxError (typed 502 path, not a crash)', async () => {
    upstreamText = 'not-json-at-all }';
    await expect(generatePredictiveForecast('Proyecto', 'ctx')).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });

  it('happy path → returns the parsed object unchanged', async () => {
    const payload = {
      riskLevel: 'Medio',
      score: 50,
      topRisks: [],
      recommendations: ['Hidratación'],
      empatheticActions: ['Pausas'],
      aiInsight: 'ok',
    };
    upstreamText = JSON.stringify(payload);
    await expect(generatePredictiveForecast('Proyecto', 'ctx')).resolves.toEqual(payload);
  });
});
