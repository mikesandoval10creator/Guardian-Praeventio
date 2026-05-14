import { describe, it, expect, vi } from 'vitest';
import {
  answer,
  answerEmergency,
  detectDomain,
  type OrchestratorAdapters,
  type TierAdapter,
  type AiQuery,
} from './resilientAiOrchestrator';

function ok(text: string, confidence = 0.9): TierAdapter {
  return async () => ({ text, confidence, citations: [] });
}

function fail(message = 'boom'): TierAdapter {
  return async () => {
    throw new Error(message);
  };
}

function nullish(): TierAdapter {
  return async () => null;
}

const baseQuery: AiQuery = { prompt: 'Cómo activo el SOS?' };

describe('resilientAiOrchestrator.answer', () => {
  it('tier 1 (SLM) responde: tier=slm, degraded=false', async () => {
    const adapters: OrchestratorAdapters = {
      slm: ok('Aprieta el botón rojo en pantalla.', 0.95),
    };
    const r = await answer(baseQuery, adapters);
    expect(r.tier).toBe('slm');
    expect(r.degraded).toBe(false);
    expect(r.confidence).toBe(0.95);
    expect(r.tierErrors).toEqual([]);
  });

  it('SLM falla → cae a Zettelkasten: degraded=true', async () => {
    const adapters: OrchestratorAdapters = {
      slm: fail('OOM iOS Safari'),
      zettelkasten: ok('Según nodo SOS-001: aprieta el botón rojo.', 0.7),
    };
    const r = await answer(baseQuery, adapters);
    expect(r.tier).toBe('zettelkasten');
    expect(r.degraded).toBe(true);
    expect(r.tierErrors).toHaveLength(1);
    expect(r.tierErrors[0]!.tier).toBe('slm');
    expect(r.tierErrors[0]!.error).toContain('OOM');
  });

  it('SLM + ZK fallan → cae a Firestore', async () => {
    const adapters: OrchestratorAdapters = {
      slm: fail(),
      zettelkasten: fail(),
      firestore: ok('Procedimiento FAQ: aprieta el botón.', 0.5),
    };
    const r = await answer(baseQuery, adapters);
    expect(r.tier).toBe('firestore');
    expect(r.tierErrors).toHaveLength(2);
  });

  it('todos los tiers fallan → canned fallback', async () => {
    const adapters: OrchestratorAdapters = {
      slm: fail(),
      zettelkasten: fail(),
      firestore: fail(),
      gemini: fail('no network'),
    };
    const r = await answer({ ...baseQuery, domain: 'emergency' }, adapters);
    expect(r.tier).toBe('canned');
    expect(r.degraded).toBe(true);
    expect(r.text).toContain('EMERGENCIA');
    expect(r.tierErrors).toHaveLength(4);
  });

  it('tier que devuelve null se trata como falla', async () => {
    const adapters: OrchestratorAdapters = {
      slm: nullish(),
      zettelkasten: ok('respuesta ZK', 0.6),
    };
    const r = await answer(baseQuery, adapters);
    expect(r.tier).toBe('zettelkasten');
    expect(r.tierErrors[0]!.error).toContain('returned null');
  });

  it('tier sin adapter se salta limpiamente', async () => {
    const adapters: OrchestratorAdapters = {
      zettelkasten: ok('solo ZK disponible', 0.5),
    };
    const r = await answer(baseQuery, adapters);
    expect(r.tier).toBe('zettelkasten');
    expect(r.tierErrors[0]!.error).toContain('no adapter');
  });

  it('timeout por tier: cae al siguiente', async () => {
    const slowSlm: TierAdapter = () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ text: 'tarde', confidence: 0.9 }), 5000),
      );
    const adapters: OrchestratorAdapters = {
      slm: slowSlm,
      zettelkasten: ok('rápido ZK', 0.5),
    };
    const r = await answer(baseQuery, adapters, { tierTimeoutMs: 50 });
    expect(r.tier).toBe('zettelkasten');
    expect(r.tierErrors[0]!.error).toContain('timeout');
  });

  it('citations propagadas desde el adapter', async () => {
    const adapters: OrchestratorAdapters = {
      slm: async () => ({
        text: 'respuesta',
        confidence: 0.9,
        citations: [
          { kind: 'normative', ref: 'DS-594', label: 'DS 594 Art. 36' },
          { kind: 'node', ref: 'node-123' },
        ],
      }),
    };
    const r = await answer(baseQuery, adapters);
    expect(r.citations).toHaveLength(2);
    expect(r.citations[0]!.kind).toBe('normative');
  });

  it('allowedTiers restringe la cadena', async () => {
    const adapters: OrchestratorAdapters = {
      slm: fail(),
      zettelkasten: ok('ZK', 0.6),
      firestore: ok('FS', 0.5),
      gemini: ok('GM', 0.7),
    };
    const r = await answer(baseQuery, adapters, {
      allowedTiers: ['slm', 'zettelkasten'], // skip firestore + gemini
    });
    expect(r.tier).toBe('zettelkasten');
  });

  it('allowedTiers con todos fallando → canned (incluso si firestore tenía respuesta)', async () => {
    const adapters: OrchestratorAdapters = {
      slm: fail(),
      zettelkasten: fail(),
      firestore: ok('FS habría respondido', 0.5),
    };
    const r = await answer({ ...baseQuery, domain: 'epp' }, adapters, {
      allowedTiers: ['slm', 'zettelkasten'], // firestore deshabilitado
    });
    expect(r.tier).toBe('canned');
    expect(r.text).toContain('EPP');
  });

  it('latencyMs se incluye', async () => {
    let t = 1000;
    const adapters: OrchestratorAdapters = { slm: ok('rápido') };
    const r = await answer(baseQuery, adapters, {
      nowMs: () => {
        const v = t;
        t += 100;
        return v;
      },
    });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('answerEmergency', () => {
  it('solo intenta SLM + Zettelkasten, NUNCA Gemini/Firestore', async () => {
    const adapters: OrchestratorAdapters = {
      slm: fail(),
      zettelkasten: fail(),
      firestore: ok('NO debería tocarme', 0.9),
      gemini: ok('NO debería tocarme', 0.9),
    };
    const r = await answerEmergency(
      { prompt: 'me caí', domain: 'emergency' },
      adapters,
    );
    expect(r.tier).toBe('canned');
    expect(r.tierErrors.map((e) => e.tier).sort()).toEqual([
      'slm',
      'zettelkasten',
    ]);
  });

  it('timeout default agresivo (3000ms)', async () => {
    const slow: TierAdapter = () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ text: 'tarde', confidence: 0.9 }), 10000),
      );
    const adapters: OrchestratorAdapters = { slm: slow };
    const start = Date.now();
    const r = await answerEmergency(
      { prompt: 'sos', domain: 'emergency' },
      adapters,
      { tierTimeoutMs: 50 }, // override aún más rápido para test
    );
    const elapsed = Date.now() - start;
    expect(r.tier).toBe('canned');
    // El test es indicativo — verifica que NO esperó los 10s del slow.
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('detectDomain', () => {
  it('palabras de emergencia → emergency', () => {
    expect(detectDomain('me caí del andamio')).toBe('emergency');
    expect(detectDomain('alguien está sangrando')).toBe('emergency');
    expect(detectDomain('incendio en sector C')).toBe('emergency');
  });

  it('EPP keywords', () => {
    expect(detectDomain('necesito casco?')).toBe('epp');
    expect(detectDomain('falta arnés')).toBe('epp');
  });

  it('médico keywords', () => {
    expect(detectDomain('cómo declaro DIAT?')).toBe('medical');
    expect(detectDomain('examen ocupacional')).toBe('medical');
  });

  it('normativa keywords', () => {
    expect(detectDomain('qué dice el DS 594?')).toBe('normative');
    expect(detectDomain('Ley 16744 art. 8')).toBe('normative');
  });

  it('training keywords', () => {
    expect(detectDomain('mi capacitación ODI vence?')).toBe('training');
  });

  it('maintenance keywords', () => {
    expect(detectDomain('horómetro del cargador')).toBe('maintenance');
    expect(detectDomain('mantencion preventiva')).toBe('maintenance');
  });

  it('fallback a general', () => {
    expect(detectDomain('hola, cómo estás?')).toBe('general');
  });
});
