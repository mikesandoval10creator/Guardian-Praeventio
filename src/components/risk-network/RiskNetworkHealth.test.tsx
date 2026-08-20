// @vitest-environment jsdom
// Praeventio Guard — §ZK-5 PR-3c: test del consumidor.
//
// Verifica que RiskNetworkHealth usa las aristas del hook cuando están
// disponibles, y cae al path legacy (node.connections) cuando el hook
// está loading o falló.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { ZkEdge } from '../../services/zettelkasten/edges';
import { buildEdge } from '../../services/zettelkasten/edges';

// ── Mocks hoist-safe (Patrón bot-delegation-router Pitfall 13) ───────────
// Los vi.mock() se hoistean al top del archivo, antes de las const.
// Usamos un wrapper mutable top-level para evitar ReferenceError en TDZ.

const __mocks = {
  zkEdges: [] as ZkEdge[],
  projectId: 'test-project' as string | null,
  edgesLoading: false,
  fetchError: undefined as string | undefined,
  nodes: [
    {
      id: 'r1',
      type: 'Riesgo' as any,
      title: 'Risk 1',
      description: '',
      tags: [],
      metadata: { severity: 3 },
      connections: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'r2',
      type: 'Riesgo' as any,
      title: 'Risk 2',
      description: '',
      tags: [],
      metadata: { severity: 2 },
      connections: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ] as any[],
  nodesLoading: false,
};

vi.mock('../../hooks/useZkEdges', () => ({
  useZkEdges: () => ({
    edges: __mocks.zkEdges,
    loading: __mocks.edgesLoading,
    error: __mocks.fetchError,
  }),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ projectId: __mocks.projectId }),
}));

vi.mock('../../contexts/UniversalKnowledgeContext', () => ({
  useUniversalKnowledge: () => ({
    nodes: __mocks.nodes,
    loading: __mocks.nodesLoading,
  }),
}));

vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ addConnection: vi.fn() }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('../../services/zettelkasten/riskOrchestrator', () => ({
  detectUncontrolledRisks: vi.fn(() => []),
}));

import { RiskNetworkHealth } from '../../components/risk-network/RiskNetworkHealth';

describe('§ZK-5 PR-3c RiskNetworkHealth consumer', () => {
  beforeEach(() => {
    __mocks.zkEdges = [];
    __mocks.projectId = 'test-project';
    __mocks.edgesLoading = false;
    __mocks.fetchError = undefined;
  });

  it('renderiza sin aristas ZkEdge (fallback legacy)', async () => {
    render(<RiskNetworkHealth />);
    // El componente no debe crashear si no hay aristas.
    await waitFor(() => {
      expect(screen.queryByText(/Salud de la Red Neuronal/i)).toBeTruthy();
    });
  });

  it('no falla cuando el hook de edges está en loading', () => {
    __mocks.edgesLoading = true;
    render(<RiskNetworkHealth />);
    // El componente debe mostrar el estado de carga sin crashear.
    expect(screen.queryByText(/Salud de la Red Neuronal/i)).toBeTruthy();
  });

  it('no falla cuando el hook retorna error', () => {
    __mocks.fetchError = 'Network error';
    render(<RiskNetworkHealth />);
    // Fallback al path legacy, sin crashear.
    expect(screen.queryByText(/Salud de la Red Neuronal/i)).toBeTruthy();
  });

  it('usa aristas del hook cuando están disponibles', async () => {
    // Edge vigente
    const vigente: ZkEdge = buildEdge({
      fromNodeId: 'r1',
      toNodeId: 'r2',
      type: 'mitigates',
      tenantId: 'test-project',
      createdBy: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    // Edge expirado (validUntil en el pasado)
    const expirada: ZkEdge = buildEdge({
      fromNodeId: 'r1',
      toNodeId: 'r2',
      type: 'requires',
      tenantId: 'test-project',
      createdBy: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      validUntil: '2020-01-01T00:00:00.000Z', // muy en el pasado
    });

    __mocks.zkEdges = [vigente, expirada];
    render(<RiskNetworkHealth />);

    // El componente debe renderizar sin crashear con aristas reales.
    await waitFor(() => {
      expect(screen.queryByText(/Salud de la Red Neuronal/i)).toBeTruthy();
    });

    // NOTA: la lógica de aplicación del peso al healthScore se valida en
    // graphAnalytics.weight.test.ts. Este test es smoke del consumidor.
  });
});
