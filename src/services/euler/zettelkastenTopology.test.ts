// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  clusteringCoefficient,
  degreeCentrality,
  betweennessCentrality,
  detectRiskAmplifications,
  totalAmplificationScore,
  KNOWN_RISK_AMPLIFICATIONS,
} from './zettelkastenTopology';
import type { RiskGraph } from './graphConnectivity';

const node = (id: string, label?: string) => ({ id, label: label ?? id, severity: 1 });
const edge = (from: string, to: string) => ({ from, to });

describe('clusteringCoefficient', () => {
  it('triangle → all nodes have C=1 (every neighbor connects to every other)', () => {
    const g: RiskGraph = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [edge('A', 'B'), edge('B', 'C'), edge('A', 'C')],
    };
    expect(clusteringCoefficient(g, 'A')).toBe(1);
    expect(clusteringCoefficient(g, 'B')).toBe(1);
    expect(clusteringCoefficient(g, 'C')).toBe(1);
  });

  it('star (center + 4 leaves) → center C=0 (leaves never connect to each other)', () => {
    const g: RiskGraph = {
      nodes: [node('Center'), node('L1'), node('L2'), node('L3'), node('L4')],
      edges: [
        edge('Center', 'L1'),
        edge('Center', 'L2'),
        edge('Center', 'L3'),
        edge('Center', 'L4'),
      ],
    };
    expect(clusteringCoefficient(g, 'Center')).toBe(0);
  });

  it('node with degree < 2 → C=0 (no triangles possible)', () => {
    const g: RiskGraph = {
      nodes: [node('A'), node('B')],
      edges: [edge('A', 'B')],
    };
    expect(clusteringCoefficient(g, 'A')).toBe(0);
    expect(clusteringCoefficient(g, 'B')).toBe(0);
  });

  it('isolated node → C=0', () => {
    const g: RiskGraph = { nodes: [node('A')], edges: [] };
    expect(clusteringCoefficient(g, 'A')).toBe(0);
  });

  it('partial: 4 neighbors with 2 of 6 possible inter-neighbor edges → C=2/6=1/3', () => {
    const g: RiskGraph = {
      nodes: [node('Hub'), node('A'), node('B'), node('C'), node('D')],
      edges: [
        edge('Hub', 'A'),
        edge('Hub', 'B'),
        edge('Hub', 'C'),
        edge('Hub', 'D'),
        edge('A', 'B'), // 1 inter-neighbor
        edge('C', 'D'), // 2 inter-neighbor
      ],
    };
    expect(clusteringCoefficient(g, 'Hub')).toBeCloseTo(1 / 3, 6);
  });
});

describe('degreeCentrality', () => {
  it('hub of 5 connects to all others → centrality=1', () => {
    const g: RiskGraph = {
      nodes: [node('Hub'), node('A'), node('B'), node('C')],
      edges: [edge('Hub', 'A'), edge('Hub', 'B'), edge('Hub', 'C')],
    };
    expect(degreeCentrality(g, 'Hub')).toBe(1);
  });

  it('isolated node → centrality=0', () => {
    const g: RiskGraph = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [edge('B', 'C')],
    };
    expect(degreeCentrality(g, 'A')).toBe(0);
  });

  it('single-node graph → centrality=0 (degenerate)', () => {
    const g: RiskGraph = { nodes: [node('A')], edges: [] };
    expect(degreeCentrality(g, 'A')).toBe(0);
  });
});

describe('betweennessCentrality', () => {
  it('linear chain A-B-C → B has highest betweenness', () => {
    const g: RiskGraph = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [edge('A', 'B'), edge('B', 'C')],
    };
    const b = betweennessCentrality(g);
    // Only path A→C goes through B (1 path), so B's betweenness = 1.
    expect(b.get('B')).toBeCloseTo(1, 6);
    expect(b.get('A')).toBeCloseTo(0, 6);
    expect(b.get('C')).toBeCloseTo(0, 6);
  });

  it('triangle (no node is a bridge) → all betweennesses 0', () => {
    const g: RiskGraph = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [edge('A', 'B'), edge('B', 'C'), edge('A', 'C')],
    };
    const b = betweennessCentrality(g);
    for (const v of ['A', 'B', 'C']) {
      expect(b.get(v)).toBeCloseTo(0, 6);
    }
  });

  it('bridge node has positive betweenness', () => {
    // Two triangles connected via single edge through bridge node B.
    const g: RiskGraph = {
      nodes: [node('A'), node('B'), node('C'), node('D'), node('E')],
      edges: [
        edge('A', 'B'),
        edge('B', 'C'),
        edge('C', 'D'),
        edge('D', 'E'),
      ],
    };
    const b = betweennessCentrality(g);
    // C is the most central bridge in the chain.
    expect(b.get('C')!).toBeGreaterThan(b.get('A')!);
    expect(b.get('C')!).toBeGreaterThan(b.get('E')!);
  });

  it('returns entries for all nodes', () => {
    const g: RiskGraph = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [edge('A', 'B')],
    };
    const b = betweennessCentrality(g);
    expect(b.size).toBe(3);
    expect(b.has('A')).toBe(true);
    expect(b.has('B')).toBe(true);
    expect(b.has('C')).toBe(true);
  });
});

