import { describe, it, expect } from 'vitest';
import { computeExecutiveScorecards, type ScorecardInputs } from './executiveScorecard';
import { type RiskNode, NodeType } from '../../types';

function node(type: NodeType, metadata: Record<string, unknown> = {}, over: Partial<RiskNode> = {}): RiskNode {
  return {
    id: over.id ?? `${type}-${Math.round((metadata.k as number) ?? 0)}`,
    type,
    title: 't',
    description: 'd',
    tags: [],
    metadata,
    connections: [],
    projectId: over.projectId ?? 'p1',
    createdAt: over.createdAt ?? '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
    ...over,
  };
}

const NOW = Date.parse('2026-06-16T12:00:00.000Z');

describe('computeExecutiveScorecards — honest empty state', () => {
  it('flags every axis insufficient_data and yields esgTotal 0 when there is NO data', () => {
    const input: ScorecardInputs = {
      nodes: [],
      projectIds: [],
      totalWorkers: 0,
      avgCompliance: 0,
      nowMs: NOW,
    };
    const r = computeExecutiveScorecards(input);

    expect(r.esgData.every((d) => d.insufficient_data)).toBe(true);
    expect(r.isoData.every((d) => d.insufficient_data)).toBe(true);
    // Every axis is 0 — NOT a fabricated 40/50/70.
    expect(r.esgData.every((d) => d.A === 0)).toBe(true);
    expect(r.isoData.every((d) => d.A === 0)).toBe(true);
    expect(r.esgTotal).toBe(0);
    expect(r.esgEnvironmental).toBe(0);
    expect(r.esgSocial).toBe(0);
    expect(r.esgGovernance).toBe(0);
  });

  it('NEVER returns the legacy fabricated floors (50/40/70) on empty data', () => {
    const r = computeExecutiveScorecards({
      nodes: [],
      projectIds: [],
      totalWorkers: 0,
      avgCompliance: 0,
      nowMs: NOW,
    });
    for (const axis of [...r.esgData, ...r.isoData]) {
      expect(axis.A).not.toBe(40);
      expect(axis.A).not.toBe(50);
      expect(axis.A).not.toBe(70);
    }
  });
});

describe('computeExecutiveScorecards — real ratios from real nodes', () => {
  it('computes ISO axes as real percentages of conforming nodes', () => {
    const nodes: RiskNode[] = [
      // EPP: 3 conformes of 4 → 75
      node(NodeType.EPP, { status: 'Conforme', k: 1 }),
      node(NodeType.EPP, { status: 'Conforme', k: 2 }),
      node(NodeType.EPP, { status: 'Conforme', k: 3 }),
      node(NodeType.EPP, { status: 'No Conforme', k: 4 }),
      // AUDIT: 1 Cumple of 2 → 50; items used for Procesos
      node(NodeType.AUDIT, { status: 'Cumple', items: [{ status: 'Cumple' }], k: 5 }),
      node(NodeType.AUDIT, { status: 'No Cumple', items: [{ status: 'No Cumple' }], k: 6 }),
      // FINDING: 1 closed of 2 → 50
      node(NodeType.FINDING, { status: 'cerrado', k: 7 }),
      node(NodeType.FINDING, { status: 'abierto', k: 8 }),
      // RISK: 1 controlled (Medio) of 2 → 50 (Crítico excluded)
      node(NodeType.RISK, { level: 'Medio', k: 9 }),
      node(NodeType.RISK, { level: 'Crítico', k: 10 }),
    ];
    const r = computeExecutiveScorecards({
      nodes,
      projectIds: ['p1'],
      totalWorkers: 10,
      avgCompliance: 80,
      nowMs: NOW,
    });

    const iso = Object.fromEntries(r.isoData.map((d) => [d.subject, d]));
    expect(iso.EPP.A).toBe(75);
    expect(iso.EPP.insufficient_data).toBe(false);
    expect(iso.Normativa.A).toBe(50);
    expect(iso.Conducta.A).toBe(50);
    // Procesos: 1 audit-with-items sin 'No Cumple' of 2 with items → 50
    expect(iso.Procesos.A).toBe(50);
    expect(iso.Entorno.A).toBe(50);
  });

  it('computes ESG axes from real ratios (governance = avgCompliance)', () => {
    const nodes: RiskNode[] = [
      node(NodeType.TRAINING, { status: 'completed', k: 1 }),
      node(NodeType.TRAINING, { status: 'completed', k: 2 }),
      node(NodeType.TRAINING, { status: 'scheduled', k: 3 }), // 2 of 3 completed → Capacitación 67
      node(NodeType.RISK, { level: 'Bajo', k: 4 }), // 1 controlled of 1 → Ambiente 100
    ];
    const r = computeExecutiveScorecards({
      nodes,
      projectIds: ['p1', 'p2'],
      totalWorkers: 4, // 2 trained / 4 → Social 50
      avgCompliance: 80,
      nowMs: NOW,
    });

    const esg = Object.fromEntries(r.esgData.map((d) => [d.subject, d]));
    expect(esg.Social.A).toBe(50);
    expect(esg.Gobierno.A).toBe(80); // = avgCompliance, real
    expect(esg.Capacitación.A).toBe(67);
    expect(esg.Ambiente.A).toBe(100);
    // No recent incidents seeded → both projects incident-free → 100
    expect(esg.Incidentes.A).toBe(100);
    // esgTotal = avg of the 5 real axes (100+50+80+67+100)/5 ≈ 79
    expect(r.esgTotal).toBe(Math.round((100 + 50 + 80 + 67 + 100) / 5));
  });

  it('counts a project with a recent incident as NOT incident-free', () => {
    const nodes: RiskNode[] = [
      node(NodeType.INCIDENT, { k: 1 }, { projectId: 'p1', createdAt: '2026-06-15T00:00:00.000Z' }), // recent
    ];
    const r = computeExecutiveScorecards({
      nodes,
      projectIds: ['p1', 'p2'],
      totalWorkers: 0,
      avgCompliance: 0,
      nowMs: NOW,
    });
    const esg = Object.fromEntries(r.esgData.map((d) => [d.subject, d]));
    // p1 has a recent incident, p2 doesn't → 1 of 2 incident-free → 50
    expect(esg.Incidentes.A).toBe(50);
  });
});
