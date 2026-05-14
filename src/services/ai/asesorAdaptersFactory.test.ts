import { describe, it, expect, vi } from 'vitest';
import {
  buildAsesorAdapters,
  buildHybridSeedNodes,
  buildSeedOnlyAdapters,
} from './asesorAdaptersFactory';
import { answer } from './resilientAiOrchestrator';
import { SEED_NODES } from '../zettelkasten/resilientRetrieval';

describe('buildAsesorAdapters', () => {
  it('sin contexts: SLM + Zettelkasten (seed) siempre disponibles', () => {
    const a = buildAsesorAdapters({});
    expect(a.slm).toBeDefined();
    expect(a.zettelkasten).toBeDefined();
    expect(a.firestore).toBeUndefined();
    expect(a.gemini).toBeUndefined();
  });

  it('con searchFirestoreKnowledge: agrega firestore tier', () => {
    const a = buildAsesorAdapters({
      searchFirestoreKnowledge: async () => [],
    });
    expect(a.firestore).toBeDefined();
  });

  it('con callGeminiServer: agrega gemini tier', () => {
    const a = buildAsesorAdapters({
      callGeminiServer: async () => ({ text: 'ok' }),
    });
    expect(a.gemini).toBeDefined();
  });

  it('todos los context provistos: todos los tiers disponibles', () => {
    const a = buildAsesorAdapters({
      zkNodes: [],
      searchFirestoreKnowledge: async () => [],
      callGeminiServer: async () => ({ text: 'ok' }),
    });
    expect(a.slm).toBeDefined();
    expect(a.zettelkasten).toBeDefined();
    expect(a.firestore).toBeDefined();
    expect(a.gemini).toBeDefined();
  });

  it('integration: memory ZK source responde con tenant nodes antes que seed', async () => {
    const a = buildAsesorAdapters({
      zkNodes: [
        {
          id: 'tenant-node-1',
          type: 'PROCEDURE',
          title: 'Procedimiento custom mineria',
          description: 'Aprieta el botón rojo de la consola minera',
          tags: ['mineria', 'sos'],
        },
      ],
    });
    // Solo el tier zettelkasten (sin slm para forzar el path).
    const r = await answer(
      { prompt: 'sos', domain: 'emergency' },
      { zettelkasten: a.zettelkasten },
    );
    expect(r.tier).toBe('zettelkasten');
    expect(r.text).toContain('Procedimiento custom mineria');
  });

  it('integration: sin tenant nodes, ZK fallback al seed bundle chileno', async () => {
    const a = buildAsesorAdapters({});
    const r = await answer(
      { prompt: 'samu', domain: 'emergency' },
      { zettelkasten: a.zettelkasten },
    );
    expect(r.tier).toBe('zettelkasten');
    // El seed bundle tiene un nodo de SAMU.
    expect(r.text.toLowerCase()).toContain('samu');
  });

  it('integration: caller callGeminiServer recibe prompt + context', async () => {
    const spy = vi.fn(async () => ({ text: 'respuesta gemini' }));
    const a = buildAsesorAdapters({
      callGeminiServer: spy,
    });
    const r = await answer(
      { prompt: 'consulta', context: { projectId: 'p1' } },
      // Solo gemini para forzar el path
      { gemini: a.gemini },
    );
    expect(r.tier).toBe('gemini');
    expect(spy).toHaveBeenCalledWith('consulta', { projectId: 'p1' });
  });

  it('integration: searchFirestoreKnowledge recibe keyword', async () => {
    const spy = vi.fn(async () => [
      { id: 'doc-1', title: 'Doc', content: 'contenido' },
    ]);
    const a = buildAsesorAdapters({
      searchFirestoreKnowledge: spy,
    });
    const r = await answer(
      { prompt: '¿qué dice DS 594?' },
      { firestore: a.firestore },
    );
    expect(r.tier).toBe('firestore');
    expect(spy).toHaveBeenCalledWith('¿qué dice DS 594?');
    expect(r.text).toContain('Doc');
  });
});

describe('buildHybridSeedNodes', () => {
  it('mezcla tenant + seed, tenant primero', () => {
    const tenantNodes = [
      { id: 'tn-1', type: 'PROCEDURE', label: 'Mi procedimiento' },
    ];
    const hybrid = buildHybridSeedNodes(tenantNodes);
    expect(hybrid[0]).toEqual(tenantNodes[0]);
    expect(hybrid.length).toBe(1 + SEED_NODES.length);
  });

  it('tenant nodes vacíos: solo seed', () => {
    const hybrid = buildHybridSeedNodes([]);
    expect(hybrid.length).toBe(SEED_NODES.length);
  });
});

describe('buildSeedOnlyAdapters', () => {
  it('solo zettelkasten adapter — sin slm/firestore/gemini', () => {
    const a = buildSeedOnlyAdapters();
    expect(a.slm).toBeUndefined();
    expect(a.firestore).toBeUndefined();
    expect(a.gemini).toBeUndefined();
    expect(a.zettelkasten).toBeDefined();
  });

  it('integration: responde solo desde el seed', async () => {
    const a = buildSeedOnlyAdapters();
    const r = await answer(
      { prompt: 'samu', domain: 'emergency' },
      a,
    );
    expect(r.tier).toBe('zettelkasten');
    expect(r.text.toLowerCase()).toContain('samu');
  });

  it('integration: prompt no matcheable → canned fallback', async () => {
    const a = buildSeedOnlyAdapters();
    const r = await answer(
      { prompt: 'palabra-imposible-zzzzz', domain: 'general' },
      a,
    );
    expect(r.tier).toBe('canned');
  });
});
