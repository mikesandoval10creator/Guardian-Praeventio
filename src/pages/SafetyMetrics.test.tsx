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
import type { SpiReportResponse, UseSpiReport } from '../hooks/useSpiReport';
import { buildSafetyMetricsReport } from '../services/safetyMetrics/osha';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockReport: UseSafetyMetricsReport;
let mockSpi: UseSpiReport;
const mockCapture = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCapturePlan = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRefetch = vi.fn();
const mockSpiRefetch = vi.fn();

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

vi.mock('../hooks/useSpiReport', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useSpiReport: () => mockSpi,
    captureSafetyPlan: (...args: unknown[]) => mockCapturePlan(...args),
  };
});

function spiResponse(planCaptured: boolean): SpiReportResponse {
  const leading = {
    preTaskChecklistCompletion: 0,
    dailyTalksDeliveryRate: planCaptured ? 18 / 22 : 0,
    trainingCurrencyRate: planCaptured ? 3 / 4 : 0,
    plannedInspectionsRate: planCaptured ? 6 / 8 : 0,
    nearMissReportingRate: 2,
    positiveObservationsRate: 0,
  };
  const lagging = { trir: 0, ltifr: 0, lostDays: 0, severityRate: 0, regulatoryFindings: 0 };
  return {
    period: '2026-05',
    report: { spiScore: 70, leadingScore: 60, laggingScore: 80, level: 'fair', improvementFocusAreas: [] },
    leading,
    lagging,
    honesty: {
      preTaskChecklistCompletion: true,
      dailyTalksDeliveryRate: !planCaptured,
      trainingCurrencyRate: !planCaptured,
      plannedInspectionsRate: !planCaptured,
      nearMissReportingRate: false,
      positiveObservationsRate: true,
      laggingEmpty: true,
    },
    ratios: {
      dailyTalks: { executed: 18, planned: planCaptured ? 22 : 0 },
      trainings: { executed: 3, planned: planCaptured ? 4 : 0 },
      inspections: { executed: 6, planned: planCaptured ? 8 : 0 },
    },
    plan: planCaptured
      ? { plannedInspections: 8, plannedDailyTalks: 22, plannedTrainings: 4 }
      : null,
    exposure: { totalHoursWorked: 0 },
  };
}

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
  mockCapturePlan.mockReset();
  mockRefetch.mockReset();
  mockSpiRefetch.mockReset();
  mockReport = {
    data: reportResponse(0),
    loading: false,
    error: null,
    refetch: mockRefetch,
  };
  mockSpi = {
    data: spiResponse(false),
    loading: false,
    error: null,
    refetch: mockSpiRefetch,
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

  // ── SPI plan-vs-executed ────────────────────────────────────────────────

  it('monta el SpiDashboard con empty-state honesto sin plan capturado', () => {
    render(<SafetyMetrics />);
    expect(screen.getByTestId('spi-section')).toBeInTheDocument();
    expect(screen.getByTestId('spi-dashboard')).toBeInTheDocument();
    // No plan → ratio indicators render the honest-empty CTA, not fake ratios.
    expect(screen.getByTestId('spi-row-inspections-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('spi-row-inspections')).not.toBeInTheDocument();
  });

  it('rechaza captura de plan con valores inválidos (no inventa denominador)', async () => {
    render(<SafetyMetrics />);
    fireEvent.change(screen.getByTestId('spi-plan-inspections'), { target: { value: '-1' } });
    fireEvent.click(screen.getByTestId('spi-plan-submit'));
    await waitFor(() => expect(screen.getByTestId('spi-plan-error')).toBeInTheDocument());
    expect(mockCapturePlan).not.toHaveBeenCalled();
  });

  it('capturar plan llama al endpoint con el período + refetch del SPI', async () => {
    mockCapturePlan.mockResolvedValue({
      saved: true,
      period: '2026-05',
      plannedInspections: 8,
      plannedDailyTalks: 22,
      plannedTrainings: 4,
    });
    render(<SafetyMetrics />);
    fireEvent.change(screen.getByTestId('spi-plan-inspections'), { target: { value: '8' } });
    fireEvent.change(screen.getByTestId('spi-plan-talks'), { target: { value: '22' } });
    fireEvent.change(screen.getByTestId('spi-plan-trainings'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('spi-plan-submit'));
    await waitFor(() => expect(mockCapturePlan).toHaveBeenCalledTimes(1));
    expect(mockCapturePlan).toHaveBeenCalledWith('p-1', {
      period: expect.any(String),
      plannedInspections: 8,
      plannedDailyTalks: 22,
      plannedTrainings: 4,
    });
    expect(mockSpiRefetch).toHaveBeenCalled();
  });

  it('con plan capturado el SpiDashboard muestra ratios reales ejecutado/planificado', () => {
    mockSpi = {
      data: spiResponse(true),
      loading: false,
      error: null,
      refetch: mockSpiRefetch,
    };
    render(<SafetyMetrics />);
    expect(screen.getByTestId('spi-row-inspections').textContent).toContain('6/8');
    expect(screen.getByTestId('spi-row-talks').textContent).toContain('18/22');
  });
});
