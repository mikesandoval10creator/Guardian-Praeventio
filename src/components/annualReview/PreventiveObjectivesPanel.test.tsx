// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PreventiveObjectivesPanel } from './PreventiveObjectivesPanel.js';
import type { PreventiveObjective } from '../../services/annualReview/annualSgiReview.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function obj(over: Partial<PreventiveObjective> & { id: string }): PreventiveObjective {
  return {
    id: over.id,
    fiscalYear: 2026,
    title: over.title ?? 'Reducir vencidos 30%',
    description: 'd',
    metric: 'percent_reduction',
    baseline: 100,
    target: 70,
    currentValue: over.currentValue ?? 85,
    deadline: '2026-12-31T23:59:59Z',
    ownerUid: 'o1',
    status: 'in_progress',
    linkedActionIds: [],
    evidenceUrls: [],
  };
}

describe('<PreventiveObjectivesPanel />', () => {
  it('empty cuando no hay objetivos', () => {
    render(<PreventiveObjectivesPanel objectives={[]} />);
    expect(screen.getByTestId('objectives-panel-empty')).toBeInTheDocument();
  });

  it('renderiza objetivos con progreso', () => {
    render(<PreventiveObjectivesPanel objectives={[obj({ id: 'o1' })]} />);
    expect(screen.getByTestId('objective-o1')).toBeInTheDocument();
  });

  it('ordena por progreso ascendente (peor primero)', () => {
    render(
      <PreventiveObjectivesPanel
        objectives={[
          obj({ id: 'high', currentValue: 75 }), // 83%
          obj({ id: 'low', currentValue: 95 }), // 17%
          obj({ id: 'mid', currentValue: 85 }), // 50%
        ]}
      />,
    );
    const items = screen.getAllByTestId(/^objective-/);
    expect(items[0].getAttribute('data-testid')).toBe('objective-low');
  });

  it('onObjectiveClick recibe id', () => {
    const onClick = vi.fn();
    render(
      <PreventiveObjectivesPanel objectives={[obj({ id: 'o1' })]} onObjectiveClick={onClick} />,
    );
    fireEvent.click(screen.getByTestId('objective-o1').querySelector('button')!);
    expect(onClick).toHaveBeenCalledWith('o1');
  });
});
