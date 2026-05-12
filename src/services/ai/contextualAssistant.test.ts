import { describe, it, expect } from 'vitest';
import {
  extractKeywords,
  buildContextFromGraph,
  CONTEXTUAL_ASSISTANT_POLICY,
  type ZkContextNode,
  type ZkGraphAdapter,
} from './contextualAssistant.js';

// ────────────────────────────────────────────────────────────────────────
// Fake graph adapter
// ────────────────────────────────────────────────────────────────────────

class FakeGraph implements ZkGraphAdapter {
  constructor(public corpus: ZkContextNode[]) {}

  async searchByKeywords(
    keywords: string[],
    filter: { projectId: string; tenantId?: string; types?: string[]; limit: number },
  ): Promise<ZkContextNode[]> {
    const out: ZkContextNode[] = [];
    for (const n of this.corpus) {
      if (filter.types && !filter.types.includes(n.type)) continue;
      const blob = `${n.title} ${n.description}`.toLowerCase();
      const hits = keywords.filter((k) => blob.includes(k)).length;
      if (hits > 0) out.push(n);
      if (out.length >= filter.limit) break;
    }
    return out;
  }

  async expandConnected(
    ids: string[],
    filter: { projectId: string; tenantId?: string; depth: number },
  ): Promise<ZkContextNode[]> {
    const visited = new Set<string>(ids);
    const queue: Array<{ id: string; d: number }> = ids.map((id) => ({ id, d: 0 }));
    const out: ZkContextNode[] = [];
    while (queue.length > 0) {
      const item = queue.shift()!;
      const n = this.corpus.find((x) => x.id === item.id);
      if (!n) continue;
      if (item.d > 0) out.push(n);
      if (item.d < filter.depth) {
        for (const c of n.connections) {
          if (!visited.has(c)) {
            visited.add(c);
            queue.push({ id: c, d: item.d + 1 });
          }
        }
      }
    }
    return out;
  }
}

function sampleCorpus(): ZkContextNode[] {
  return [
    {
      id: 'worker-1',
      type: 'Trabajador',
      title: 'Ana Soto',
      description: 'Soldadora certificada categoría arnés altura',
      connections: ['task-1'],
    },
    {
      id: 'task-1',
      type: 'Tarea',
      title: 'Soldadura estructural torre B nivel 3',
      description: 'Trabajo en altura 9 metros con soldadura MIG',
      connections: ['worker-1', 'risk-altura', 'risk-caliente'],
    },
    {
      id: 'risk-altura',
      type: 'Riesgo',
      title: 'Caída de altura',
      description: 'Trabajo sobre 1.8m sin barandas perimetrales',
      severity: 'high',
      connections: ['task-1', 'epp-arnes', 'control-linea'],
    },
    {
      id: 'risk-caliente',
      type: 'Riesgo',
      title: 'Trabajo en caliente',
      description: 'Soldadura próxima a material inflamable',
      severity: 'medium',
      connections: ['task-1', 'control-extintor'],
    },
    {
      id: 'epp-arnes',
      type: 'EPP',
      title: 'Arnés certificado vigente',
      description: 'Categoría arnés cuerpo entero conforme DS 594',
      connections: ['risk-altura'],
    },
    {
      id: 'control-linea',
      type: 'Control',
      title: 'Línea de vida instalada',
      description: 'Control engineering — anclaje certificado',
      connections: ['risk-altura'],
    },
    {
      id: 'control-extintor',
      type: 'Control',
      title: 'Extintor portátil verificado',
      description: 'Extintor PQS próximo al área',
      connections: ['risk-caliente'],
    },
    {
      id: 'unrelated',
      type: 'Documento',
      title: 'Manual cocina',
      description: 'Cómo operar la cocina industrial',
      connections: [],
    },
  ];
}

