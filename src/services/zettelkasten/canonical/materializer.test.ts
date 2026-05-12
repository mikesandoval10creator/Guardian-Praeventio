import { describe, it, expect } from 'vitest';
import {
  materializeNode,
  dematerializeNode,
  bernoulliTypeToCanonicalNodeType,
  canonicalNodePath,
  parseCanonicalNodePath,
  materializeBatch,
  type MaterializeInput,
} from './materializer.js';
import type { RiskNodePayload } from '../types.js';

const NOW = new Date('2026-05-12T12:00:00Z');

function samplePayload(over: Partial<RiskNodePayload> = {}): RiskNodePayload {
  return {
    title: 'Andamio con uplift',
    description: 'Carga viento 38 km/h supera umbral 30 km/h.',
    type: 'scaffold-uplift',
    severity: 'high',
    metadata: { windSpeedKmh: 38, threshold: 30 },
    connections: ['proj-1', 'sensor-NE'],
    references: ['NCh 997', 'OSHA 1926.451'],
    ...over,
  };
}

describe('bernoulliTypeToCanonicalNodeType', () => {
  it('mapea scaffold-uplift → Riesgo', () => {
    expect(bernoulliTypeToCanonicalNodeType('scaffold-uplift')).toBe('Riesgo');
  });
  it('mapea safety-learning → Lección Aprendida', () => {
    expect(bernoulliTypeToCanonicalNodeType('safety-learning')).toBe('Lección Aprendida');
  });
  it('default = Riesgo para tipos desconocidos', () => {
    expect(bernoulliTypeToCanonicalNodeType('unknown-gen-xyz')).toBe('Riesgo');
  });
});

describe('materializeNode', () => {
  it('preserva título, descripción y conexiones', () => {
    const node = materializeNode({
      zkNodeId: 'zk-abc',
      payload: samplePayload(),
      projectId: 'proj-1',
      tenantId: 'tenant-A',
      now: NOW,
    });
    expect(node.title).toBe('Andamio con uplift');
    expect(node.connections).toEqual(['proj-1', 'sensor-NE']);
    expect(node.type).toBe('Riesgo');
  });

  it('preserva severity en doc + tag sev:*', () => {
    const node = materializeNode({
      zkNodeId: 'zk-abc',
      payload: samplePayload(),
      projectId: 'proj-1',
      now: NOW,
    });
    expect(node.severity).toBe('high');
    expect(node.tags).toContain('sev:high');
  });

  it('inyecta tags extra + dedupe', () => {
    const node = materializeNode({
      zkNodeId: 'zk-abc',
      payload: samplePayload(),
      projectId: 'proj-1',
      extraTags: ['bernoulli', 'auto', 'materialized'],
      now: NOW,
    });
    expect(node.tags.filter((t) => t === 'materialized')).toHaveLength(1);
    expect(node.tags).toContain('bernoulli');
  });

  it('metadata.references y sourceType se inyectan', () => {
    const node = materializeNode({
      zkNodeId: 'zk-abc',
      payload: samplePayload(),
      projectId: 'proj-1',
      now: NOW,
    });
    expect(node.metadata.references).toEqual(['NCh 997', 'OSHA 1926.451']);
    expect(node.metadata.sourceType).toBe('scaffold-uplift');
  });

  it('createdAt / updatedAt: usa override si llega, sino now', () => {
    const node = materializeNode({
      zkNodeId: 'zk-x',
      payload: samplePayload(),
      projectId: 'p',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
      now: NOW,
    });
    expect(node.createdAt).toBe('2026-01-01T00:00:00Z');
    expect(node.updatedAt).toBe('2026-02-01T00:00:00Z');
    expect(node.materializedAt).toBe(NOW.toISOString());
  });

  it('connections se copia (no aliasing)', () => {
    const payload = samplePayload();
    const node = materializeNode({
      zkNodeId: 'zk',
      payload,
      projectId: 'p',
      now: NOW,
    });
    payload.connections.push('extra');
    expect(node.connections).not.toContain('extra');
  });
});

describe('dematerializeNode (inversa)', () => {
  it('round-trip preserva título y conexiones', () => {
    const original = samplePayload();
    const canonical = materializeNode({
      zkNodeId: 'zk-1',
      payload: original,
      projectId: 'p',
      now: NOW,
    });
    const back = dematerializeNode(canonical);
    expect(back.title).toBe(original.title);
    expect(back.type).toBe(original.type);
    expect(back.connections).toEqual(original.connections);
    expect(back.references).toEqual(original.references);
  });

  it('default a safety-learning si no hay sourceType en metadata', () => {
    const back = dematerializeNode({
      id: 'x',
      type: 'Riesgo',
      title: 'T',
      description: 'D',
      tags: [],
      metadata: {}, // sin sourceType
      connections: [],
      createdAt: '',
      updatedAt: '',
      materializedAt: '',
      materializedFromZkNodeId: '',
    });
    expect(back.type).toBe('safety-learning');
  });
});

describe('canonicalNodePath / parseCanonicalNodePath', () => {
  it('crea path con tenant', () => {
    expect(
      canonicalNodePath({ tenantId: 'tA', projectId: 'p1', zkNodeId: 'zk-1' }),
    ).toBe('nodes/tA_p1_zk-1');
  });

  it('crea path sin tenant', () => {
    expect(canonicalNodePath({ projectId: 'p1', zkNodeId: 'zk-1' })).toBe('nodes/p1_zk-1');
  });

  it('parse round-trip con tenant', () => {
    const p = canonicalNodePath({ tenantId: 'tA', projectId: 'p1', zkNodeId: 'zk-1' });
    expect(parseCanonicalNodePath(p)).toEqual({
      tenantId: 'tA',
      projectId: 'p1',
      zkNodeId: 'zk-1',
    });
  });

  it('parse round-trip sin tenant', () => {
    const p = canonicalNodePath({ projectId: 'p1', zkNodeId: 'zk-1' });
    expect(parseCanonicalNodePath(p)).toEqual({ projectId: 'p1', zkNodeId: 'zk-1' });
  });

  it('parse non-nodes path → null', () => {
    expect(parseCanonicalNodePath('users/abc')).toBeNull();
  });
});

describe('materializeBatch', () => {
  it('procesa inputs válidos y reporta skipped por payload inválido', () => {
    const inputs: MaterializeInput[] = [
      {
        zkNodeId: 'zk-1',
        payload: samplePayload(),
        projectId: 'p1',
        now: NOW,
      },
      {
        zkNodeId: 'zk-2',
        payload: samplePayload({ title: '' }),
        projectId: 'p1',
        now: NOW,
      },
      {
        zkNodeId: 'zk-3',
        payload: samplePayload(),
        projectId: '',
        now: NOW,
      },
    ];
    const r = materializeBatch({ inputs });
    expect(r.upserts).toHaveLength(1);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped.find((s) => s.zkNodeId === 'zk-2')?.reason).toBe('invalid_payload');
    expect(r.skipped.find((s) => s.zkNodeId === 'zk-3')?.reason).toBe('missing_projectId');
  });

  it('produce paths consistentes', () => {
    const r = materializeBatch({
      inputs: [
        {
          zkNodeId: 'zk-1',
          payload: samplePayload(),
          projectId: 'p1',
          tenantId: 'tA',
          now: NOW,
        },
      ],
    });
    expect(r.upserts[0].path).toBe('nodes/tA_p1_zk-1');
    expect(r.upserts[0].data.tenantId).toBe('tA');
  });
});
