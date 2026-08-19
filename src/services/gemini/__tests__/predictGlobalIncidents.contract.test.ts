// Tests §12.5.1 split step 17 — gemini/risk.ts contract test.
//
// Verifica que `predictGlobalIncidents` produce el shape compartido
// definido en `types.ts` (PredictiveIncidentResult) y que el backend
// reshapea correctamente las predicciones del LLM.

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

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

type Risk = typeof import('../risk');
let mod: Risk;

const MOCK_RESPONSE = JSON.stringify({
  predicciones: [
    {
      titulo: 'Caída desde altura en andamio',
      descripcion:
        'Operario sin arnés en andamio a 4m de altura. Riesgo de caída por falta de uso de EPP individual.',
      criticidad: 'Alta',
      probabilidad: 'Media',
      accionPreventiva: 'Verificar inspección de arneses y colocar señalización de zona vertical.',
    },
    {
      titulo: 'Incendio por sobrecalentamiento eléctrico',
      descripcion:
        'Cableado deteriorado en panel eléctrico. Condiciones ambientales calurosas acentúan riesgo.',
      criticidad: 'Media',
      probabilidad: 'Alta',
      accionPreventiva: 'Programar inspección termográfica del cuadro eléctrico con termografía.',
    },
  ],
});

function mockResponse(text: string) {
  _generateContent.mockResolvedValueOnce({ text });
}

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'test-key-unit';
  mod = await import('../risk');
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('predictGlobalIncidents — contract', () => {
  it('devuelve todos los campos del contrato PredictiveIncidentResult', async () => {
    mockResponse(MOCK_RESPONSE);

    const result = await mod.predictGlobalIncidents('ctx-nodo', 'ctx-env');

    expect(result).toBeDefined();
    expect(result).not.toBeNull();

    // Campo a campo — NUNCA undefined.
    expect(result.probabilidadGlobal).toBeDefined();
    expect(typeof result.probabilidadGlobal).toBe('number');
    expect(result.nivelRiesgo).toBeDefined();
    expect(
      ['Bajo', 'Medio', 'Alto', 'Crítico'].includes(result.nivelRiesgo),
    ).toBe(true);
    expect(result.confianza).toBeDefined();
    expect(typeof result.confianza).toBe('number');
    expect(result.predicciones).toBeDefined();
    expect(Array.isArray(result.predicciones)).toBe(true);
    expect(result.generatedAt).toBeDefined();
    expect(typeof result.generatedAt).toBe('string');
    expect(result.modelVersion).toBeDefined();
    expect(typeof result.modelVersion).toBe('string');
    expect(result.disclaimer).toBeDefined();
    expect(typeof result.disclaimer).toBe('string');
  });

  it('probabilidadGlobal es el promedio de Alta(70)/Media(40)/Baja(15)', async () => {
    mockResponse(MOCK_RESPONSE);

    const result = await mod.predictGlobalIncidents('ctx', 'env');

    // predicciones: [Media=40, Alta=70] → promedio = 55
    expect(result.probabilidadGlobal).toBe(55);
    expect(result.probabilidadGlobal).toBeGreaterThanOrEqual(0);
    expect(result.probabilidadGlobal).toBeLessThanOrEqual(100);
  });

  it('nivelRiesgo = Crítico cuando hay predicción Alta+Alta', async () => {
    mockResponse(
      JSON.stringify({
        predicciones: [
          {
            titulo: 'T1',
            descripcion: 'd1',
            criticidad: 'Alta',
            probabilidad: 'Alta',
            accionPreventiva: 'a1',
          },
        ],
      }),
    );

    const result = await mod.predictGlobalIncidents('ctx', 'env');
    expect(result.nivelRiesgo).toBe('Crítico');
  });

  it('nivelRiesgo = Alto cuando la crítica máxima es Alta (sin combo Alta+Alta)', async () => {
    mockResponse(
      JSON.stringify({
        predicciones: [
          {
            titulo: 'T1',
            descripcion: 'd1',
            criticidad: 'Alta',
            probabilidad: 'Baja',
            accionPreventiva: 'a1',
          },
        ],
      }),
    );

    const result = await mod.predictGlobalIncidents('ctx', 'env');
    expect(result.nivelRiesgo).toBe('Alto');
  });

  it('nivelRiesgo = Bajo cuando todas las críticas son Baja', async () => {
    mockResponse(
      JSON.stringify({
        predicciones: [
          {
            titulo: 'T1',
            descripcion: 'd1',
            criticidad: 'Baja',
            probabilidad: 'Baja',
            accionPreventiva: 'a1',
          },
        ],
      }),
    );

    const result = await mod.predictGlobalIncidents('ctx', 'env');
    expect(result.nivelRiesgo).toBe('Bajo');
  });

  it('confianza es fija en 30 (no calibrada)', async () => {
    mockResponse(MOCK_RESPONSE);

    const result = await mod.predictGlobalIncidents('ctx', 'env');
    expect(result.confianza).toBe(30);
  });

  it('disclaimer es el literal requerido', async () => {
    mockResponse(MOCK_RESPONSE);

    const result = await mod.predictGlobalIncidents('ctx', 'env');
    expect(result.disclaimer).toBe(
      'Asistencia IA, no decisión. Probabilidades no calibradas.',
    );
  });

  it('predicciones[0].razon y .mitigacionSugerida provienen del reshape', async () => {
    mockResponse(MOCK_RESPONSE);

    const result = await mod.predictGlobalIncidents('ctx', 'env');

    expect(result.predicciones).toHaveLength(2);
    const [p0] = result.predicciones;
    expect(p0.razon).toBe(
      'Operario sin arnés en andamio a 4m de altura. Riesgo de caída por falta de uso de EPP individual.',
    );
    expect(p0.mitigacionSugerida).toBe(
      'Verificar inspección de arneses y colocar señalización de zona vertical.',
    );
    expect(p0.titulo).toBe('Caída desde altura en andamio');
    expect(p0.criticidad).toBe('Alta');
    expect(p0.probabilidad).toBe('Media');
  });

  it('fundamentoLegal defaultea a string vacío cuando el LLM no lo devuelve', async () => {
    mockResponse(MOCK_RESPONSE);

    const result = await mod.predictGlobalIncidents('ctx', 'env');
    expect(result.predicciones[0].fundamentoLegal).toBe('');
  });

  it('criticidad/probabilidad inválidas del LLM se descartan a "Baja" (defensa contra drift)', async () => {
    mockResponse(
      JSON.stringify({
        predicciones: [
          { titulo: 't', descripcion: 'd', criticidad: 'CRITICA_EXTREMA', probabilidad: 'MEDIANITA', accionPreventiva: 'a' },
        ],
      }),
    );

    const result = await mod.predictGlobalIncidents('ctx', 'env');
    expect(result.predicciones[0].criticidad).toBe('Baja');
    expect(result.predicciones[0].probabilidad).toBe('Baja');
    // Y el nivelRiesgo derivado debe ser 'Bajo' (no se dispara el camino Crítico).
    expect(result.nivelRiesgo).toBe('Bajo');
  });

  it('nodoId opcional — undefined cuando el LLM no lo envía', async () => {
    mockResponse(MOCK_RESPONSE);

    const result = await mod.predictGlobalIncidents('ctx', 'env');
    expect(result.predicciones[0].nodoId).toBeUndefined();
  });

  it('generatedAt es ISO-8601 válida', async () => {
    mockResponse(MOCK_RESPONSE);

    const result = await mod.predictGlobalIncidents('ctx', 'env');
    const parsed = new Date(result.generatedAt).getTime();
    expect(Number.isFinite(parsed)).toBe(true);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('modelVersion refleja el modelo configurado', async () => {
    mockResponse(MOCK_RESPONSE);

    const result = await mod.predictGlobalIncidents('ctx', 'env');
    expect(result.modelVersion).toBeTruthy();
    expect(typeof result.modelVersion).toBe('string');
  });
});

describe('predictGlobalIncidents — sin API_KEY', () => {
  it('throws GEMINI_API_KEY is not configured', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    vi.resetModules();
    const noKeyMod = await import('../risk');

    await expect(noKeyMod.predictGlobalIncidents('ctx', 'env')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );

    process.env.GEMINI_API_KEY = savedKey;
  });
});
