import { describe, it, expect, vi } from 'vitest';
import {
  buildAsesorAdapters,
  buildHybridSeedNodes,
  buildSeedOnlyAdapters,
} from './asesorAdaptersFactory';
import { answer } from './resilientAiOrchestrator';
import { SEED_NODES } from '../zettelkasten/resilientRetrieval';

describe('buildAsesorAdapters', () => {
  it('sin contexts: SLM + Zettelkasten (seed) + Gemini default siempre disponibles', () => {
    const a = buildAsesorAdapters({});
    expect(a.slm).toBeDefined();
    expect(a.zettelkasten).toBeDefined();
    expect(a.firestore).toBeUndefined();
    // B14: el tier Gemini ya no requiere caller custom — default
    // contra /api/ask-guardian para que el panel del shell tenga
    // calidad online sin wiring extra.
    expect(a.gemini).toBeDefined();
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

// ────────────────────────────────────────────────────────────────────────
// B14 — default Gemini caller contra /api/ask-guardian
// ────────────────────────────────────────────────────────────────────────
vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

describe('callAskGuardianServer (B14 default Gemini caller)', () => {
  it('POSTea el prompt con auth headers y mapea {response}', async () => {
    const { callAskGuardianServer } = await import('./asesorAdaptersFactory');
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: 'respuesta del guardián' }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const r = await callAskGuardianServer('¿qué dice el DS 44?');
      expect(r.text).toBe('respuesta del guardián');
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/ask-guardian',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
          body: JSON.stringify({ query: '¿qué dice el DS 44?' }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lanza en non-2xx para que el orchestrator caiga al siguiente tier', async () => {
    const { callAskGuardianServer } = await import('./asesorAdaptersFactory');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    try {
      await expect(callAskGuardianServer('x')).rejects.toThrow(/503/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lanza en body vacío — nunca entrega respuesta vacía como éxito', async () => {
    const { callAskGuardianServer } = await import('./asesorAdaptersFactory');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    );
    try {
      await expect(callAskGuardianServer('x')).rejects.toThrow(/empty/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
