// Tests §12.5.1 split step 13 — gemini/predictions.ts.
//
// Sibling suite for the predictive/forecast bundle extracted from
// geminiBackend.ts. The barrel-level consumer tests in
// `src/services/geminiBackend.test.ts` keep pinning these same functions
// through the re-export (movement proof); this file exercises the module
// directly so future edits are caught at the source.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const _generateContent = vi.fn();

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

type Predictions = typeof import('./predictions');
let mod: Predictions;

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'test-key-unit';
  mod = await import('./predictions');
});

beforeEach(() => {
  vi.clearAllMocks();
});

function mockResponse(text: string) {
  _generateContent.mockResolvedValueOnce({ text });
}

describe('generateRealisticIoTEvent', () => {
  it('happy path: returns parsed IoT event object', async () => {
    mockResponse(
      JSON.stringify({
        deviceId: 'SENSOR-TEMP-01',
        type: 'temperature',
        value: 75,
        unit: '°C',
        status: 'warning',
        message: 'Temperatura elevada',
      }),
    );
    const result = (await mod.generateRealisticIoTEvent('faena minera')) as {
      deviceId: string;
      status: string;
    };
    expect(result.deviceId).toBe('SENSOR-TEMP-01');
    expect(result.status).toBe('warning');
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('faena minera');
  });

  it('empty model response → throws gemini_empty_response (F2)', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    await expect(mod.generateRealisticIoTEvent('ctx')).rejects.toThrow(
      'gemini_empty_response',
    );
  });
});

describe('generatePredictiveForecast', () => {
  it('happy path: returns forecast with riskLevel and score', async () => {
    mockResponse(
      JSON.stringify({
        riskLevel: 'Alto',
        score: 78,
        topRisks: [],
        recommendations: [],
        empatheticActions: [],
        aiInsight: 'insight',
      }),
    );
    const result = (await mod.generatePredictiveForecast('Proyecto X', 'ctx')) as {
      riskLevel: string;
      score: number;
    };
    expect(result.riskLevel).toBe('Alto');
    expect(result.score).toBe(78);
  });

  it('weatherContext optional → prompt includes default text', async () => {
    mockResponse(
      JSON.stringify({
        riskLevel: 'Bajo',
        score: 5,
        topRisks: [],
        recommendations: [],
        empatheticActions: [],
        aiInsight: 'i',
      }),
    );
    await mod.generatePredictiveForecast('P', 'ctx');
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('Sin datos ambientales recientes.');
  });

  it('undefined response.text → throws gemini_empty_response (F2)', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    await expect(mod.generatePredictiveForecast('P', 'ctx')).rejects.toThrow(
      'gemini_empty_response',
    );
  });
});

describe('forecastSafetyEvents', () => {
  it('happy path: returns pronostico + diasCriticos', async () => {
    mockResponse(
      JSON.stringify({
        pronosticoSemanal: 'resumen',
        diasCriticos: [{ dia: 'Lunes', nivelRiesgo: 'Alto', razon: 'lluvia' }],
        tendenciasDetectadas: [],
        recomendacionesEstrategicas: [],
      }),
    );
    const result = (await mod.forecastSafetyEvents('nodes-ctx')) as {
      diasCriticos: Array<{ dia: string }>;
    };
    expect(result.diasCriticos[0].dia).toBe('Lunes');
  });

  it('historicalData optional → prompt includes default text', async () => {
    mockResponse(JSON.stringify({ pronosticoSemanal: 'x', diasCriticos: [], tendenciasDetectadas: [], recomendacionesEstrategicas: [] }));
    await mod.forecastSafetyEvents('nodes-ctx');
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('No hay datos históricos');
  });
});

describe('predictAccidents', () => {
  it('happy path: returns predictions array', async () => {
    mockResponse(
      JSON.stringify({
        predictions: [
          {
            title: 'Caída',
            probability: 80,
            description: 'd',
            preventiveAction: 'a',
            severity: 'Alta',
          },
        ],
      }),
    );
    const result = (await mod.predictAccidents('nodes', 'telemetry')) as {
      predictions: Array<{ title: string }>;
    };
    expect(result.predictions).toHaveLength(1);
    const call = _generateContent.mock.calls[0][0];
    expect(call.contents).toContain('telemetry');
  });
});

describe('analyzeSiteMapDensity', () => {
  it('happy path: returns puntosCalientes + alertaInmediata', async () => {
    mockResponse(
      JSON.stringify({
        puntosCalientes: [],
        insightGlobal: 'ok',
        alertaInmediata: false,
      }),
    );
    const result = (await mod.analyzeSiteMapDensity('n', 'w', 'a')) as {
      alertaInmediata: boolean;
    };
    expect(result.alertaInmediata).toBe(false);
  });

  it('empty response → throws gemini_empty_response', async () => {
    _generateContent.mockResolvedValueOnce({ text: '' });
    await expect(mod.analyzeSiteMapDensity('n', 'w', 'a')).rejects.toThrow(
      'gemini_empty_response',
    );
  });
});

describe('no API_KEY early guard', () => {
  it('generateRealisticIoTEvent throws when key is missing', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    vi.resetModules();
    const noKeyMod = await import('./predictions');
    await expect(noKeyMod.generateRealisticIoTEvent('ctx')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
    process.env.GEMINI_API_KEY = savedKey;
  });
});
