// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DrillsCompliancePanel } from './DrillsCompliancePanel.js';
import type { DrillResult } from '../../services/drillsManager/drillsManager.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function result(over: Partial<DrillResult> & { id: string }): DrillResult {
  return {
    id: over.id,
    drillKind: over.drillKind ?? 'evacuation',
    executedAt: over.executedAt ?? '2026-04-01T00:00:00Z',
    participantCount: 90,
    expectedCount: 100,
    responseTimeSeconds: 200,
    benchmarkSeconds: 240,
    observedGaps: [],
    requiredExternal: false,
  };
}

describe('<DrillsCompliancePanel />', () => {
  it('todos atrasados si historia vacía', () => {
    render(<DrillsCompliancePanel history={[]} />);
    expect(screen.getByTestId('drills-overdue')).toBeInTheDocument();
    expect(screen.getByTestId('drills-overdue-badge')).toBeInTheDocument();
  });

  it('próximos visibles cuando hay ejecutados recientes', () => {
    render(
      <DrillsCompliancePanel
        history={[
          result({ id: 'd1', drillKind: 'evacuation', executedAt: new Date().toISOString() }),
        ]}
      />,
    );
    expect(screen.getByTestId('drill-upcoming-evacuation')).toBeInTheDocument();
  });

  it('onScheduleClick recibe el kind', () => {
    const onClick = vi.fn();
    render(<DrillsCompliancePanel history={[]} onScheduleClick={onClick} />);
    fireEvent.click(screen.getByTestId('drill-schedule-evacuation'));
    expect(onClick).toHaveBeenCalledWith('evacuation');
  });
});
