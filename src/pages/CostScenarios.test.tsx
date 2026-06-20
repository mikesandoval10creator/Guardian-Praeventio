// @vitest-environment jsdom
//
// Praeventio Guard — <CostScenarios /> page wrapper tests (Bloque 3.15).
//
// Verifica que la página cierra el loop de costos sobre la superficie
// persistida real (/api/sprint-k/:projectId/cost/*):
//   1. Empty-state honesto cuando no hay proyecto seleccionado.
//   2. Empty-state honesto cuando el proyecto NO tiene escenarios guardados
//      (no inventa tarjetas).
//   3. usePreventionScenarios (GET /cost/scenarios) alimenta una
//      <CostScenarioCard /> REAL por cada escenario persistido — el dato del
//      proyecto se muestra (nombre, industria, neto, ROI).
//   4. El simulador real (<CostSimulator />) se monta y un guardado exitoso
//      llama savePreventionScenario con el projectId y dispara refetch (loop
//      simular→guardar→leer→tarjeta).
//
// Hermetic: SOLO la frontera de red se mockea — el módulo de hook
// usePreventionCost (usePreventionScenarios + savePreventionScenario +
// simulatePreventionCost) y ProjectContext. La página, <CostSimulator /> y
// <CostScenarioCard /> son código real. Patrón espejo de ChangeManagement.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { CostScenarios } from './CostScenarios';
import type {
  StoredCostScenario,
  ScenariosResponse,
  CostSimulation,
  SimulateInput,
} from '../hooks/usePreventionCost';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      let out = typeof fallback === 'string' ? fallback : _k;
      const merged =
        opts && typeof opts === 'object'
          ? opts
          : fallback && typeof fallback === 'object'
            ? fallback
            : undefined;
      if (typeof fallback === 'object' && fallback && 'defaultValue' in fallback) {
        out = String((fallback as { defaultValue: string }).defaultValue);
      }
      if (merged) {
        for (const [key, val] of Object.entries(merged)) {
          if (key === 'defaultValue') continue;
          out = out.replace(`{{${key}}}`, String(val));
        }
      }
      return out;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

type ScenariosState = {
  data: ScenariosResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

let mockScenarios: ScenariosState;
const refetchMock = vi.fn();
const simulateMock = vi.fn();
const saveMock = vi.fn();

vi.mock('../hooks/usePreventionCost', () => ({
  usePreventionScenarios: () => mockScenarios,
  simulatePreventionCost: (...args: unknown[]) => simulateMock(...args),
  savePreventionScenario: (...args: unknown[]) => saveMock(...args),
}));

function makeSimulation(over: Partial<CostSimulation> = {}): CostSimulation {
  return {
    withoutPrevention: {
      estimatedFineClpMin: 5_000_000,
      estimatedFineClpMax: 15_000_000,
      stoppageCostClp: 4_500_000,
      adminCostClp: 600_000,
      totalEstimatedClpMin: 10_100_000,
      totalEstimatedClpMax: 20_100_000,
    } as CostSimulation['withoutPrevention'],
    withPrevention: {
      adminHoursSavingsClp: 600_000,
      documentInsourceSavingsClp: 1_200_000,
      stoppageAvoidanceSavingsClp: 3_000_000,
      incidentAvoidanceSavingsClp: 8_000_000,
      totalSavingsClp: 12_800_000,
    } as CostSimulation['withPrevention'],
    expectedNonComplianceClp: 15_100_000,
    expectedSavingsClp: 12_800_000,
    netBenefitClp: 6_800_000,
    roiRatio: 1.13,
    roiLevel: 'positive',
    meta: {
      workerCount: 50,
      industry: 'construction',
      eppCoveragePct: 100,
      trainingHoursPerYear: 16,
      preventionInvestmentClp: 6_000_000,
    },
    ...over,
  };
}

function makeInput(): SimulateInput {
  return {
    workerCount: 50,
    industry: 'construction',
    eppCoveragePct: 100,
    trainingHoursPerYear: 16,
    preventionInvestmentClp: 6_000_000,
    nonCompliance: {
      kind: 'training_overdue',
      affectedWorkerCount: 50,
      estimatedStoppageDays: 3,
      dailyStoppageCostClp: 1_500_000,
      adminHoursToFix: 24,
      hasHistoryOfFines: false,
    },
    prevention: {
      expirationsCaughtEarly: 20,
      adminHoursSaved: 80,
      documentsGeneratedInternally: 15,
      potentialStoppagesAvoided: 2,
      nearMissesNotEscalated: 5,
    },
  };
}

function makeScenario(over: Partial<StoredCostScenario> & { id: string }): StoredCostScenario {
  return {
    id: over.id,
    name: over.name ?? 'Construcción 50 trabajadores Q2',
    description: over.description ?? null,
    input: over.input ?? makeInput(),
    simulation: over.simulation ?? makeSimulation(),
    createdAt: over.createdAt ?? '2026-06-15T12:00:00.000Z',
    createdBy: over.createdBy ?? 'admin-uid',
  };
}

function loadedScenarios(scenarios: StoredCostScenario[]): ScenariosState {
  return { data: { scenarios }, loading: false, error: null, refetch: refetchMock };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockScenarios = loadedScenarios([]);
  refetchMock.mockReset();
  simulateMock.mockReset();
  saveMock.mockReset();
});

