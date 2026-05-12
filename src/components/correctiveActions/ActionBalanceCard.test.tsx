// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionBalanceCard } from './ActionBalanceCard.js';
import type { CorrectiveAction } from '../../services/correctiveActions/weakActionDetector.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function act(id: string, level: CorrectiveAction['level']): CorrectiveAction {
  return {
    id,
    description: `Acción ${id}`,
    level,
    status: 'open',
    isSystemic: false,
  };
}

describe('<ActionBalanceCard />', () => {
  it('renderiza barras por nivel', () => {
    render(
      <ActionBalanceCard
        actions={[act('a', 'engineering'), act('b', 'training'), act('c', 'epp')]}
      />,
    );
    expect(screen.getByTestId('action-balance-card')).toBeInTheDocument();
    expect(screen.getByTestId('action-balance-row-engineering')).toBeInTheDocument();
    expect(screen.getByTestId('action-balance-row-training')).toBeInTheDocument();
  });

  it('flag desequilibrio si >70% son training', () => {
    const actions: CorrectiveAction[] = [
      act('1', 'training'),
      act('2', 'training'),
      act('3', 'training'),
      act('4', 'training'),
      act('5', 'engineering'),
    ];
    render(<ActionBalanceCard actions={actions} />);
    expect(screen.getByTestId('action-balance-imbalanced')).toBeInTheDocument();
  });

  it('no flag si balance está OK', () => {
    const actions: CorrectiveAction[] = [
      act('1', 'engineering'),
      act('2', 'training'),
      act('3', 'administrative'),
    ];
    render(<ActionBalanceCard actions={actions} />);
    expect(screen.queryByTestId('action-balance-imbalanced')).toBeNull();
  });
});