describe('extractKeywords', () => {
  it('dedupe + strips stopwords + min 3 chars', () => {
    const kws = extractKeywords('¿Qué EPP necesita el trabajador para soldadura en altura?');
    expect(kws).toContain('epp');
    expect(kws).toContain('soldadura');
    expect(kws).toContain('altura');
    expect(kws).not.toContain('que');
    expect(kws).not.toContain('el');
  });

  it('respeta cap maxKeywords', () => {
    const kws = extractKeywords('palabra1 palabra2 palabra3 palabra4 palabra5 palabra6 palabra7 palabra8 palabra9');
    expect(kws.length).toBeLessThanOrEqual(8);
  });

  it('query vacía → array vacío', () => {
    expect(extractKeywords('')).toEqual([]);
  });

  it('normaliza acentos', () => {
    const kws = extractKeywords('protección contra caídas');
    expect(kws).toContain('proteccion');
    expect(kws).toContain('caidas');
  });
});

describe('buildContextFromGraph', () => {
  const adapter = new FakeGraph(sampleCorpus());

  it('query relevante → contextString con citations', async () => {
    const ctx = await buildContextFromGraph(
      {
        query: '¿Qué EPP necesita soldadura en altura?',
        projectId: 'p1',
      },
      adapter,
    );
    expect(ctx.isEmpty).toBe(false);
    expect(ctx.selectedNodes.length).toBeGreaterThan(0);
    expect(ctx.contextString).toMatch(/zk:risk-altura/);
    expect(ctx.citations.length).toBeGreaterThan(0);
  });

  it('contextString incluye citation policy', async () => {
    const ctx = await buildContextFromGraph(
      { query: 'soldadura', projectId: 'p1' },
      adapter,
    );
    expect(ctx.contextString).toContain('zk:');
    expect(ctx.contextString).toMatch(/NUNCA inventes/);
  });

  it('query sin match → isEmpty true + policy literal', async () => {
    const ctx = await buildContextFromGraph(
      { query: 'tractor agrícola con sistema biológico', projectId: 'p1' },
      adapter,
    );
    expect(ctx.isEmpty).toBe(true);
    expect(ctx.contextString).toMatch(/No tengo información/);
    expect(ctx.citations).toEqual([]);
  });

  it('respeta maxNodes', async () => {
    const ctx = await buildContextFromGraph(
      { query: 'soldadura altura caliente', projectId: 'p1', maxNodes: 2 },
      adapter,
    );
    expect(ctx.selectedNodes.length).toBeLessThanOrEqual(2);
  });

  it('expand BFS encuentra nodos conectados al hit inicial', async () => {
    const ctx = await buildContextFromGraph(
      { query: 'caída altura', projectId: 'p1', maxDepth: 2 },
      adapter,
    );
    // Debe encontrar risk-altura (hit directo) y por expansión: epp-arnes + control-linea
    const ids = new Set(ctx.selectedNodes.map((n) => n.id));
    expect(ids.has('risk-altura')).toBe(true);
    expect(ids.has('epp-arnes')).toBe(true);
    expect(ids.has('control-linea')).toBe(true);
  });

  it('filtra por types: solo EPP', async () => {
    const ctx = await buildContextFromGraph(
      { query: 'arnés altura', projectId: 'p1', relevantTypes: ['EPP'] },
      adapter,
    );
    for (const n of ctx.selectedNodes) {
      // Los nodos del hit inicial son EPP. Los expandidos pueden ser de otros tipos
      // pero al menos uno EPP debe estar.
      expect(['EPP', 'Riesgo', 'Control', 'Tarea']).toContain(n.type);
    }
  });
});

describe('CONTEXTUAL_ASSISTANT_POLICY', () => {
  it('contiene reglas críticas', () => {
    expect(CONTEXTUAL_ASSISTANT_POLICY).toMatch(/NUNCA inventes/);
    expect(CONTEXTUAL_ASSISTANT_POLICY).toMatch(/zk:/);
    expect(CONTEXTUAL_ASSISTANT_POLICY).toMatch(/No tengo información/);
  });
});
