// Unit tests for src/services/geminiBackend.ts.
//
// Covers the DIRECTLY-DEFINED exported functions (i.e. those NOT
// re-exported from sub-modules under gemini/*). Sub-module functions
// have their own sibling test files.
//
// Strategy:
//  1. Mock @google/genai so NO real API call is made.
//  2. Mock heavy transitive deps (ragService, routingBackend, gemini/pii,
//     logger, observability/*, sub-module barrels).
//  3. API_KEY = process.env.GEMINI_API_KEY is evaluated at module scope —
//     we set process.env.GEMINI_API_KEY BEFORE the static import runs.
//     In Vitest/ESM, vi.mock factories are hoisted (run first), then top-
//     level JS code runs in declaration order, then static imports are
//     bound. We set the env var before the geminiBackend import so the
//     module-scope const sees the value.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ── Module-level spy (survives vi.resetModules because it lives HERE) ──────
// Must be declared before vi.mock so the factory closure can reference it.
const _generateContent = vi.fn();

// ── Mocks are hoisted to the top of the file by Vitest ────────────────────

vi.mock('@google/genai', () => {
  // Use a named function (not arrow) so it can be called with `new`.
  function GoogleGenAI(_opts: unknown) {
    return { models: { generateContent: _generateContent } };
  }
  return {
    GoogleGenAI,
    Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
    Modality: { AUDIO: 'AUDIO' },
    FunctionDeclaration: {},
  };
});

vi.mock('./ragService', () => ({
  searchRelevantContext: vi.fn(async () => 'mock-rag-context'),
  queryCommunityKnowledge: vi.fn(async () => 'mock-community-ctx'),
}));

vi.mock('./gemini/pii', () => ({
  redactPromptForVertex: vi.fn((prompt: string) => prompt),
}));

vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('./observability/sentryInstrumentation', () => ({
  withSentryScope: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
}));

vi.mock('../server/middleware/geminiCircuit.js', () => ({
  geminiCircuit: { isOpen: vi.fn(() => false), recordSuccess: vi.fn(), recordFailure: vi.fn() },
}));

vi.mock('./observability/quotaTracker.js', () => ({
  checkQuotaLimit: vi.fn(async () => ({ allowed: true })),
  trackGeminiUsage: vi.fn(async () => undefined),
}));

// Sub-modules — stub so their exports don't call real network/Gemini
vi.mock('./gemini/governance', () => ({
  assertGeminiAllowed: vi.fn(async () => undefined),
  estimateGeminiCostUsd: vi.fn(() => 0),
  recordGeminiOutcome: vi.fn(async () => undefined),
}));
vi.mock('./gemini/embeddings', () => ({
  generateEmbeddingsBatch: vi.fn(async () => []),
  autoConnectNodes: vi.fn(async () => []),
  semanticSearch: vi.fn(async () => []),
  cosineSimilarity: vi.fn(() => 0),
}));
vi.mock('./gemini/vision', () => ({
  analyzePostureWithAI: vi.fn(async () => ({})),
  analyzeSafetyImage: vi.fn(async () => ({})),
  analyzeBioImage: vi.fn(async () => ({})),
}));
vi.mock('./gemini/risk', () => ({
  analyzeFastCheck: vi.fn(async () => ({})),
  predictGlobalIncidents: vi.fn(async () => ({})),
  analyzeRiskWithAI: vi.fn(async () => ({})),
  analyzeRootCauses: vi.fn(async () => ({})),
}));
vi.mock('./gemini/emergency', () => ({
  generateEmergencyPlan: vi.fn(async () => ({})),
  generateEmergencyScenario: vi.fn(async () => ({})),
  generateEmergencyPlanJSON: vi.fn(async () => ({})),
}));
vi.mock('./gemini/safetyDocs', () => ({
  generatePTS: vi.fn(async () => ({})),
  generatePTSWithManufacturerData: vi.fn(async () => ({})),
  generateSafetyReport: vi.fn(async () => ({})),
}));
vi.mock('./gemini/chat', () => ({
  queryBCN: vi.fn(async () => ''),
  getChatResponse: vi.fn(async () => ''),
  getSafetyAdvice: vi.fn(async () => ({})),
}));
vi.mock('./gemini/personPlans', () => ({
  generateActionPlan: vi.fn(async () => ({})),
  generatePersonalizedSafetyPlan: vi.fn(async () => ({})),
  generateTrainingRecommendations: vi.fn(async () => ({})),
  generateSafetyCapsule: vi.fn(async () => ({})),
  generateCompensatoryExercises: vi.fn(async () => ({})),
}));
vi.mock('./gemini/operations', () => ({
  generateISOAuditChecklist: vi.fn(async () => ({})),
  processDocumentToNodes: vi.fn(async () => []),
  auditAISuggestion: vi.fn(async () => ({})),
  analyzeDocumentCompliance: vi.fn(async () => ({})),
  investigateIncidentWithAI: vi.fn(async () => ({})),
  auditProjectComplianceWithAI: vi.fn(async () => ({})),
  analyzeAttendancePatterns: vi.fn(async () => ({})),
}));
vi.mock('./gemini/suggestions', () => ({
  suggestRisksWithAI: vi.fn(async () => ({})),
  suggestNormativesWithAI: vi.fn(async () => []),
}));
vi.mock('./gemini/parsing', async (importOriginal) => {
  // Keep real parseGeminiJson — it's a pure helper the functions rely on.
  const original = await importOriginal<typeof import('./gemini/parsing')>();
  return original;
});

