// Tests §12.5.1 split step 16 — gemini/engineering.ts.
//
// Sibling suite for the engineering-advisory bundle (structural load +
// hazmat storage design). Both return Markdown TEXT and degrade to a
// Spanish error string on failure — they never propagate.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const _generateContent = vi.fn();

vi.mock('@google/genai', () => {
  function GoogleGenAI(_opts: unknown) {
    return { models: { generateContent: _generateContent } };
  }
  return { GoogleGenAI };
});

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

type Engineering = typeof import('./engineering');
let mod: Engineering;

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'test-key-unit';
  mod = await import('./engineering');
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('calculateStructuralLoad', () => {
  it('happy path: returns markdown string from model', async () => {
    _generateContent.mockResolvedValueOnce({ text: '## SWL: 2 ton' });
    const result = await mod.calculateStructuralLoad('Eslinga', '2 ton, poliéster');
    expect(result).toBe('## SWL: 2 ton');
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('Eslinga');
    expect(call.contents).toContain('descargo de responsabilidad');
  });

  it('undefined model text → returns fallback string', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    const result = await mod.calculateStructuralLoad('e', 's');
    expect(result).toBe('No se pudo generar el cálculo.');
  });

  it('model throws → catch returns error string (never propagates)', async () => {
    _generateContent.mockRejectedValueOnce(new Error('boom'));
    const result = await mod.calculateStructuralLoad('e', 's');
    expect(result).toContain('Error al calcular la capacidad estructural');
  });
});

describe('designHazmatStorage', () => {
  it('happy path: returns markdown design report', async () => {
    _generateContent.mockResolvedValueOnce({ text: '## Bodega Clase 3' });
    const result = await mod.designHazmatStorage('Bodega', 500, 'Clase 3');
    expect(result).toBe('## Bodega Clase 3');
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('DS 43');
    expect(call.contents).toContain('500');
  });

  it('undefined model text → returns fallback string', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    const result = await mod.designHazmatStorage('B', 1, 'C');
    expect(result).toBe('No se pudo generar el diseño.');
  });

  it('model throws → catch returns error string (never propagates)', async () => {
    _generateContent.mockRejectedValueOnce(new Error('boom'));
    const result = await mod.designHazmatStorage('B', 1, 'C');
    expect(result).toContain('Error al generar el diseño');
  });
});

describe('no API_KEY early guard', () => {
  it('calculateStructuralLoad degrades to error string when key is missing (own try/catch)', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    vi.resetModules();
    const noKeyMod = await import('./engineering');
    const result = await noKeyMod.calculateStructuralLoad('e', 's');
    expect(result).toContain('Error al calcular la capacidad estructural');
    process.env.GEMINI_API_KEY = savedKey;
  });
});
