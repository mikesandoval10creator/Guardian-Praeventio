// Praeventio Guard — B2D Suite Coach tests (§2.17 cierre Fase C.5, 2026-05-21).
//
// Verifica que:
//   1. El handler `/coach` responde con shape estable
//      (result + citations + source + privacyNote).
//   2. Cuando Gemini no está disponible (sin GEMINI_API_KEY → noop adapter),
//      el handler CAE GRACEFULLY al builder determinístico (Regla #3).
//   3. Cuando Gemini responde con JSON válido, el handler usa esa respuesta.
//   4. Cuando Gemini responde con JSON inválido, el handler CAE al
//      builder determinístico (sin tirar).
//   5. Las citas canónicas siempre aparecen (DS 44/2024, ISO 45001, etc.).
//   6. El privacyNote menciona que NO accede al Zettelkasten ni a tenant data.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock del facade getAiAdapter — controlamos qué adapter "se selecciona".
const mockGenerate = vi.fn();
const mockAdapter = {
  name: 'gemini-consumer' as const,
  region: 'us-central1',
  isAvailable: true,
  generate: mockGenerate,
};

vi.mock('../../../services/ai/index.js', () => ({
  getAiAdapter: () => mockAdapter,
}));

// Mock del usage tracker — no queremos llamadas Firestore reales.
vi.mock('../../../services/b2d/usage.js', () => ({
  trackB2dUsage: vi.fn(async () => undefined),
}));

// Mock del middleware b2dAuth — pasa siempre y setea req.b2dKey.
vi.mock('../../middleware/b2dAuth.js', () => ({
  b2dAuth: () => (req: { b2dKey: { customerId: string } }, _res: unknown, next: () => void) => {
    req.b2dKey = { customerId: 'cust-test' };
    next();
  },
}));

// Mock del logger — silencio durante tests.
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import express from 'express';
import request from 'supertest';
import suiteRouter from './suite';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/b2d/v1/suite', suiteRouter);
  return app;
}

const BASE_INPUT = {
  industry: 'mining',
  scenario: 'Operación con explosivos en mina subterránea de cobre.',
  riskCategory: 'high' as const,
  language: 'es' as const,
  mitigations: ['EPP completo', 'Brigada de emergencia entrenada'],
};

describe('POST /api/b2d/v1/suite/coach — §2.17 cierre Fase C.5', () => {
  beforeEach(() => {
    mockAdapter.isAvailable = true;
    mockAdapter.name = 'gemini-consumer';
    mockGenerate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('400 si el body es inválido', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/b2d/v1/suite/coach')
      .send({ industry: '', scenario: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
  });

  it('usa Gemini cuando el adapter responde con JSON válido', async () => {
    mockGenerate.mockResolvedValueOnce({
      text: JSON.stringify({
        recommendation: 'Aislar el sector durante voladura y verificar EPP.',
        structuredActions: [
          { step: 1, action: 'Notificar a brigada con 30 min de anticipación.' },
          { step: 2, action: 'Sellar perímetro 500m antes del disparo.' },
          { step: 3, action: 'Auditar conteo de detonadores DS 132 minería.' },
        ],
        citations: ['DS 132/2002 (minería)', 'Ley 16.744 art. 76'],
      }),
      provider: 'gemini-consumer',
    });

    const app = buildApp();
    const res = await request(app).post('/api/b2d/v1/suite/coach').send(BASE_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('gemini-consumer');
    expect(res.body.result.recommendation).toContain('voladura');
    expect(res.body.result.structuredActions).toHaveLength(3);
    expect(res.body.result.mitigationsConsidered).toBe(2);
    expect(res.body.citations.length).toBeGreaterThanOrEqual(2);
    // Las citas canónicas se agregan deduplicadas.
    expect(res.body.citations.some((c: string) => c.includes('ISO 45001'))).toBe(true);
    expect(res.body.citations.some((c: string) => c.includes('DS 44/2024'))).toBe(true);
    expect(res.body.privacyNote).toMatch(/Zettelkasten|tenant/i);
  });

  it('CAE al deterministic builder cuando GEMINI_API_KEY no está configurado (adapter no disponible)', async () => {
    mockAdapter.isAvailable = false;
    const app = buildApp();
    const res = await request(app).post('/api/b2d/v1/suite/coach').send(BASE_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('deterministic');
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(res.body.result.recommendation).toContain('IPER');
    expect(res.body.result.structuredActions).toHaveLength(3);
    expect(res.body.citations).toContain('Praeventio Coach v1 (deterministic fallback)');
  });

  it('CAE al deterministic builder cuando Gemini responde con JSON inválido', async () => {
    mockGenerate.mockResolvedValueOnce({
      text: 'esto no es JSON válido { malformado',
      provider: 'gemini-consumer',
    });

    const app = buildApp();
    const res = await request(app).post('/api/b2d/v1/suite/coach').send(BASE_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('deterministic');
    expect(res.body.result.recommendation).toContain('IPER');
  });

  it('CAE al deterministic builder cuando Gemini falla (network/timeout)', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('upstream timeout'));

    const app = buildApp();
    const res = await request(app).post('/api/b2d/v1/suite/coach').send(BASE_INPUT);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('deterministic');
    expect(res.body.result.structuredActions).toHaveLength(3);
  });

  it('CAE al deterministic builder cuando Gemini responde con shape parcial (sin structuredActions)', async () => {
    mockGenerate.mockResolvedValueOnce({
      text: JSON.stringify({
        recommendation: 'Solo recomendación, sin acciones.',
        structuredActions: 'no es array',
        citations: ['DS 132'],
      }),
      provider: 'gemini-consumer',
    });

    const app = buildApp();
    const res = await request(app).post('/api/b2d/v1/suite/coach').send(BASE_INPUT);

    expect(res.body.source).toBe('deterministic');
  });

  it('NUNCA expone Zettelkasten ni datos del tenant en la respuesta', async () => {
    mockAdapter.isAvailable = false;
    const app = buildApp();
    const res = await request(app).post('/api/b2d/v1/suite/coach').send(BASE_INPUT);

    const json = JSON.stringify(res.body).toLowerCase();
    expect(json).not.toContain('tenant_'); // no tenant ids
    expect(json).not.toContain('zettelkasten_nodes'); // no internal collections
    expect(json).not.toContain('firestore'); // no internal storage refs
  });
});