// Barrel re-exports at the bottom of geminiBackend.ts — stub as empty modules
vi.mock('./susesoBackend.js', () => ({}));
vi.mock('./eppBackend.js', () => ({}));
vi.mock('./comiteBackend.js', () => ({}));
vi.mock('./medicineBackend.js', () => ({}));
vi.mock('./predictionBackend.js', () => ({}));
vi.mock('./legalBackend.js', () => ({}));
vi.mock('./medicalAnalysisBackend.js', () => ({}));
vi.mock('./chemicalBackend.js', () => ({}));
vi.mock('./psychosocialBackend.js', () => ({}));
vi.mock('./shiftBackend.js', () => ({}));
vi.mock('./trainingBackend.js', () => ({}));
vi.mock('./inventoryBackend.js', () => ({}));
vi.mock('./networkBackend.js', () => ({}));
vi.mock('./routingBackend.js', () => ({
  calculateDeterministicSafeRoute: vi.fn(() => [
    { lat: -33.449, lng: -70.669 },
    { lat: -33.450, lng: -70.670 },
  ]),
}));
vi.mock('./ragService.js', () => ({
  searchRelevantContext: vi.fn(async () => 'mock-rag'),
  queryCommunityKnowledge: vi.fn(async () => 'mock-community'),
}));

// ── Helper ────────────────────────────────────────────────────────────────
function mockResponse(text: string) {
  _generateContent.mockResolvedValueOnce({ text });
}

