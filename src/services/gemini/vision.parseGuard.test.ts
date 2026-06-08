// Tests — analyzeBioImage now routes its Gemini body through the hardened
// `parseGeminiJson` contract (PR fix/gemini-parse-hardening).
//
// vision.ts captures GEMINI_API_KEY at import time and parses a real Gemini
// `generateContent` response. We set the key and mock @google/genai BEFORE
// importing so we drive the real exported function against controlled bodies:
//   - empty completion → throws gemini_empty_response
//   - malformed JSON   → throws SyntaxError
// Both map to a typed 502 at the /api/gemini dispatcher. Previously the naked
// `JSON.parse(response.text || '{}')` silently coerced empty → {} and surfaced
// an unattributable SyntaxError on garbage.

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
  };
});

let analyzeBioImage: typeof import('./vision').analyzeBioImage;

beforeAll(async () => {
  ({ analyzeBioImage } = await import('./vision'));
});

describe('analyzeBioImage — parseGeminiJson hardening', () => {
  it('empty Gemini body → throws gemini_empty_response (not a silent {})', async () => {
    upstreamText = undefined;
    await expect(analyzeBioImage('AAAA')).rejects.toThrow('gemini_empty_response');
  });

  it('malformed Gemini body → throws SyntaxError (typed 502 path, not a crash)', async () => {
    upstreamText = '{ this is : not json';
    await expect(analyzeBioImage('AAAA')).rejects.toBeInstanceOf(SyntaxError);
  });

  it('happy path → returns the parsed object unchanged', async () => {
    const payload = { epp: 90, detectedEPP: ['Casco'], missingEPP: [], alerts: [] };
    upstreamText = JSON.stringify(payload);
    await expect(analyzeBioImage('AAAA')).resolves.toEqual(payload);
  });
});
