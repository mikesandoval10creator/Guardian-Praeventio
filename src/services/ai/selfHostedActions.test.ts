// Unit tests for the self-hosted per-action prompt builders.
//
// These specs are documented MIRRORS of the Gemini handlers in
// src/services/gemini/chat.ts — the tests pin the load-bearing parts of each
// prompt (anti-hallucination rules, <user_input> injection guard, PII
// redaction seam, RAG context inclusion, detail/domain steering) so a drift
// or regression in the mirror is caught without calling any model.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  searchRelevantContext: vi.fn(async (_query: string) => 'CONTEXTO-RAG-DS594'),
  redact: vi.fn((prompt: string, _action: string) => prompt.replace(/12\.345\.678-K/g, '[RUT]')),
}));

vi.mock('../ragService.js', () => ({
  searchRelevantContext: (query: string) => H.searchRelevantContext(query),
}));
vi.mock('../gemini/_shared.js', () => ({
  redactPromptForVertex: (prompt: string, action: string) => H.redact(prompt, action),
}));
// chat.ts pulls @google/genai + Sentry; only its pure helper is needed here.
vi.mock('../gemini/chat.js', () => ({
  asesorDomainFocus: (domain: string) => `ENFOQUE-MOCK:${domain}`,
}));

import { SELF_HOSTED_ACTION_SPECS } from './selfHostedActions.js';

beforeEach(() => {
  H.searchRelevantContext.mockClear().mockResolvedValue('CONTEXTO-RAG-DS594');
  H.redact.mockClear();
});

describe('getChatResponse spec', () => {
  it('mirrors the handler: system prompt with domain focus, detail level, contexts; <user_input> wrapping; history mapped', async () => {
    const req = await SELF_HOSTED_ACTION_SPECS.getChatResponse.build([
      '¿Cómo controlo el riesgo de sílice?',
      'NODOS-DEL-PROYECTO',
      [
        { role: 'user', content: 'hola' },
        { role: 'model', content: 'buenas' },
      ],
      2,
      'sst',
    ]);

    expect(req.systemInstruction).toContain('El Guardián');
    expect(req.systemInstruction).toContain('ENFOQUE-MOCK:sst');
    expect(req.systemInstruction).toContain('NIVEL DE DETALLE SOLICITADO: 2 de 3');
    expect(req.systemInstruction).toContain('NODOS-DEL-PROYECTO');
    expect(req.systemInstruction).toContain('CONTEXTO-RAG-DS594');
    expect(req.systemInstruction).toContain('NO ALUCINES LEYES');
    // Prompt-injection guard: user text stays inside the delimiters.
    expect(req.prompt).toContain('<user_input>');
    expect(req.prompt).toContain('¿Cómo controlo el riesgo de sílice?');
    // History roles map user/model → user/assistant.
    expect(req.history).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'buenas' },
    ]);
  });

  it('redacts PII in the message and history (Ley 21.719 seam)', async () => {
    const req = await SELF_HOSTED_ACTION_SPECS.getChatResponse.build([
      'El RUT del trabajador es 12.345.678-K',
      '',
      [{ role: 'user', content: 'su RUT 12.345.678-K' }],
    ]);
    expect(req.prompt).toContain('[RUT]');
    expect(req.prompt).not.toContain('12.345.678-K');
    expect(req.history?.[0]?.content).toBe('su RUT [RUT]');
  });

  it('defaults: detail 1, domain general, malformed history filtered out', async () => {
    const req = await SELF_HOSTED_ACTION_SPECS.getChatResponse.build([
      'pregunta',
      'ctx',
      [null, 42, { role: 'user' }],
      99, // out of range → 1
      'dominio-inventado', // unknown → general
    ]);
    expect(req.systemInstruction).toContain('NIVEL DE DETALLE SOLICITADO: 1 de 3');
    expect(req.systemInstruction).toContain('ENFOQUE-MOCK:general');
    expect(req.history).toEqual([]);
  });

  it('a RAG outage degrades to a placeholder context — never throws', async () => {
    H.searchRelevantContext.mockRejectedValue(new Error('firestore down'));
    const req = await SELF_HOSTED_ACTION_SPECS.getChatResponse.build(['pregunta', '']);
    expect(req.systemInstruction).toContain('No se encontró contexto legal relevante.');
  });
});

describe('queryBCN spec', () => {
  it('mirrors the strict normative prompt: RAG context + anti-hallucination + temperature 0.1', async () => {
    const req = await SELF_HOSTED_ACTION_SPECS.queryBCN.build(['¿Qué exige el DS 594?']);
    expect(H.searchRelevantContext).toHaveBeenCalledWith('¿Qué exige el DS 594?');
    expect(req.prompt).toContain('CONTEXTO-RAG-DS594');
    expect(req.prompt).toContain('NO ALUCINES');
    expect(req.prompt).toContain('¿Qué exige el DS 594?');
    expect(req.systemInstruction).toContain('experto legal estricto');
    expect(req.temperature).toBe(0.1);
  });
});

describe('getSafetyAdvice spec', () => {
  it('mirrors the weather-advice prompt (max 100 chars instruction + values)', async () => {
    const req = await SELF_HOSTED_ACTION_SPECS.getSafetyAdvice.build([
      { temp: 34, uv: 9, airQuality: 75 },
    ]);
    expect(req.prompt).toContain('máximo 100 caracteres');
    expect(req.prompt).toContain('34°C');
    expect(req.prompt).toContain('UV: 9');
    expect(req.prompt).toContain('75');
    expect(req.systemInstruction).toContain('prevención de riesgos laborales');
  });

  it('tolerates a missing weather payload', async () => {
    const req = await SELF_HOSTED_ACTION_SPECS.getSafetyAdvice.build([]);
    expect(req.prompt).toContain('n/d');
    expect(req.prompt).toContain('no disponible');
  });
});