// ── Module under test — dynamic import so env var is set in time ──────────
// In Vitest ESM mode, static imports are evaluated at module-graph
// resolution time, BEFORE the test file's top-level code runs. That means
// `process.env.GEMINI_API_KEY = ...` would run AFTER the module is already
// cached with API_KEY = undefined. Using a dynamic import inside beforeAll
// lets us set the env var first.
type GeminiBackend = typeof import('./geminiBackend');
let mod: GeminiBackend;

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'test-key-unit';
  mod = await import('./geminiBackend');
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
// generateRealisticIoTEvent
// ─────────────────────────────────────────────────────────────────────────
describe('generateRealisticIoTEvent', () => {
  it('happy path: returns parsed IoT event object', async () => {
    const payload = {
      deviceId: 'SENSOR-TEMP-01',
      type: 'temperature',
      value: 72.5,
      unit: '°C',
      status: 'warning',
      message: 'Temperatura elevada detectada',
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.generateRealisticIoTEvent('Faena minera, turno noche');
    expect(result).toMatchObject({ deviceId: 'SENSOR-TEMP-01', status: 'warning' });
  });

  it('empty model response → throws gemini_empty_response', async () => {
    mockResponse('');
    await expect(mod.generateRealisticIoTEvent('ctx')).rejects.toThrow('gemini_empty_response');
  });

  it('malformed JSON → propagates SyntaxError (parseGeminiJson contract)', async () => {
    mockResponse('not-json');
    await expect(mod.generateRealisticIoTEvent('ctx')).rejects.toThrow(SyntaxError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// simulateRiskPropagation
// ─────────────────────────────────────────────────────────────────────────
describe('simulateRiskPropagation', () => {
  it('happy path: returns affectedNodes + severity', async () => {
    const payload = {
      affectedNodes: ['Riesgo eléctrico', 'Sobrecarga circuito'],
      impactDescription: 'Propagación eléctrica sistémica',
      severity: 'Alta',
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.simulateRiskPropagation('Cortocircuito', 'nodo-a, nodo-b') as Record<string, unknown>;
    expect(result.severity).toBe('Alta');
    expect(Array.isArray(result.affectedNodes)).toBe(true);
  });

  it('empty response → throws gemini_empty_response', async () => {
    mockResponse('');
    await expect(mod.simulateRiskPropagation('n', 'ctx')).rejects.toThrow('gemini_empty_response');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// enrichNodeData
// ─────────────────────────────────────────────────────────────────────────
describe('enrichNodeData', () => {
  it('happy path: merges enriched title and description', async () => {
    const enriched = {
      title: 'Riesgo de caída a distinto nivel',
      description: 'Exposición a superficies de trabajo elevadas sin protecciones perimetrales.',
    };
    mockResponse(JSON.stringify(enriched));
    const result = await mod.enrichNodeData({ title: 'Caída', description: '', type: 'risk' } as unknown as Parameters<typeof mod.enrichNodeData>[0]);
    expect(result.title).toBe('Riesgo de caída a distinto nivel');
    expect(result.type).toBe('risk'); // preserves original fields
  });

  it('malformed JSON → catches error and returns original nodeData (guarded try/catch)', async () => {
    _generateContent.mockResolvedValueOnce({ text: 'INVALID JSON {{{' });
    const original = { title: 'Original', description: 'Desc', type: 'risk' } as unknown as Parameters<typeof mod.enrichNodeData>[0];
    const result = await mod.enrichNodeData(original);
    expect(result.title).toBe('Original');
  });

  it('JSON with missing title field → uses nodeData.title as fallback', async () => {
    mockResponse(JSON.stringify({ description: 'New description' }));
    const result = await mod.enrichNodeData({ title: 'Old title', description: 'Old desc' });
    // result.title is undefined → falsy → uses nodeData.title
    expect(result.title).toBe('Old title');
    expect(result.description).toBe('New description');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// generatePredictiveForecast
// Uses JSON.parse(response.text || '{}') — UNGUARDED for bad JSON
// ─────────────────────────────────────────────────────────────────────────
describe('generatePredictiveForecast', () => {
  it('happy path: returns forecast object with riskLevel and score', async () => {
    const payload = {
      riskLevel: 'Alto',
      score: 78,
      topRisks: [{ title: 'Caída', probability: 0.8, impact: 'Alto', mitigation: 'Usar arnés' }],
      recommendations: ['Usar EPP'],
      empatheticActions: ['Hidratarse'],
      aiInsight: 'Riesgo elevado por calor extremo.',
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.generatePredictiveForecast('Proyecto Mine', 'ctx', 'Temp 38°C') as Record<string, unknown>;
    expect(result.riskLevel).toBe('Alto');
    expect(result.score).toBe(78);
  });

  it('undefined response.text → returns empty object {}', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    const result = await mod.generatePredictiveForecast('p', 'c') as Record<string, unknown>;
    expect(result).toEqual({});
  });

  it('weatherContext is optional → still calls model', async () => {
    const payload = { riskLevel: 'Bajo', score: 20, topRisks: [], recommendations: [], empatheticActions: [], aiInsight: '' };
    mockResponse(JSON.stringify(payload));
    const result = await mod.generatePredictiveForecast('p', 'c') as Record<string, unknown>;
    expect(result.riskLevel).toBe('Bajo');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// generateOperationalTasks
// Uses JSON.parse(response.text || '[]') — UNGUARDED for bad JSON
// ─────────────────────────────────────────────────────────────────────────
describe('generateOperationalTasks', () => {
  it('happy path: returns array of task strings', async () => {
    const tasks = ['Revisar arnés', 'Verificar EPP', 'Completar ART'];
    mockResponse(JSON.stringify(tasks));
    const result = await mod.generateOperationalTasks('Normativa DS 594', 'Establece condiciones sanitarias');
    expect(result).toEqual(tasks);
    expect(Array.isArray(result)).toBe(true);
  });

  it('undefined response.text → returns empty array []', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    const result = await mod.generateOperationalTasks('n', 'd');
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeRiskNetwork
// ─────────────────────────────────────────────────────────────────────────
describe('analyzeRiskNetwork', () => {
  it('happy path: returns analysis + recommendations', async () => {
    const payload = {
      analysis: 'Red con alta concentración de riesgos mecánicos.',
      recommendations: ['Reforzar EPP', 'Capacitar en altura'],
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.analyzeRiskNetwork('nodo1, nodo2') as Record<string, unknown>;
    expect(result.analysis).toContain('mecánicos');
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  it('empty response → throws gemini_empty_response', async () => {
    mockResponse('');
    await expect(mod.analyzeRiskNetwork('ctx')).rejects.toThrow('gemini_empty_response');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// predictAccidents
// ─────────────────────────────────────────────────────────────────────────
describe('predictAccidents', () => {
  it('happy path: returns predictions array', async () => {
    const payload = {
      predictions: [
        {
          title: 'Golpe por objeto',
          probability: 65,
          description: 'Alta probabilidad en zona de grúas.',
          preventiveAction: 'Delimitar área. Ley 16.744 art. 68.',
          severity: 'Alta',
        },
      ],
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.predictAccidents('network-ctx', 'telemetry-ctx') as { predictions: unknown[] };
    expect(result.predictions).toHaveLength(1);
    expect((result.predictions[0] as Record<string, unknown>).probability).toBe(65);
  });

  it('empty response → throws gemini_empty_response', async () => {
    mockResponse('');
    await expect(mod.predictAccidents('n', 't')).rejects.toThrow('gemini_empty_response');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeSiteMapDensity
// Uses JSON.parse(response.text || '{}') — UNGUARDED
// ─────────────────────────────────────────────────────────────────────────
describe('analyzeSiteMapDensity', () => {
  it('happy path: returns puntosCalientes + alertaInmediata', async () => {
    const payload = {
      puntosCalientes: [
        { sector: 'Zona A', nivelRiesgo: 'Alto', descripcion: 'Alta densidad de personal', recomendacion: 'Redistribuir' },
      ],
      insightGlobal: 'Alta concentración en sector norte.',
      alertaInmediata: true,
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.analyzeSiteMapDensity('nodes', 'workers', 'assets') as Record<string, unknown>;
    expect(result.alertaInmediata).toBe(true);
    expect(Array.isArray(result.puntosCalientes)).toBe(true);
  });

  it('undefined response.text → returns {}', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    const result = await mod.analyzeSiteMapDensity('n', 'w', 'a') as Record<string, unknown>;
    expect(result).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────
// generateTrainingQuiz
// ─────────────────────────────────────────────────────────────────────────
describe('generateTrainingQuiz', () => {
  it('happy path: returns array of quiz questions', async () => {
    const payload = [
      {
        question: '¿Qué EPP es obligatorio en altura?',
        options: ['Casco', 'Arnés', 'Guantes', 'Protector auditivo'],
        correctIndex: 1,
        explanation: 'El arnés es obligatorio para trabajos en altura.',
      },
    ];
    mockResponse(JSON.stringify(payload));
    const result = await mod.generateTrainingQuiz('Trabajo en altura', 'DS 594') as unknown[];
    expect(Array.isArray(result)).toBe(true);
    expect((result[0] as Record<string, unknown>).correctIndex).toBe(1);
  });

  it('empty response → throws gemini_empty_response', async () => {
    mockResponse('');
    await expect(mod.generateTrainingQuiz('topic', 'desc')).rejects.toThrow('gemini_empty_response');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// calculateDynamicEvacuationRoute
// Has try/catch with typed fallback → safe against bad JSON
// ─────────────────────────────────────────────────────────────────────────
describe('calculateDynamicEvacuationRoute', () => {
  it('happy path: merges Gemini instructions with deterministic routePoints', async () => {
    const geminiPart = {
      rutaSegura: 'Ruta Principal Norte',
      rutasBloqueadas: [],
      tiempoEstimado: '3 minutos',
      nivelAlerta: 'Rojo',
      instrucciones: ['Ir a la zona de seguridad'],
      puntoEncuentroNombre: 'Zona A',
      startPoint: { lat: -33.4489, lng: -70.6693 },
      endPoint: { lat: -33.450, lng: -70.670 },
    };
    mockResponse(JSON.stringify(geminiPart));
    const result = await mod.calculateDynamicEvacuationRoute(
      [{ title: 'Incendio', description: 'Fuego en bodega', severity: 'Crítica', location: { lat: -33.449, lng: -70.669 } }],
      [{ position: [-33.4489, -70.6693] }],
      [],
    ) as Record<string, unknown>;
    expect(result.rutaSegura).toBe('Ruta Principal Norte');
    expect(Array.isArray(result.routePoints)).toBe(true);
  });

  it('malformed JSON → returns typed fallback (guarded try/catch)', async () => {
    mockResponse('NOT VALID JSON');
    const result = await mod.calculateDynamicEvacuationRoute([], [], []) as Record<string, unknown>;
    expect(result.nivelAlerta).toBe('Rojo');
    expect(result.rutaSegura).toBeTruthy();
    expect(Array.isArray(result.routePoints)).toBe(true);
  });

  it('empty workers array → uses default Santiago start point', async () => {
    const geminiPart = {
      rutaSegura: 'Ruta Defecto', rutasBloqueadas: [], tiempoEstimado: '5 minutos',
      nivelAlerta: 'Amarillo', instrucciones: ['Evacuación estándar'],
      puntoEncuentroNombre: 'Punto Central',
      startPoint: { lat: -33.4489, lng: -70.6693 }, endPoint: { lat: -33.450, lng: -70.670 },
    };
    mockResponse(JSON.stringify(geminiPart));
    const result = await mod.calculateDynamicEvacuationRoute([], [], []) as Record<string, unknown>;
    expect(result.rutaSegura).toBe('Ruta Defecto');
  });

  it('fallen workers: prompt includes ALERTA message', async () => {
    const geminiPart = {
      rutaSegura: 'Ruta Emergencia', rutasBloqueadas: [], tiempoEstimado: '2 minutos',
      nivelAlerta: 'Rojo', instrucciones: ['Priorizar heridos'], puntoEncuentroNombre: 'Triage',
      startPoint: { lat: -33.4489, lng: -70.6693 }, endPoint: { lat: -33.450, lng: -70.670 },
    };
    mockResponse(JSON.stringify(geminiPart));
    await mod.calculateDynamicEvacuationRoute(
      [],
      [{ position: [-33.449, -70.669], isFallen: true }],
      [],
    );
    const callArgs = _generateContent.mock.calls[0][0] as { contents: string };
    expect(callArgs.contents).toContain('ALERTA');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeVisionImage
// Uses JSON.parse(response.text || '{}') — UNGUARDED
// ─────────────────────────────────────────────────────────────────────────
describe('analyzeVisionImage', () => {
  it('happy path: returns EPP + risks + summary', async () => {
    const payload = {
      eppDetected: ['Casco', 'Guantes'],
      risksDetected: ['Cable suelto en pasillo'],
      recommendations: ['Señalizar el área'],
      summary: 'Entorno con riesgo eléctrico moderado.',
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.analyzeVisionImage('base64data') as Record<string, unknown>;
    expect(result.eppDetected).toContain('Casco');
    expect(result.summary).toBeTruthy();
  });

  it('undefined response.text → returns {}', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    const result = await mod.analyzeVisionImage('img') as Record<string, unknown>;
    expect(result).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────
// verifyEPPWithAI
// Uses JSON.parse(response.text || '{}') — UNGUARDED
// ─────────────────────────────────────────────────────────────────────────
describe('verifyEPPWithAI', () => {
  it('happy path: non-compliant worker', async () => {
    const payload = {
      isCompliant: false,
      detectedEPP: ['Casco'],
      missingEPP: ['Guantes', 'Chaleco reflectante'],
      recommendations: ['Usar guantes resistentes a corte'],
      confidence: 0.88,
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.verifyEPPWithAI('img', 'Juan Pérez', ['Casco', 'Guantes', 'Chaleco']) as Record<string, unknown>;
    expect(result.isCompliant).toBe(false);
    expect((result.missingEPP as string[]).length).toBe(2);
    expect(result.confidence).toBe(0.88);
  });

  it('fully compliant worker: isCompliant=true, missingEPP=[]', async () => {
    const payload = { isCompliant: true, detectedEPP: ['Casco', 'Guantes'], missingEPP: [], recommendations: [], confidence: 0.95 };
    mockResponse(JSON.stringify(payload));
    const result = await mod.verifyEPPWithAI('img', 'María López', ['Casco', 'Guantes']) as Record<string, unknown>;
    expect(result.isCompliant).toBe(true);
    expect((result.missingEPP as string[]).length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeRiskNetworkHealth
// Uses JSON.parse(response.text || '{}') — UNGUARDED
// ─────────────────────────────────────────────────────────────────────────
describe('analyzeRiskNetworkHealth', () => {
  it('happy path: returns healthScore + gaps', async () => {
    const payload = {
      healthScore: 72,
      missingSynapses: [
        { sourceId: 'n1', targetId: 'n2', reason: 'Relación riesgo-normativa', sourceTitle: 'Ruido', targetTitle: 'DS 594' },
      ],
      knowledgeGaps: [
        { topic: 'PREXOR', priority: 'Alta', suggestion: 'Agregar nodos de vigilancia auditiva' },
      ],
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.analyzeRiskNetworkHealth([
      { id: 'n1', type: 'risk', title: 'Ruido', description: 'Exposición a ruido' },
    ]) as Record<string, unknown>;
    expect(result.healthScore).toBe(72);
    expect(Array.isArray(result.missingSynapses)).toBe(true);
  });

  it('empty nodes array → still calls model and returns result', async () => {
    mockResponse(JSON.stringify({ healthScore: 100, missingSynapses: [], knowledgeGaps: [] }));
    const result = await mod.analyzeRiskNetworkHealth([]) as Record<string, unknown>;
    expect(result.healthScore).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeFeedPostForRiskNetwork
// Throws on empty response.text; JSON.parse(text.trim()) — UNGUARDED for bad JSON
// ─────────────────────────────────────────────────────────────────────────
describe('analyzeFeedPostForRiskNetwork', () => {
  it('happy path: parses feed post — risk detected', async () => {
    const payload = {
      isRelevant: true,
      type: 'RISK',
      title: 'Cable suelto detectado',
      description: 'Cable sin protección en pasillo central',
      tags: ['eléctrico', 'caída'],
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.analyzeFeedPostForRiskNetwork(
      'Vi un cable suelto en el pasillo',
      null,
      'Pedro González',
    ) as Record<string, unknown>;
    expect(result.isRelevant).toBe(true);
    expect(result.type).toBe('RISK');
  });

  it('isRelevant: false for innocuous post', async () => {
    mockResponse(JSON.stringify({ isRelevant: false }));
    const result = await mod.analyzeFeedPostForRiskNetwork('Buen trabajo hoy equipo!', null, 'Ana') as Record<string, unknown>;
    expect(result.isRelevant).toBe(false);
  });

  it('with imageBase64 → parts include image inlineData', async () => {
    mockResponse(JSON.stringify({ isRelevant: true, type: 'INCIDENT' }));
    await mod.analyzeFeedPostForRiskNetwork(
      'Foto de un riesgo',
      'data:image/png;base64,abc123',
      'Carlos',
    );
    const callArgs = _generateContent.mock.calls[0][0] as { contents: { parts: unknown[] } };
    expect(callArgs.contents.parts.length).toBe(2);
  });

  it('empty response text → throws gemini_empty_response', async () => {
    _generateContent.mockResolvedValueOnce({ text: '' });
    await expect(
      mod.analyzeFeedPostForRiskNetwork('contenido', null, 'user'),
    ).rejects.toThrow('gemini_empty_response');
  });

  it('undefined response text → throws gemini_empty_response', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    await expect(
      mod.analyzeFeedPostForRiskNetwork('contenido', null, 'user'),
    ).rejects.toThrow('gemini_empty_response');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// calculateStructuralLoad
// Returns string (Markdown). Guarded with try/catch.
// ─────────────────────────────────────────────────────────────────────────
describe('calculateStructuralLoad', () => {
  it('happy path: returns markdown string from model', async () => {
    const markdownResponse = '## Carga Segura\n**SWL**: 5 ton\nFactor de seguridad: 4';
    _generateContent.mockResolvedValueOnce({ text: markdownResponse });
    const result = await mod.calculateStructuralLoad('Eslinga de cadena', '16mm, acero inox');
    expect(typeof result).toBe('string');
    expect(result).toContain('SWL');
  });

  it('undefined model text → returns fallback "No se pudo..." string', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    const result = await mod.calculateStructuralLoad('e', 's');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('model throws → catch returns error string (never propagates)', async () => {
    _generateContent.mockRejectedValueOnce(new Error('Network error'));
    const result = await mod.calculateStructuralLoad('e', 's');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// generateModuleRecommendations
// JSON.parse in try/catch → null on error
// ─────────────────────────────────────────────────────────────────────────
describe('generateModuleRecommendations', () => {
  it('happy path: returns parsed recommendation object', async () => {
    const payload = {
      industryRelation: 'En construcción, el módulo IPER es base de toda gestión.',
      isoReference: 'ISO 45001:2018',
      recommendations: [
        { title: 'Actualizar IPER', description: 'Revisar matriz mensualmente.' },
      ],
      predictiveAlert: 'Alta frecuencia de caídas detectada.',
    };
    _generateContent.mockResolvedValueOnce({ text: JSON.stringify(payload) });
    const result = await mod.generateModuleRecommendations('IPER', 'construccion', 'ctx') as Record<string, unknown>;
    expect(result.isoReference).toBe('ISO 45001:2018');
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  it('malformed JSON → catch returns null', async () => {
    _generateContent.mockResolvedValueOnce({ text: 'BAD JSON' });
    const result = await mod.generateModuleRecommendations('m', 'i', 'c');
    expect(result).toBeNull();
  });

  it('model throws → catch returns null', async () => {
    _generateContent.mockRejectedValueOnce(new Error('Model unavailable'));
    const result = await mod.generateModuleRecommendations('m', 'i', 'c');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// generateExecutiveSummary
// Throws on empty response; JSON.parse UNGUARDED for bad JSON
// ─────────────────────────────────────────────────────────────────────────
describe('generateExecutiveSummary', () => {
  it('happy path: returns summary with nivelAlertaGlobal', async () => {
    const payload = {
      titulo: 'Resumen Ejecutivo Mayo 2026',
      resumen: 'La faena presenta indicadores dentro del rango aceptable...',
      nivelAlertaGlobal: 'Precaución',
      recomendacionesClave: ['Reforzar capacitaciones', 'Actualizar IPER'],
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.generateExecutiveSummary(
      { incidents: 3, openRisks: 12 },
      [{ type: 'risk', title: 'Caída', metadata: { status: 'open' } }],
    ) as Record<string, unknown>;
    expect(result.nivelAlertaGlobal).toBe('Precaución');
    expect(Array.isArray(result.recomendacionesClave)).toBe(true);
  });

  it('empty response text → throws gemini_empty_response', async () => {
    _generateContent.mockResolvedValueOnce({ text: '' });
    await expect(mod.generateExecutiveSummary({}, [])).rejects.toThrow('gemini_empty_response');
  });

  it('undefined response text → throws gemini_empty_response', async () => {
    _generateContent.mockResolvedValueOnce({ text: undefined });
    await expect(mod.generateExecutiveSummary({}, [])).rejects.toThrow('gemini_empty_response');
  });

  it('nodes array sliced to max 20 for context building', async () => {
    const manyNodes = Array.from({ length: 30 }, (_, i) => ({
      type: 'risk',
      title: `Riesgo ${i}`,
      metadata: { status: 'open' },
    }));
    const payload = { titulo: 'Resumen', resumen: 'Ok', nivelAlertaGlobal: 'Normal', recomendacionesClave: [] };
    mockResponse(JSON.stringify(payload));
    await mod.generateExecutiveSummary({}, manyNodes);
    expect(_generateContent).toHaveBeenCalledTimes(1);
    const callArgs = _generateContent.mock.calls[0][0] as { contents: string };
    expect(callArgs.contents).not.toContain('Riesgo 20');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// calculateComplianceSummary
// Uses parseGeminiJson
// ─────────────────────────────────────────────────────────────────────────
describe('calculateComplianceSummary', () => {
  it('happy path: returns globalScore + categories + criticalActions', async () => {
    const payload = {
      globalScore: 82,
      categories: [{ name: 'EPP', score: 90 }, { name: 'IPER', score: 74 }],
      criticalActions: ['Completar matriz IPER', 'Registrar capacitaciones'],
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.calculateComplianceSummary('proj-123', [
      { projectId: 'proj-123', type: 'risk', title: 'Ruido', metadata: { status: 'open' } },
    ]) as Record<string, unknown>;
    expect(result.globalScore).toBe(82);
    expect((result.categories as unknown[]).length).toBe(2);
  });

  it('filters nodes by projectId: only proj-A nodes in prompt', async () => {
    const payload = { globalScore: 55, categories: [], criticalActions: ['Revisar REBA'] };
    mockResponse(JSON.stringify(payload));
    await mod.calculateComplianceSummary('proj-A', [
      { projectId: 'proj-A', type: 'risk', title: 'Corte', metadata: {} },
      { projectId: 'proj-B', type: 'incident', title: 'Caída desde altura', metadata: {} },
    ]);
    expect(_generateContent).toHaveBeenCalledTimes(1);
    const callArgs = _generateContent.mock.calls[0][0] as { contents: string };
    expect(callArgs.contents).not.toContain('proj-B');
  });

  it('empty response → throws gemini_empty_response', async () => {
    mockResponse('');
    await expect(mod.calculateComplianceSummary('p', [])).rejects.toThrow('gemini_empty_response');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getNutritionSuggestion
// Uses parseGeminiJson
// ─────────────────────────────────────────────────────────────────────────
describe('getNutritionSuggestion', () => {
  it('happy path: returns suggestion + hydration + energy', async () => {
    const payload = {
      suggestion: 'Desayuno proteico: huevo + pan integral.',
      hydration: 'Tomar 500ml de agua antes de iniciar turno.',
      energy: 'Alta',
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.getNutritionSuggestion(4, 'Operador', 'Turno mañana excavadora') as Record<string, unknown>;
    expect(result.energy).toBe('Alta');
    expect(typeof result.suggestion).toBe('string');
  });

  it('mood=1 (Agotado) still resolves correctly', async () => {
    const payload = { suggestion: 'Avena con miel.', hydration: 'Electrolitos.', energy: 'Moderada' };
    mockResponse(JSON.stringify(payload));
    const result = await mod.getNutritionSuggestion(1) as Record<string, unknown>;
    expect(result.energy).toBe('Moderada');
  });

  it('empty response → throws gemini_empty_response', async () => {
    mockResponse('');
    await expect(mod.getNutritionSuggestion(3)).rejects.toThrow('gemini_empty_response');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// scanLegalUpdates
// Uses parseGeminiJson; normativeText sliced to 1500, modulesSummary to 800
// ─────────────────────────────────────────────────────────────────────────
describe('scanLegalUpdates', () => {
  it('happy path: returns affected modules + impact level', async () => {
    const payload = {
      affected: true,
      impactLevel: 'Alto',
      affectedModules: ['EPP', 'IPER', 'Capacitaciones'],
      summary: 'DS 44/2024 modifica artículos clave de EPP.',
      recommendedAction: 'Actualizar matriz EPP y capacitar supervisores.',
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.scanLegalUpdates('DS 44/2024', 'Texto extracto...', 'EPP, IPER, Capacitaciones') as Record<string, unknown>;
    expect(result.affected).toBe(true);
    expect(result.impactLevel).toBe('Alto');
    expect(Array.isArray(result.affectedModules)).toBe(true);
  });

  it('not affected: returns affected=false + Sin impacto', async () => {
    const payload = {
      affected: false, impactLevel: 'Sin impacto',
      affectedModules: [], summary: 'Sin impacto detectado.', recommendedAction: 'Ninguna.',
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.scanLegalUpdates('DS 78', 'texto', 'módulos') as Record<string, unknown>;
    expect(result.affected).toBe(false);
    expect(result.impactLevel).toBe('Sin impacto');
  });

  it('normativeText is sliced to 1500 chars in prompt', async () => {
    // Use a character that is extremely unlikely to appear elsewhere in the
    // Spanish prompt template. Uppercase Z is safe — not in normativa text.
    const longText = 'Z'.repeat(3000);
    const payload = { affected: false, impactLevel: 'Sin impacto', affectedModules: [], summary: '', recommendedAction: '' };
    mockResponse(JSON.stringify(payload));
    await mod.scanLegalUpdates('T', longText, 'M');
    const callArgs = _generateContent.mock.calls[0][0] as { contents: string };
    const zCount = (callArgs.contents.match(/Z/g) ?? []).length;
    // The prompt does `normativeText.slice(0, 1500)` so exactly 1500 Zs appear.
    expect(zCount).toBe(1500);
  });

  it('empty response → throws gemini_empty_response', async () => {
    mockResponse('');
    await expect(mod.scanLegalUpdates('t', 'text', 'mods')).rejects.toThrow('gemini_empty_response');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// forecastSafetyEvents
// ─────────────────────────────────────────────────────────────────────────
describe('forecastSafetyEvents', () => {
  it('happy path: returns pronostico semanal + diasCriticos', async () => {
    const payload = {
      pronosticoSemanal: 'Semana con riesgo moderado por lluvia.',
      diasCriticos: [{ dia: 'Lunes', nivelRiesgo: 'Alto', razon: 'Lluvia intensa' }],
      tendenciasDetectadas: ['Aumento de incidentes eléctricos'],
      recomendacionesEstrategicas: ['Revisar sistema de drenaje'],
    };
    mockResponse(JSON.stringify(payload));
    const result = await mod.forecastSafetyEvents('nodos-ctx', 'data-hist') as Record<string, unknown>;
    expect(result.pronosticoSemanal).toBeTruthy();
    expect(Array.isArray(result.diasCriticos)).toBe(true);
  });

  it('historicalData is optional → prompt includes default "No hay datos históricos" text', async () => {
    const payload = {
      pronosticoSemanal: 'Sin datos históricos, riesgo estándar.',
      diasCriticos: [], tendenciasDetectadas: [], recomendacionesEstrategicas: [],
    };
    mockResponse(JSON.stringify(payload));
    await mod.forecastSafetyEvents('ctx');
    expect(_generateContent).toHaveBeenCalledTimes(1);
    const callArgs = _generateContent.mock.calls[0][0] as { contents: string };
    expect(callArgs.contents).toContain('No hay datos históricos');
  });

  it('empty response → throws gemini_empty_response', async () => {
    mockResponse('');
    await expect(mod.forecastSafetyEvents('ctx')).rejects.toThrow('gemini_empty_response');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// No-API-key paths — dynamic re-import with key cleared
// ─────────────────────────────────────────────────────────────────────────
describe('no API_KEY early guards', () => {
  it('generateRealisticIoTEvent throws when key is missing', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    vi.resetModules();
    const noKeyMod = await import('./geminiBackend');
    await expect(noKeyMod.generateRealisticIoTEvent('ctx')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
    process.env.GEMINI_API_KEY = savedKey;
  });

  it('enrichNodeData returns original nodeData (no throw) when key is missing', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    vi.resetModules();
    const noKeyMod = await import('./geminiBackend');
    const nodeData = { title: 'T', description: 'D' };
    const result = await noKeyMod.enrichNodeData(nodeData);
    expect(result).toEqual(nodeData);
    process.env.GEMINI_API_KEY = savedKey;
  });

  it('generateOperationalTasks throws when key is missing', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    vi.resetModules();
    const noKeyMod = await import('./geminiBackend');
    await expect(noKeyMod.generateOperationalTasks('n', 'd')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
    process.env.GEMINI_API_KEY = savedKey;
  });
});
