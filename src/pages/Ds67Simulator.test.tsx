// @vitest-environment jsdom
//
// Praeventio Guard — Épica B1 (capa 2): smoke tests for the DS 67
// cotización-adicional simulator page.
//
//   1. Empty-state sin proyecto seleccionado.
//   2. Loading del prefill.
//   3. Form pre-llenado desde incidentes registrados, con la procedencia
//      etiquetada ("Desde incidentes registrados").
//   4. Editar los días perdidos cambia la etiqueta a "Ingreso manual".
//   5. Submit llama al endpoint y renderiza tasas + cotización + delta
//      CLP + cita legal ("DS 67").
//
// Hermetic: hooks y contexto mockeados — sin fetch real.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Ds67Simulator } from './Ds67Simulator';
import type {
  Ds67PrefillResponse,
  Ds67SimulateResponse,
} from '../hooks/useDs67Simulator';

type PrefillMock = {
  data: Ds67PrefillResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockPrefill: PrefillMock;
const mockRequestSimulation = vi.fn<(...args: unknown[]) => Promise<Ds67SimulateResponse>>();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useDs67Simulator', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useDs67Prefill: () => mockPrefill,
    requestDs67Simulation: (...args: unknown[]) => mockRequestSimulation(...args),
  };
});

function prefillData(): Ds67PrefillResponse {
  return {
    generatedAt: '2026-06-11T00:00:00.000Z',
    periods: [
      {
        label: '01-07-2022 al 30-06-2023',
        startIso: '2022-07-01T00:00:00.000Z',
        endIso: '2023-07-01T00:00:00.000Z',
        registeredLostDays: 0,
        registeredIncidentCount: 0,
      },
      {
        label: '01-07-2023 al 30-06-2024',
        startIso: '2023-07-01T00:00:00.000Z',
        endIso: '2024-07-01T00:00:00.000Z',
        registeredLostDays: 14,
        registeredIncidentCount: 3,
      },
      {
        label: '01-07-2024 al 30-06-2025',
        startIso: '2024-07-01T00:00:00.000Z',
        endIso: '2025-07-01T00:00:00.000Z',
        registeredLostDays: 25,
        registeredIncidentCount: 5,
      },
    ],
  };
}

function simulateResponse(): Ds67SimulateResponse {
  return {
    generatedAt: '2026-06-11T00:00:00.000Z',
    result: {
      periods: [
        { label: '01-07-2022 al 30-06-2023', temporaryRate: 0, imFactor: 0 },
        { label: '01-07-2023 al 30-06-2024', temporaryRate: 14, imFactor: 0 },
        { label: '01-07-2024 al 30-06-2025', temporaryRate: 25, imFactor: 0 },
      ],
      averageTemporaryRate: 13,
      imFactorAverage: 0,
      invalidityDeathRate: 0,
      totalRate: 13,
      additionalCotizacionPct: 0,
      deltaPct: -0.34,
      annualCostClp: 0,
      currentAnnualCostClp: 2_040_000,
      annualCostDeltaClp: -2_040_000,
      legalCitation:
        'DS 67/1999 MINTRAB, arts. 2°, 3°, 5° y 13 — Ley 16.744, arts. 15 y 16 (BCN idNorma 159800)',
    },
    periods: [
      {
        label: '01-07-2022 al 30-06-2023',
        startIso: '2022-07-01T00:00:00.000Z',
        endIso: '2023-07-01T00:00:00.000Z',
        lostDays: 0,
        lostDaysSource: 'incidents',
        registeredLostDays: 0,
        registeredIncidentCount: 0,
      },
      {
        label: '01-07-2023 al 30-06-2024',
        startIso: '2023-07-01T00:00:00.000Z',
        endIso: '2024-07-01T00:00:00.000Z',
        lostDays: 14,
        lostDaysSource: 'incidents',
        registeredLostDays: 14,
        registeredIncidentCount: 3,
      },
      {
        label: '01-07-2024 al 30-06-2025',
        startIso: '2024-07-01T00:00:00.000Z',
        endIso: '2025-07-01T00:00:00.000Z',
        lostDays: 25,
        lostDaysSource: 'incidents',
        registeredLostDays: 25,
        registeredIncidentCount: 5,
      },
    ],
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockPrefill = { data: null, loading: false, error: null, refetch: vi.fn() };
  mockRequestSimulation.mockReset();
});

describe('<Ds67Simulator /> (épica B1 capa 2)', () => {
  it('renderiza empty-state cuando no hay proyecto seleccionado', () => {
    render(<Ds67Simulator />);
    expect(screen.getByTestId('ds67-sim-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras carga el prefill', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockPrefill = { data: null, loading: true, error: null, refetch: vi.fn() };
    render(<Ds67Simulator />);
    expect(screen.getByTestId('ds67-sim-loading')).toBeInTheDocument();
  });

  it('pre-llena días perdidos desde incidentes registrados y etiqueta la procedencia', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockPrefill = { data: prefillData(), loading: false, error: null, refetch: vi.fn() };
    render(<Ds67Simulator />);

    expect(screen.getByTestId('ds67-sim-lostdays-2')).toHaveValue(25);
    const badge = screen.getByTestId('ds67-sim-source-2');
    expect(badge).toHaveTextContent(/incidentes registrados/i);
    expect(badge).toHaveTextContent('5');
    // El período sin incidentes igualmente declara la procedencia real.
    expect(screen.getByTestId('ds67-sim-source-0')).toHaveTextContent(
      /incidentes registrados/i,
    );
  });

  it('editar los días perdidos cambia la etiqueta a ingreso manual', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockPrefill = { data: prefillData(), loading: false, error: null, refetch: vi.fn() };
    render(<Ds67Simulator />);

    fireEvent.change(screen.getByTestId('ds67-sim-lostdays-2'), {
      target: { value: '30' },
    });
    expect(screen.getByTestId('ds67-sim-source-2')).toHaveTextContent(/ingreso manual/i);
  });

  it('simula y renderiza tasas, cotización, delta CLP y cita legal', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockPrefill = { data: prefillData(), loading: false, error: null, refetch: vi.fn() };
    mockRequestSimulation.mockResolvedValue(simulateResponse());
    render(<Ds67Simulator />);

    // Dotación por período + planilla + cotización actual.
    for (const i of [0, 1, 2]) {
      fireEvent.change(screen.getByTestId(`ds67-sim-workers-${i}`), {
        target: { value: '100' },
      });
    }
    fireEvent.change(screen.getByTestId('ds67-sim-payroll'), {
      target: { value: '600000000' },
    });
    fireEvent.change(screen.getByTestId('ds67-sim-current'), {
      target: { value: '0.34' },
    });
    fireEvent.click(screen.getByTestId('ds67-sim-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('ds67-sim-result')).toBeInTheDocument();
    });
    expect(mockRequestSimulation).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        annualPayrollClp: 600_000_000,
        currentAdditionalCotizacionPct: 0.34,
      }),
    );
    expect(screen.getByTestId('ds67-sim-result-pct')).toHaveTextContent('0%');
    // Rebaja: delta anual negativo formateado CLP.
    expect(screen.getByTestId('ds67-sim-result-delta-cost')).toHaveTextContent(
      '-$2.040.000',
    );
    expect(screen.getByTestId('ds67-sim-citation')).toHaveTextContent('DS 67');
    expect(screen.getByTestId('ds67-sim-disclaimer')).toHaveTextContent(
      /organismo administrador/i,
    );
  });
});
