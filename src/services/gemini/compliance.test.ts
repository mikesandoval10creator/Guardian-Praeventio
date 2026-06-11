// Tests §12.5.1 split step 15 — gemini/compliance.ts.
//
// Sibling suite for the normative-compliance bundle extracted from
// geminiBackend.ts (movement also pinned by the barrel consumer tests).

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const _generateContent = vi.fn();
const _searchRelevantContext = vi.fn(async (_q: string) => 'mock-rag-context');

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

vi.mock('../ragService', () => ({
  searchRelevantContext: (q: string) => _searchRelevantContext(q),
}));

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

type Compliance = typeof import('./compliance');
let mod: Compliance;

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'test-key-unit';
  mod = await import('./compliance');
});

beforeEach(() => {
  vi.clearAllMocks();
});

function mockResponse(text: string) {
  _generateContent.mockResolvedValueOnce({ text });
}

describe('generateOperationalTasks', () => {
  it('happy path: returns array of task strings', async () => {
    mockResponse(JSON.stringify(['Revisar arnés', 'Verificar extintor']));
    const result = await mod.generateOperationalTasks('DS 594', 'higiene');
    expect(result).toEqual(['Revisar arnés', 'Verificar extintor']);
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('DS 594');
  });

  it('undefined response.text → throws gemini_empty_response (F2)', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    await expect(mod.generateOperationalTasks('n', 'd')).rejects.toThrow(
      'gemini_empty_response',
    );
  });
});

describe('evaluateMinsalCompliance', () => {
  it('happy path: fetches RAG context and returns markdown text', async () => {
    _generateContent.mockResolvedValueOnce({ text: '# Informe auditoría' });
    const result = await mod.evaluateMinsalCompliance('PREXOR', 'ctx', 'minería');
    expect(result).toBe('# Informe auditoría');
    expect(_searchRelevantContext).toHaveBeenCalledWith(
      expect.stringContaining('PREXOR'),
    );
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('mock-rag-context');
  });

  it('model throws → catch returns Spanish error string (never propagates)', async () => {
    _generateContent.mockRejectedValueOnce(new Error('boom'));
    const result = await mod.evaluateMinsalCompliance('PREXOR', 'ctx');
    expect(result).toContain('Error al evaluar el cumplimiento');
  });
});

describe('calculateComplianceSummary', () => {
  it('happy path: returns globalScore + categories + criticalActions', async () => {
    mockResponse(
      JSON.stringify({
        globalScore: 85,
        categories: [{ name: 'EPP', score: 90 }],
        criticalActions: ['a1'],
      }),
    );
    const result = (await mod.calculateComplianceSummary('proj-A', [
      { projectId: 'proj-A', type: 'RISK', title: 'T1', metadata: {} },
    ])) as { globalScore: number };
    expect(result.globalScore).toBe(85);
  });

  it('filters nodes by projectId: only proj-A nodes in prompt', async () => {
    mockResponse(JSON.stringify({ globalScore: 1, categories: [], criticalActions: [] }));
    await mod.calculateComplianceSummary('proj-A', [
      { projectId: 'proj-A', type: 'RISK', title: 'INCLUIDO', metadata: {} },
      { projectId: 'proj-B', type: 'RISK', title: 'EXCLUIDO', metadata: {} },
    ]);
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('INCLUIDO');
    expect(call.contents).not.toContain('EXCLUIDO');
  });
});

describe('processGlobalSafetyAudit', () => {
  it('happy path: returns audit findings + healthIndex', async () => {
    mockResponse(
      JSON.stringify({
        auditTitle: 'Auditoría Master',
        keyFindings: [],
        riskCorrelations: [],
        criticalGaps: [],
        recommendations: [],
        healthIndex: 72,
      }),
    );
    const result = (await mod.processGlobalSafetyAudit('p1', {
      name: 'Faena Norte',
      reports: [],
    })) as { healthIndex: number };
    expect(result.healthIndex).toBe(72);
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('Faena Norte');
  });
});

describe('scanLegalUpdates', () => {
  it('happy path: returns affected modules + impact level', async () => {
    mockResponse(
      JSON.stringify({
        affected: true,
        impactLevel: 'Alto',
        affectedModules: ['IPER'],
        summary: 's',
        recommendedAction: 'a',
      }),
    );
    const result = (await mod.scanLegalUpdates('DS 44', 'texto', 'IPER, PTS')) as {
      affected: boolean;
      impactLevel: string;
    };
    expect(result.affected).toBe(true);
    expect(result.impactLevel).toBe('Alto');
  });

  it('normativeText is sliced to 1500 chars in prompt', async () => {
    mockResponse(
      JSON.stringify({
        affected: false,
        impactLevel: 'Sin impacto',
        affectedModules: [],
        summary: 's',
        recommendedAction: 'a',
      }),
    );
    const longText = 'A'.repeat(2000);
    await mod.scanLegalUpdates('Norma', longText, 'mods');
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('A'.repeat(1500));
    expect(call.contents).not.toContain('A'.repeat(1501));
  });
});

describe('no API_KEY early guard', () => {
  it('generateOperationalTasks throws when key is missing', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    vi.resetModules();
    const noKeyMod = await import('./compliance');
    await expect(noKeyMod.generateOperationalTasks('n', 'd')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
    process.env.GEMINI_API_KEY = savedKey;
  });
});
