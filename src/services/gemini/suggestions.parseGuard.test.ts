// Tests — suggestNormativesWithAI now routes its Gemini body through the
// hardened `parseGeminiJson` contract (PR fix/gemini-parse-hardening).
//
// Lives in its own file because suggestions.ts captures GEMINI_API_KEY at
// import time and parses a *real* Gemini `generateContent` response. We set
// the key and mock @google/genai BEFORE importing the module so we exercise
// the real exported function against controlled upstream bodies:
//   - empty completion (safety-blocked / non-STOP) → throws gemini_empty_response
//   - malformed JSON                                → throws SyntaxError
// The /api/gemini dispatcher maps both to a typed 502 (see _geminiErrors.ts).
// Previously the naked `JSON.parse(response.text || '[]')` silently coerced an
// empty body to `[]` and threw an unattributable SyntaxError on garbage.

import { describe, it, expect, vi, beforeAll } from 'vitest';

process.env.GEMINI_API_KEY = 'test-key';

// Mutable holder so each test can stage the upstream `response.text`.
let upstreamText: string | undefined;

const generateContent = vi.fn(async () => ({ text: upstreamText }));

vi.mock('@google/genai', () => {
  function GoogleGenAI() {
    return { models: { generateContent } };
  }
  return {
    GoogleGenAI,
    Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  };
});

let suggestNormativesWithAI: typeof import('./suggestions').suggestNormativesWithAI;

beforeAll(async () => {
  ({ suggestNormativesWithAI } = await import('./suggestions'));
});

describe('suggestNormativesWithAI — parseGeminiJson hardening', () => {
  it('empty Gemini body → throws gemini_empty_response (not a silent [])', async () => {
    upstreamText = undefined;
    await expect(suggestNormativesWithAI('mineria')).rejects.toThrow('gemini_empty_response');
  });

  it('malformed Gemini body → throws SyntaxError (typed 502 path, not a crash)', async () => {
    upstreamText = '<!doctype html> not json';
    await expect(suggestNormativesWithAI('mineria')).rejects.toBeInstanceOf(SyntaxError);
  });

  it('happy path → returns the parsed array unchanged', async () => {
    const payload = [
      { title: 'NCh Example', code: 'NCh-0', description: 'desc', category: 'cat' },
    ];
    upstreamText = JSON.stringify(payload);
    await expect(suggestNormativesWithAI('mineria')).resolves.toEqual(payload);
  });
});
