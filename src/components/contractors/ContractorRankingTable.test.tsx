// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContractorRankingTable } from './ContractorRankingTable.js';
import type { ContractorPerformance } from '../../services/contractors/contractorKpiService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function perf(over: Partial<ContractorPerformance> & { contractorId: string }): ContractorPerformance {
  return {
    contractorId: over.contractorId,
    legalName: over.legalName ?? `C ${over.contractorId}`,
    manDaysWorked: 100,
    manHoursWorked: over.manHoursWorked ?? 100_000,
    recordableIncidents: over.recordableIncidents ?? 0,
    lostTimeDays: 0,
    overdueActions: 0,
    trainingCompletionRate: 1,
    documentationCurrentRate: 1,
  };
}

describe('<ContractorRankingTable />', () => {
  it('empty si no hay datos', () => {
    render(<ContractorRankingTable performances={[]} />);
    expect(screen.getByTestId('contractor-ranking-empty')).toBeInTheDocument();
  });

  it('ordena peor primero', () => {
    render(
      <ContractorRankingTable
        performances={[
          perf({ contractorId: 'safe' }),
          perf({ contractorId: 'risky', recordableIncidents: 10, manHoursWorked: 200_000 }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId(/^contractor-row-/);
    expect(rows[0].getAttribute('data-testid')).toBe('contractor-row-risky');
  });

  it('onContractorClick recibe id', () => {
    const onClick = vi.fn();
    render(
      <ContractorRankingTable
        performances={[perf({ contractorId: 'c1' })]}
        onContractorClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('contractor-row-c1'));
    expect(onClick).toHaveBeenCalledWith('c1');
  });
});
