// @vitest-environment jsdom
//
// Praeventio Guard — Bucket D: SafetyMetrics page tests.
//
//   1. Empty-state sin proyecto seleccionado.
//   2. Honest empty-state cuando no hay horas-hombre capturadas (CTA + no
//      dashboard de tasas falsas).
//   3. Capturar horas → refetch → el dashboard real renderiza TRIR/LTIFR.
//
// Hermetic: contexto + hook mockeados — sin fetch real.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SafetyMetrics } from './SafetyMetrics';
import type {
  SafetyMetricsReportResponse,
  UseSafetyMetricsReport,
} from '../hooks/useSafetyMetrics';
import { buildSafetyMetricsReport } from '../services/safetyMetrics/osha';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockReport: UseSafetyMetricsReport;
const mockCapture = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRefetch = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

vi.mock('../hooks/useSafetyMetrics', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useSafetyMetricsReport: () => mockReport,
    captureSafetyExposure: (...args: unknown[]) => mockCapture(...args),
  };
});

function reportResponse(totalHoursWorked: number): SafetyMetricsReportResponse {
  const counts = {
    totalRecordable: 4,
    lostTime: 2,
    restrictedOrTransferred: 1,
    seriousInjuriesAndFatalities: 1,
    fatalities: 0,
    totalLostDays: 15,
  };
  const exposure = { totalHoursWorked };
  return { counts, exposure, report: buildSafetyMetricsReport(counts, exposure, '2026-05') };
}

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Obra Norte' };
  mockCapture.mockReset();
  mockRefetch.mockReset();
  mockReport = {
    data: reportResponse(0),
    loading: false,
    error: null,
    refetch: mockRefetch,
  };
});

describe('<SafetyMetrics />', () => {
  it('muestra empty-state sin proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<SafetyMetrics />);
    expect(screen.getByTestId('safety-metrics-page-empty')).toBeInTheDocument();
  });

  it('empty-state HONESTO sin horas-hombre: CTA visible y SIN dashboard de tasas', () => {
    render(<SafetyMetrics />);
    expect(screen.getByTestId('safety-metrics-exposure-cta')).toBeInTheDocument();
    expect(screen.getByTestId('safety-metrics-no-exposure')).toBeInTheDocument();
    // No fake rates dashboard when exposure is 0.
    expect(screen.queryByTestId('safety-metrics-dashboard')).not.toBeInTheDocument();
  });

  it('rechaza captura con horas <= 0 (no inventa horas)', async () => {
    render(<SafetyMetrics />);
    fireEvent.click(screen.getByTestId('safety-metrics-hours-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('safety-metrics-save-error')).toBeInTheDocument(),
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('capturar horas llama al endpoint con el período + refetch', async () => {
    mockCapture.mockResolvedValue({ saved: true, period: '2026-05', totalHoursWorked: 200000 });
    render(<SafetyMetrics />);
    fireEvent.change(screen.getByTestId('safety-metrics-hours-input'), {
      target: { value: '200000' },
    });
    fireEvent.click(screen.getByTestId('safety-metrics-hours-submit'));
    await waitFor(() => expect(mockCapture).toHaveBeenCalledTimes(1));
    expect(mockCapture).toHaveBeenCalledWith('p-1', {
      period: expect.any(String),
      totalHoursWorked: 200000,
    });
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('con horas-hombre capturadas el dashboard real renderiza TRIR/LTIFR', () => {
    mockReport = {
      data: reportResponse(400000),
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<SafetyMetrics />);
    expect(screen.getByTestId('safety-metrics-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('safety-metric-trir')).toBeInTheDocument();
    expect(screen.getByTestId('safety-metric-ltifr')).toBeInTheDocument();
  });
});
