// Tests §12.5.1 split step 14 — gemini/riskNetwork.ts.
//
// Sibling suite for the Red Neuronal graph bundle. Pins the Round 16 (R1)
// doctrine: `criticidad` MUST be absent from prompts and response schemas —
// risk-level classification is the legal output of the deterministic IPER
// P×S matrix (`calculateIper()`), never an LLM guess (Ley 16.744 /
// DS 44/2024 / DS 54 attach liability to that figure).

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const _generateContent = vi.fn();
const _redact = vi.fn((prompt: string, _action: string) => prompt);

vi.mock('@google/genai', () => {
  function GoogleGenAI(_opts: unknown) {
    return { models: { generateContent: _generateContent } };
  }
  return {
    GoogleGenAI,
    Type: {
      OBJECT: 'OBJECT',
      ARRAY: 'ARRAY',
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      BOOLEAN: 'BOOLEAN',
    },
  };
});

vi.mock('./pii', () => ({
  redactPromptForVertex: (prompt: string, action: string) => _redact(prompt, action),
}));

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

type RiskNetwork = typeof import('./riskNetwork');
let mod: RiskNetwork;

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'test-key-unit';
  mod = await import('./riskNetwork');
});

beforeEach(() => {
  vi.clearAllMocks();
});

function mockResponse(text: string) {
  _generateContent.mockResolvedValueOnce({ text });
}

describe('simulateRiskPropagation', () => {
  it('happy path: returns affectedNodes + severity', async () => {
    mockResponse(
      JSON.stringify({
        affectedNodes: ['Andamio Norte'],
        impactDescription: 'efecto dominó',
        severity: 'Alta',
      }),
    );
    const result = (await mod.simulateRiskPropagation('Incendio', 'ctx')) as {
      severity: string;
    };
    expect(result.severity).toBe('Alta');
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('Incendio');
  });

  it('empty response → throws gemini_empty_response', async () => {
    _generateContent.mockResolvedValueOnce({ text: '' });
    await expect(mod.simulateRiskPropagation('t', 'c')).rejects.toThrow(
      'gemini_empty_response',
    );
  });
});

describe('enrichNodeData', () => {
  it('happy path: merges enriched title and description', async () => {
    mockResponse(JSON.stringify({ title: 'Título técnico', description: 'Desc técnica' }));
    const result = await mod.enrichNodeData({ title: 'viejo', description: '' });
    expect(result.title).toBe('Título técnico');
    expect(result.description).toBe('Desc técnica');
  });

  it('malformed JSON → returns original nodeData (guarded try/catch)', async () => {
    mockResponse('not-json{{');
    const nodeData = { title: 'T', description: 'D' };
    const result = await mod.enrichNodeData(nodeData);
    expect(result.title).toBe('T');
    expect(result.description).toBe('D');
  });

  it('R1 doctrine: prompt forbids criticidad and schema omits it', async () => {
    mockResponse(JSON.stringify({ title: 't', description: 'd' }));
    await mod.enrichNodeData({ title: 'x' });
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('NO devuelvas criticidad');
    expect(Object.keys(call.config.responseSchema.properties)).toEqual([
      'title',
      'description',
    ]);
  });
});

describe('analyzeRiskNetwork', () => {
  it('happy path: returns analysis + recommendations', async () => {
    mockResponse(JSON.stringify({ analysis: 'a', recommendations: ['r1'] }));
    const result = (await mod.analyzeRiskNetwork('nodes')) as {
      recommendations: string[];
    };
    expect(result.recommendations).toEqual(['r1']);
  });
});

describe('analyzeRiskNetworkHealth', () => {
  it('happy path: returns healthScore + gaps', async () => {
    mockResponse(
      JSON.stringify({ healthScore: 80, missingSynapses: [], knowledgeGaps: [] }),
    );
    const result = (await mod.analyzeRiskNetworkHealth([
      { type: 'RISK', id: '1', title: 'T', description: 'D' },
    ])) as { healthScore: number };
    expect(result.healthScore).toBe(80);
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('ID: 1');
  });
});

describe('analyzeFeedPostForRiskNetwork', () => {
  it('happy path: risk detected, redaction seam applied to prompt', async () => {
    mockResponse(
      JSON.stringify({ isRelevant: true, type: 'RISK', title: 'T', description: 'D', tags: [] }),
    );
    const result = (await mod.analyzeFeedPostForRiskNetwork('cable pelado', null, 'Juan')) as {
      isRelevant: boolean;
    };
    expect(result.isRelevant).toBe(true);
    expect(_redact).toHaveBeenCalledWith(
      expect.stringContaining('cable pelado'),
      'analyzeFeedPostForRiskNetwork',
    );
  });

  it('with imageBase64 → parts include inlineData with png mime detection', async () => {
    mockResponse(JSON.stringify({ isRelevant: false }));
    await mod.analyzeFeedPostForRiskNetwork(
      'post',
      'data:image/png;base64,QUJD',
      'Ana',
    );
    const call = _generateContent.mock.calls[0][0];
    const imagePart = call.contents.parts[1];
    expect(imagePart.inlineData.mimeType).toBe('image/png');
    expect(imagePart.inlineData.data).toBe('QUJD');
  });

  it('R1 doctrine: prompt forbids criticidad and schema omits it', async () => {
    mockResponse(JSON.stringify({ isRelevant: false }));
    await mod.analyzeFeedPostForRiskNetwork('post', null, 'Ana');
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents.parts[0].text).toContain('NO devuelvas criticidad');
    expect(call.config.responseSchema.properties).not.toHaveProperty('criticidad');
  });

  it('empty response → throws gemini_empty_response (typed 502 path, no fallback)', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    await expect(
      mod.analyzeFeedPostForRiskNetwork('post', null, 'Ana'),
    ).rejects.toThrow('gemini_empty_response');
  });
});

describe('no API_KEY early guard', () => {
  it('enrichNodeData returns original nodeData (no throw) when key is missing', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    vi.resetModules();
    const noKeyMod = await import('./riskNetwork');
    const nodeData = { title: 'T', description: 'D' };
    const result = await noKeyMod.enrichNodeData(nodeData);
    expect(result).toEqual(nodeData);
    process.env.GEMINI_API_KEY = savedKey;
  });

  it('simulateRiskPropagation throws when key is missing', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    vi.resetModules();
    const noKeyMod = await import('./riskNetwork');
    await expect(noKeyMod.simulateRiskPropagation('t', 'c')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
    process.env.GEMINI_API_KEY = savedKey;
  });
});
