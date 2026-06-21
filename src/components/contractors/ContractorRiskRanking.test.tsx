// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContractorRiskRanking } from './ContractorRiskRanking.js';
import type { ContractorPerformanceResponse } from '../../hooks/useContractorPerformance';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

// Only the network is mocked — the hook, the ranking math and the table render
// run for real against the real server payload shape.
vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
}));

function mockPerformance(body: ContractorPerformanceResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    })) as unknown as typeof fetch,
  );
}

function row(over: {
  contractorId: string;
  contractorName?: string;
  trir: number;
  severityRate: number;
}) {
  return {
    contractorId: over.contractorId,
    contractorName: over.contractorName ?? `C ${over.contractorId}`,
    totalHoursWorked: 100_000,
    counts: {
      totalRecordable: 0,
      lostTime: 0,
      restrictedOrTransferred: 0,
      seriousInjuriesAndFatalities: 0,
      fatalities: 0,
      totalLostDays: 0,
    },
    report: {
      trir: over.trir,
      ltifr: 0,
      dart: 0,
      sifr: 0,
      severityRate: over.severityRate,
      frequencyIndex: 0,
      fatalityRate: 0,
      totalHoursWorked: 100_000,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<ContractorRiskRanking />', () => {
  it('sin proyecto muestra CTA, no fabrica ranking', () => {
    render(<ContractorRiskRanking projectId={null} />);
    expect(screen.getByTestId('contractor-ranking-no-project')).toBeInTheDocument();
  });

  it('empty honesto cuando el servidor no devuelve contratistas', async () => {
    mockPerformance({ period: '2026-06', contractors: [] });
    render(<ContractorRiskRanking projectId="p1" period="2026-06" />);
    await waitFor(() =>
      expect(screen.getByTestId('contractor-ranking-empty')).toBeInTheDocument(),
    );
  });

  it('ordena por riesgo real (peor TRIR primero) desde el payload del servidor', async () => {
    mockPerformance({
      period: '2026-06',
      contractors: [
        row({ contractorId: 'safe', trir: 0, severityRate: 0 }),
        row({ contractorId: 'risky', trir: 12, severityRate: 3000 }),
      ],
    });
    render(<ContractorRiskRanking projectId="p1" period="2026-06" />);
    await waitFor(() =>
      expect(screen.getByTestId('contractor-ranking-table')).toBeInTheDocument(),
    );
    const rows = screen.getAllByTestId(/^contractor-row-/);
    expect(rows[0].getAttribute('data-testid')).toBe('contractor-row-risky');
    // El TRIR mostrado proviene del report del servidor, no se inventa.
    expect(screen.getByTestId('contractor-row-risky')).toHaveTextContent('12');
  });

  it('reenvía el contractorId real al click handler', async () => {
    const onClick = vi.fn();
    mockPerformance({
      period: '2026-06',
      contractors: [row({ contractorId: 'c9', trir: 5, severityRate: 0 })],
    });
    render(
      <ContractorRiskRanking projectId="p1" period="2026-06" onContractorClick={onClick} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('contractor-row-c9')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('contractor-row-c9'));
    expect(onClick).toHaveBeenCalledWith('c9');
  });

  it('llama al endpoint real de performance del sprint-k', async () => {
    mockPerformance({ period: '2026-06', contractors: [] });
    render(<ContractorRiskRanking projectId="proj42" period="2026-06" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUrl).toContain('/api/sprint-k/proj42/contractors/performance');
    expect(calledUrl).toContain('period=2026-06');
  });
});
