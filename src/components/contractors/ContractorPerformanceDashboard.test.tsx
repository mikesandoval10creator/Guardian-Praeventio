// @vitest-environment jsdom
//
// Praeventio Guard — ContractorPerformanceDashboard tests.
//
//   1. Empty-state sin proyecto.
//   2. Honest empty-state cuando no hay horas-hombre capturadas (CTA + sin tabla
//      de tasas fabricadas).
//   3. Capturar exige id+nombre+horas>0 (no inventa contratistas ni horas).
//   4. Capturar válido → endpoint con el período + refetch.
//   5. Con datos del server, la tabla real renderiza TRIR/LTIFR por contratista.
//
// Hermetic: hook mockeado — sin fetch real. El componente consume props del
// server (no mock interno).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContractorPerformanceDashboard } from './ContractorPerformanceDashboard';
import type {
  ContractorPerformanceResponse,
  UseContractorPerformance,
} from '../../hooks/useContractorPerformance';
import { buildSafetyMetricsReport } from '../../services/safetyMetrics/osha';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

let mockPerf: UseContractorPerformance;
const mockCapture = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRefetch = vi.fn();

vi.mock('../../hooks/useContractorPerformance', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useContractorPerformance: () => mockPerf,
    captureContractorExposure: (...args: unknown[]) => mockCapture(...args),
  };
});

function perfResponse(): ContractorPerformanceResponse {
  const counts = {
    totalRecordable: 3,
    lostTime: 1,
    restrictedOrTransferred: 0,
    seriousInjuriesAndFatalities: 1,
    fatalities: 0,
    totalLostDays: 8,
  };
  const exposure = { totalHoursWorked: 300000 };
  return {
    period: '2026-05',
    contractors: [
      {
        contractorId: 'c-1',
        contractorName: 'Constructora Andes SpA',
        totalHoursWorked: 300000,
        counts,
        report: buildSafetyMetricsReport(counts, exposure, '2026-05'),
      },
    ],
  };
}

beforeEach(() => {
  mockCapture.mockReset();
  mockRefetch.mockReset();
  mockPerf = {
    data: { period: '2026-05', contractors: [] },
    loading: false,
    error: null,
    refetch: mockRefetch,
  };
});

describe('<ContractorPerformanceDashboard />', () => {
  it('empty-state sin proyecto', () => {
    render(<ContractorPerformanceDashboard projectId={null} />);
    expect(screen.getByTestId('contractor-perf-no-project')).toBeInTheDocument();
  });

  it('empty-state HONESTO sin horas-hombre: sin tabla de tasas fabricadas', () => {
    render(<ContractorPerformanceDashboard projectId="p-1" />);
    expect(screen.getByTestId('contractor-perf-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('contractor-perf-table')).not.toBeInTheDocument();
  });

  it('rechaza captura sin id/nombre/horas (no inventa datos)', async () => {
    render(<ContractorPerformanceDashboard projectId="p-1" />);
    fireEvent.click(screen.getByTestId('contractor-perf-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('contractor-perf-save-error')).toBeInTheDocument(),
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('captura válida llama al endpoint con el período + refetch', async () => {
    mockCapture.mockResolvedValue({
      saved: true,
      contractorId: 'c-1',
      period: '2026-05',
      totalHoursWorked: 120000,
    });
    render(<ContractorPerformanceDashboard projectId="p-1" />);
    fireEvent.change(screen.getByTestId('contractor-perf-id-input'), {
      target: { value: 'c-1' },
    });
    fireEvent.change(screen.getByTestId('contractor-perf-name-input'), {
      target: { value: 'Constructora Andes SpA' },
    });
    fireEvent.change(screen.getByTestId('contractor-perf-hours-input'), {
      target: { value: '120000' },
    });
    fireEvent.click(screen.getByTestId('contractor-perf-submit'));
    await waitFor(() => expect(mockCapture).toHaveBeenCalledTimes(1));
    expect(mockCapture).toHaveBeenCalledWith('p-1', {
      contractorId: 'c-1',
      contractorName: 'Constructora Andes SpA',
      period: expect.any(String),
      totalHoursWorked: 120000,
    });
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('con datos del server, la tabla renderiza TRIR/LTIFR por contratista', () => {
    mockPerf = { data: perfResponse(), loading: false, error: null, refetch: mockRefetch };
    render(<ContractorPerformanceDashboard projectId="p-1" />);
    expect(screen.getByTestId('contractor-perf-table')).toBeInTheDocument();
    expect(screen.getByTestId('contractor-perf-row-c-1')).toBeInTheDocument();
    // TRIR = totalRecordable(3) * 200000 / 300000 = 2
    expect(screen.getByTestId('contractor-perf-trir-c-1')).toHaveTextContent('2');
  });
});
