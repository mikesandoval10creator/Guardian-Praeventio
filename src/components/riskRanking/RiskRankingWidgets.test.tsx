// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TopRisksWidget } from './TopRisksWidget.js';
import { WeakControlsWidget } from './WeakControlsWidget.js';
import type {
  RiskRecord,
  ControlRecord,
} from '../../services/riskRanking/riskRankingEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function risk(id: string, severity: 'low' | 'medium' | 'high' | 'critical', extras: Partial<RiskRecord> = {}): RiskRecord {
  return {
    id,
    projectId: 'p1',
    category: 'altura',
    severity,
    exposedWorkerCount: 5,
    recentFindingCount: 2,
    linkedIncidentCount: 1,
    overdueActionCount: 0,
    ...extras,
  };
}

function control(id: string, label: string, failureCount: number, verificationCount: number): ControlRecord {
  return {
    id,
    projectId: 'p1',
    label,
    failureCount,
    verificationCount,
    daysSinceLastVerification: 0,
  };
}

describe('<TopRisksWidget />', () => {
  it('muestra empty si no hay riesgos', () => {
    render(<TopRisksWidget risks={[]} />);
    expect(screen.getByTestId('top-risks-widget')).toBeInTheDocument();
    expect(screen.getByText(/Sin riesgos/i)).toBeInTheDocument();
  });

  it('rankea por score descendente', () => {
    const risks = [
      risk('low-id', 'low', { recentFindingCount: 0, linkedIncidentCount: 0 }),
      risk('crit-id', 'critical', { recentFindingCount: 5, linkedIncidentCount: 3 }),
      risk('med-id', 'medium', { recentFindingCount: 1 }),
    ];
    render(<TopRisksWidget risks={risks} topN={3} />);
    const items = screen.getAllByTestId(/^top-risk-/);
    expect(items).toHaveLength(3);
    expect(items[0].getAttribute('data-testid')).toBe('top-risk-crit-id');
  });

  it('onRiskClick dispara con id', () => {
    const onClick = vi.fn();
    render(
      <TopRisksWidget
        risks={[risk('r1', 'high')]}
        topN={1}
        onRiskClick={onClick}
      />,
    );
    const btn = screen.getByTestId('top-risk-r1').querySelector('button')!;
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledWith('r1');
  });
});

describe('<WeakControlsWidget />', () => {
  it('empty state sin controles', () => {
    render(<WeakControlsWidget controls={[]} />);
    expect(screen.getByText(/Sin controles/i)).toBeInTheDocument();
  });

  it('rankea por failure rate', () => {
    const controls = [
      control('c-strong', 'Control fuerte', 0, 10),
      control('c-weak', 'Control débil', 8, 10),
      control('c-mid', 'Control medio', 3, 10),
    ];
    render(<WeakControlsWidget controls={controls} topN={3} />);
    const items = screen.getAllByTestId(/^weak-control-/);
    expect(items[0].getAttribute('data-testid')).toBe('weak-control-c-weak');
  });

  it('onControlClick dispara con id', () => {
    const onClick = vi.fn();
    render(
      <WeakControlsWidget
        controls={[control('c1', 'Test', 5, 10)]}
        topN={1}
        onControlClick={onClick}
      />,
    );
    const btn = screen.getByTestId('weak-control-c1').querySelector('button')!;
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledWith('c1');
  });
});
