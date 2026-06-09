// Tests — geminiBackend.ts Gemini callsites now route their body through the
// hardened `parseGeminiJson` contract (PRs fix/gemini-parse-hardening, #769/#772,
// and fix/gemini-empty-coercion-rest which migrated the last raw-`JSON.parse`
// callsites: enrichNodeData, calculateDynamicEvacuationRoute,
// analyzeFeedPostForRiskNetwork, generateModuleRecommendations,
// generateExecutiveSummary).
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
import { NodeType } from '../types';

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
let analyzeFeedPostForRiskNetwork: typeof import('./geminiBackend').analyzeFeedPostForRiskNetwork;
let generateExecutiveSummary: typeof import('./geminiBackend').generateExecutiveSummary;
let enrichNodeData: typeof import('./geminiBackend').enrichNodeData;
let calculateDynamicEvacuationRoute: typeof import('./geminiBackend').calculateDynamicEvacuationRoute;
let generateModuleRecommendations: typeof import('./geminiBackend').generateModuleRecommendations;

beforeAll(async () => {
  ({
    generatePredictiveForecast,
    analyzeFeedPostForRiskNetwork,
    generateExecutiveSummary,
    enrichNodeData,
    calculateDynamicEvacuationRoute,
    generateModuleRecommendations,
  } = await import('./geminiBackend'));
  // geminiBackend.ts is a heavy module (2.9k LOC + transitive Gemini/RAG deps);
  // its first dynamic import can exceed the default 10s hook budget on a cold
  // machine. Give the import headroom so the suite isn't flaky on slow CI.
}, 30_000);

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

// --- Callsites with NO local catch: the throw propagates to the dispatcher → 502.

describe('analyzeFeedPostForRiskNetwork — parseGeminiJson hardening', () => {
  it('empty Gemini body → throws gemini_empty_response', async () => {
    upstreamText = undefined;
    await expect(
      analyzeFeedPostForRiskNetwork('Casco roto en bodega', null, 'Daho'),
    ).rejects.toThrow('gemini_empty_response');
  });

  it('malformed Gemini body → throws SyntaxError', async () => {
    upstreamText = '{bad';
    await expect(
      analyzeFeedPostForRiskNetwork('Casco roto en bodega', null, 'Daho'),
    ).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe('generateExecutiveSummary — parseGeminiJson hardening', () => {
  it('empty Gemini body → throws gemini_empty_response', async () => {
    upstreamText = undefined;
    await expect(generateExecutiveSummary({}, [])).rejects.toThrow('gemini_empty_response');
  });

  it('malformed Gemini body → throws SyntaxError', async () => {
    upstreamText = '{bad';
    await expect(generateExecutiveSummary({}, [])).rejects.toBeInstanceOf(SyntaxError);
  });
});

// --- Callsites WITH a local catch: the throw fires inside parseGeminiJson and the
// handler degrades to its documented fallback (proving the silent `{}` is gone).

describe('enrichNodeData — parseGeminiJson hardening (degrades to original node)', () => {
  const node = { id: 'n1', title: 'Original', description: 'Desc original', type: NodeType.RISK };

  it('empty Gemini body → returns the original node unchanged (no half-populated {})', async () => {
    upstreamText = undefined;
    const out = await enrichNodeData(node);
    expect(out.title).toBe('Original');
    expect(out.description).toBe('Desc original');
  });

  it('malformed Gemini body → returns the original node unchanged', async () => {
    upstreamText = '{bad';
    const out = await enrichNodeData(node);
    expect(out.title).toBe('Original');
  });
});

describe('calculateDynamicEvacuationRoute — parseGeminiJson hardening (degrades to safe route)', () => {
  it('empty Gemini body → returns the deterministic safe default route, never a {} missing fields', async () => {
    upstreamText = undefined;
    const out = await calculateDynamicEvacuationRoute([], [], [], []);
    expect(out.rutaSegura).toBe('Ruta de Evacuación Predeterminada');
    expect(out.nivelAlerta).toBe('Rojo');
    expect(Array.isArray(out.routePoints)).toBe(true);
  });

  it('malformed Gemini body → still returns the safe default route', async () => {
    upstreamText = '{bad';
    const out = await calculateDynamicEvacuationRoute([], [], [], []);
    expect(out.rutaSegura).toBe('Ruta de Evacuación Predeterminada');
  });
});

describe('generateModuleRecommendations — parseGeminiJson hardening (degrades to null)', () => {
  it('empty Gemini body → returns null (no silent {})', async () => {
    upstreamText = undefined;
    await expect(
      generateModuleRecommendations('IPER', 'Mineria', 'ctx'),
    ).resolves.toBeNull();
  });

  it('malformed Gemini body → returns null', async () => {
    upstreamText = '{bad';
    await expect(
      generateModuleRecommendations('IPER', 'Mineria', 'ctx'),
    ).resolves.toBeNull();
  });
});