describe('<CostScenarios /> page (Bloque 3.15)', () => {
  it('renderiza empty-state honesto cuando no hay proyecto', () => {
    mockSelectedProject = null;
    render(<CostScenarios />);
    expect(screen.getByTestId('cost-scenarios.empty.noProject')).toBeInTheDocument();
    // Sin proyecto, ni el simulador ni la lista de guardados se montan.
    expect(screen.queryByTestId('costSimulator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cost-scenarios.saved')).not.toBeInTheDocument();
  });

  it('monta el simulador real y un empty-state honesto cuando el proyecto no tiene escenarios', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockScenarios = loadedScenarios([]);

    render(<CostScenarios />);

    // El simulador real (CostSimulator) está montado con el projectId.
    expect(screen.getByTestId('costSimulator')).toBeInTheDocument();
    // Empty-state honesto: no hay tarjetas inventadas.
    expect(screen.getByTestId('cost-scenarios.saved.empty')).toBeInTheDocument();
    expect(screen.queryByTestId('costScenario.card')).not.toBeInTheDocument();
  });

  it('renderiza una CostScenarioCard real por cada escenario persistido con su dato', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockScenarios = loadedScenarios([
      makeScenario({
        id: 'sc-1',
        name: 'Minería turno A',
        simulation: makeSimulation({
          netBenefitClp: 6_800_000,
          roiLevel: 'positive',
          meta: {
            workerCount: 50,
            industry: 'mining',
            eppCoveragePct: 100,
            trainingHoursPerYear: 16,
            preventionInvestmentClp: 6_000_000,
          },
        }),
        input: { ...makeInput(), industry: 'mining' },
      }),
      makeScenario({ id: 'sc-2', name: 'Construcción Q3' }),
    ]);

    render(<CostScenarios />);

    const cards = screen.getAllByTestId('costScenario.card');
    expect(cards).toHaveLength(2);
    // El nombre real del primer escenario.
    expect(screen.getByText('Minería turno A')).toBeInTheDocument();
    // La tarjeta refleja la industria real del input persistido (Minería).
    const firstCard = cards[0]!;
    expect(within(firstCard).getByTestId('costScenario.card.industry')).toHaveTextContent(
      'Minería',
    );
    // El neto real formateado en CLP.
    expect(within(firstCard).getByTestId('costScenario.card.net')).toHaveTextContent('6.800.000');
  });

  it('un guardado exitoso en el simulador llama savePreventionScenario con el projectId y dispara refetch (loop)', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockScenarios = loadedScenarios([]);
    simulateMock.mockResolvedValueOnce({ simulation: makeSimulation() });
    saveMock.mockResolvedValueOnce({ ok: true, scenario: makeScenario({ id: 'sc-new' }) });

    render(<CostScenarios />);

    // Simular primero (habilita el bloque de guardado).
    fireEvent.click(screen.getByTestId('costSimulator.simulate'));
    await waitFor(() => {
      expect(simulateMock).toHaveBeenCalledTimes(1);
    });
    expect(simulateMock).toHaveBeenCalledWith('p-1', expect.objectContaining({ workerCount: 50 }));

    // El bloque de guardado aparece tras la simulación.
    const saveButton = await screen.findByTestId('costSimulator.save.button');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    // El guardado va contra el projectId del proyecto activo.
    expect(saveMock.mock.calls[0]![0]).toBe('p-1');
    // Y al resolver, la página refetch-ea la lista (cierra el loop).
    await waitFor(() => {
      expect(refetchMock).toHaveBeenCalled();
    });
  });
});
