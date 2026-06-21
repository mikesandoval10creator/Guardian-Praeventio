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
  UseOperationalPressure,
  OperationalPressureResponse,
} from '../hooks/useSafetyMetrics';
import { buildSafetyMetricsReport } from '../services/safetyMetrics/osha';
import { computeOperationalPressure } from '../services/orgMetrics/organizationalMetrics';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockReport: UseSafetyMetricsReport;
let mockPressure: UseOperationalPressure;
const mockCapture = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCaptureWorkforce = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRefetch = vi.fn();
const mockRefetchPressure = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

vi.mock('../hooks/useSafetyMetrics', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useSafetyMetricsReport: () => mockReport,
    captureSafetyExposure: (...args: unknown[]) => mockCapture(...args),
    useOperationalPressure: () => mockPressure,
    captureWorkforcePeriod: (...args: unknown[]) => mockCaptureWorkforce(...args),
  };
});

function pressureResponse(captured: boolean): OperationalPressureResponse {
  if (!captured) {
    return { captured: false, period: '2026-05', signals: null, report: null };
  }
  const signals = {
    overdueTasks: 0,
    overtimeHoursWeekTotal: 345,
    minorIncidentsLast7d: 0,
    absenteeismRate: 0.15,
    hasNightShift: false,
    hasAdverseWeather: false,
    totalActiveWorkers: 50,
  };
  return {
    captured: true,
    period: '2026-05',
    workforce: { absenteeismDays: 200, overtimeHours: 1500, headcount: 50 },
    signals,
    report: computeOperationalPressure(signals),
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
  mockCaptureWorkforce.mockReset();
  mockRefetch.mockReset();
  mockRefetchPressure.mockReset();
  mockReport = {
    data: reportResponse(0),
    loading: false,
    error: null,
    refetch: mockRefetch,
  };
  mockPressure = {
    data: pressureResponse(false),
    loading: false,
    error: null,
    refetch: mockRefetchPressure,
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

  // ── Operational pressure section ───────────────────────────────────────

  it('presión operacional: empty-state HONESTO sin dotación (CTA + sin gauge)', () => {
    render(<SafetyMetrics />);
    expect(screen.getByTestId('operational-pressure-section')).toBeInTheDocument();
    expect(screen.getByTestId('workforce-capture-cta')).toBeInTheDocument();
    expect(screen.getByTestId('operational-pressure-empty')).toBeInTheDocument();
    // No fabricated gauge when nothing captured.
    expect(screen.queryByTestId('operational-pressure-gauge')).not.toBeInTheDocument();
  });

  it('rechaza captura de dotación inválida (headcount 0) sin llamar al endpoint', async () => {
    render(<SafetyMetrics />);
    fireEvent.change(screen.getByTestId('workforce-absenteeism-input'), {
      target: { value: '24' },
    });
    fireEvent.change(screen.getByTestId('workforce-overtime-input'), {
      target: { value: '320' },
    });
    // headcount left empty → invalid
    fireEvent.click(screen.getByTestId('workforce-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('workforce-save-error')).toBeInTheDocument(),
    );
    expect(mockCaptureWorkforce).not.toHaveBeenCalled();
  });

  it('capturar dotación llama al endpoint con período + refetch', async () => {
    mockCaptureWorkforce.mockResolvedValue({ saved: true });
    render(<SafetyMetrics />);
    fireEvent.change(screen.getByTestId('workforce-absenteeism-input'), {
      target: { value: '24' },
    });
    fireEvent.change(screen.getByTestId('workforce-overtime-input'), {
      target: { value: '320' },
    });
    fireEvent.change(screen.getByTestId('workforce-headcount-input'), {
      target: { value: '50' },
    });
    fireEvent.click(screen.getByTestId('workforce-submit'));
    await waitFor(() => expect(mockCaptureWorkforce).toHaveBeenCalledTimes(1));
    expect(mockCaptureWorkforce).toHaveBeenCalledWith('p-1', {
      period: expect.any(String),
      absenteeismDays: 24,
      overtimeHours: 320,
      headcount: 50,
    });
    expect(mockRefetchPressure).toHaveBeenCalled();
  });

  it('con dotación capturada renderiza el OperationalPressureGauge real', () => {
    mockPressure = {
      data: pressureResponse(true),
      loading: false,
      error: null,
      refetch: mockRefetchPressure,
    };
    render(<SafetyMetrics />);
    expect(screen.getByTestId('operational-pressure-gauge')).toBeInTheDocument();
    expect(screen.getByTestId('operational-pressure-score')).toBeInTheDocument();
    expect(screen.queryByTestId('operational-pressure-empty')).not.toBeInTheDocument();
  });
});
