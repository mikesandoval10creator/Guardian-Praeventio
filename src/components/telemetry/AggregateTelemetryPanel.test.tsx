// @vitest-environment jsdom
//
// F.30 — AggregateTelemetryPanel tests. The panel consumes the real
// useAggregateTelemetry hook (which fetches
// /api/sprint-k/:projectId/telemetry/aggregate). We mock ONLY the hook (the
// network boundary) and assert the panel renders the REAL aggregated shape,
// an honest empty-state, loading, and error.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

import type { AggregateTelemetryResponse } from '../../hooks/useAggregateTelemetry';

const useAggregateTelemetry = vi.fn();

vi.mock('../../hooks/useAggregateTelemetry', () => ({
  useAggregateTelemetry: (projectId: string | null, window: string) =>
    useAggregateTelemetry(projectId, window),
}));

// i18n: return the inline default so assertions read real es-CL copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: unknown, opts?: Record<string, unknown>) => {
      let s = typeof def === 'string' ? def : _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          s = s.replace(`{{${k}}}`, String(v));
        }
      }
      return s;
    },
  }),
}));

import { AggregateTelemetryPanel } from './AggregateTelemetryPanel';

const fullResponse: AggregateTelemetryResponse = {
  feed: {
    projectId: 'proj-1',
    tenantId: 'tenant-1',
    window: '7d',
    windowStartIso: '2026-06-13T00:00:00.000Z',
    windowEndIso: '2026-06-20T00:00:00.000Z',
    countByKind: {
      incident_recorded: 3,
      epp_delivered: 5,
    },
    countBySeverity: { low: 1, medium: 2, high: 3, critical: 4 },
    totalEvents: 8,
  },
  velocities: [
    { kind: 'epp_delivered', count: 5, perDay: 0.71 },
    { kind: 'incident_recorded', count: 3, perDay: 0.43 },
  ],
};

function state(over: Partial<{
  data: AggregateTelemetryResponse | null;
  loading: boolean;
  error: Error | null;
}>) {
  return {
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  };
}

beforeEach(() => useAggregateTelemetry.mockReset());
afterEach(() => cleanup());

describe('AggregateTelemetryPanel', () => {
  it('renders real aggregated data (totals, severity, per-kind velocities)', () => {
    useAggregateTelemetry.mockReturnValue(state({ data: fullResponse }));
    render(<AggregateTelemetryPanel projectId="proj-1" />);

    expect(screen.getByTestId('aggregate-telemetry-data')).toBeInTheDocument();
    // Total events
    expect(screen.getByText('8')).toBeInTheDocument();
    // Critical severity count (4) renders
    expect(screen.getByText('Crítica')).toBeInTheDocument();
    // Per-kind rows with real labels + counts
    const eppRow = screen.getByTestId('aggregate-kind-epp_delivered');
    expect(eppRow).toHaveTextContent('EPP entregados');
    expect(eppRow).toHaveTextContent('5');
    expect(eppRow).toHaveTextContent('0.71/día');
    expect(
      screen.getByTestId('aggregate-kind-incident_recorded'),
    ).toHaveTextContent('Incidentes registrados');
  });

  it('renders an honest empty-state when totalEvents is 0 (no fabricated data)', () => {
    useAggregateTelemetry.mockReturnValue(
      state({
        data: {
          feed: { ...fullResponse.feed, totalEvents: 0, countByKind: {}, countBySeverity: { low: 0, medium: 0, high: 0, critical: 0 } },
          velocities: [],
        },
      }),
    );
    render(<AggregateTelemetryPanel projectId="proj-1" />);

    expect(screen.getByTestId('aggregate-telemetry-empty')).toBeInTheDocument();
    expect(
      screen.queryByTestId('aggregate-telemetry-data'),
    ).not.toBeInTheDocument();
  });

  it('shows the loading state while fetching', () => {
    useAggregateTelemetry.mockReturnValue(state({ loading: true }));
    render(<AggregateTelemetryPanel projectId="proj-1" />);
    expect(
      screen.getByTestId('aggregate-telemetry-loading'),
    ).toBeInTheDocument();
  });

  it('shows an error message when the fetch fails', () => {
    useAggregateTelemetry.mockReturnValue(
      state({ error: new Error('http_500') }),
    );
    render(<AggregateTelemetryPanel projectId="proj-1" />);
    expect(
      screen.getByText(/No se pudo cargar la telemetría agregada/),
    ).toBeInTheDocument();
  });

  it('prompts to select a project when projectId is null and does not call the endpoint hook with a project', () => {
    useAggregateTelemetry.mockReturnValue(state({}));
    render(<AggregateTelemetryPanel projectId={null} />);
    expect(
      screen.getByText(/Selecciona un proyecto/),
    ).toBeInTheDocument();
    expect(useAggregateTelemetry).toHaveBeenCalledWith(null, '7d');
  });

  it('refetches for a different window when a window button is clicked', () => {
    useAggregateTelemetry.mockReturnValue(state({ data: fullResponse }));
    render(<AggregateTelemetryPanel projectId="proj-1" />);

    // Initial call is 7d.
    expect(useAggregateTelemetry).toHaveBeenCalledWith('proj-1', '7d');

    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    expect(useAggregateTelemetry).toHaveBeenCalledWith('proj-1', '30d');
  });
});