describe('detectRiskAmplifications', () => {
  it('humedad + electricidad connected → detects electrocución', () => {
    const g: RiskGraph = {
      nodes: [node('humedad'), node('electricidad'), node('otros')],
      edges: [edge('humedad', 'electricidad')],
    };
    const detected = detectRiskAmplifications(g);
    const found = detected.find((e) => e.derivedRisk === 'electrocucion');
    expect(found).toBeDefined();
    expect(found!.amplification).toBe(8);
  });

  it('humedad and electricidad NOT connected → no electrocución detection', () => {
    const g: RiskGraph = {
      nodes: [node('humedad'), node('electricidad'), node('puente')],
      edges: [edge('humedad', 'puente')], // no direct edge between humedad y electricidad
    };
    const detected = detectRiskAmplifications(g);
    const found = detected.find((e) => e.derivedRisk === 'electrocucion');
    expect(found).toBeUndefined();
  });

  it('matches by node label, not just id', () => {
    const g: RiskGraph = {
      nodes: [
        { id: 'n1', label: 'Humedad', severity: 1 },
        { id: 'n2', label: 'Electricidad', severity: 1 },
      ],
      edges: [edge('n1', 'n2')],
    };
    const detected = detectRiskAmplifications(g);
    expect(detected.length).toBeGreaterThan(0);
  });

  it('substring match works (e.g., "humedad_alta" matches "humedad")', () => {
    const g: RiskGraph = {
      nodes: [node('humedad_alta'), node('electricidad_220V')],
      edges: [edge('humedad_alta', 'electricidad_220V')],
    };
    const detected = detectRiskAmplifications(g);
    expect(detected.length).toBeGreaterThan(0);
  });

  it('multiple combinations detected', () => {
    const g: RiskGraph = {
      nodes: [
        node('humedad'),
        node('electricidad'),
        node('polvo'),
        node('chispa'),
      ],
      edges: [
        edge('humedad', 'electricidad'),
        edge('polvo', 'chispa'),
      ],
    };
    const detected = detectRiskAmplifications(g);
    expect(detected.length).toBe(2);
    const risks = detected.map((d) => d.derivedRisk);
    expect(risks).toContain('electrocucion');
    expect(risks).toContain('explosion_polvorienta');
  });

  it('empty graph → no detections', () => {
    expect(detectRiskAmplifications({ nodes: [], edges: [] })).toEqual([]);
  });

  it('catalog has expected canonical entries', () => {
    const risks = KNOWN_RISK_AMPLIFICATIONS.map((r) => r.derivedRisk);
    expect(risks).toContain('electrocucion');
    expect(risks).toContain('asfixia_quimica');
    expect(risks).toContain('deflagracion');
  });
});

describe('totalAmplificationScore', () => {
  it('no risk combinations → score 1', () => {
    const g: RiskGraph = { nodes: [node('A'), node('B')], edges: [edge('A', 'B')] };
    expect(totalAmplificationScore(g)).toBe(1);
  });

  it('single combination → score equals that combination amplification', () => {
    const g: RiskGraph = {
      nodes: [node('humedad'), node('electricidad')],
      edges: [edge('humedad', 'electricidad')],
    };
    expect(totalAmplificationScore(g)).toBe(8);
  });

  it('two combinations → product of amplifications', () => {
    const g: RiskGraph = {
      nodes: [node('humedad'), node('electricidad'), node('polvo'), node('chispa')],
      edges: [edge('humedad', 'electricidad'), edge('polvo', 'chispa')],
    };
    // electrocucion × explosion_polvorienta = 8 × 12 = 96
    expect(totalAmplificationScore(g)).toBe(96);
  });

  it('catastrophic compound: confinado + gas_toxico + soldadura + oxigeno_alto', () => {
    const g: RiskGraph = {
      nodes: [
        node('confinado'),
        node('gas_toxico'),
        node('soldadura'),
        node('oxigeno_alto'),
      ],
      edges: [
        edge('confinado', 'gas_toxico'),
        edge('soldadura', 'oxigeno_alto'),
      ],
    };
    // asfixia_quimica × incendio_intenso = 20 × 10 = 200
    expect(totalAmplificationScore(g)).toBe(200);
  });
});
