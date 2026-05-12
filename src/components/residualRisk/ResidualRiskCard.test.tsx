// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResidualRiskCard } from './ResidualRiskCard.js';
import type {
  RiskAssessment,
  AppliedControl,
} from '../../services/residualRisk/residualRiskEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const highRisk: RiskAssessment = {
  riskId: 'r1',
  category: 'Trabajo en altura',
  likelihood: 'likely',
  severity: 'major',
  riskKind: 'physical',
};

const lowControls: AppliedControl[] = [{ controlId: 'c1', effectiveness: 'minimal' }];
const strongControls: AppliedControl[] = [
  { controlId: 'c1', effectiveness: 'full' },
  { controlId: 'c2', effectiveness: 'significant' },
];

describe('<ResidualRiskCard />', () => {
  it('renderiza score inicial y residual', () => {
    render(<ResidualRiskCard assessment={highRisk} controls={lowControls} />);
    expect(screen.getByTestId('residual-risk-card-r1')).toBeInTheDocument();
    expect(screen.getByTestId('residual-level-r1')).toBeInTheDocument();
  });

  it('muestra banner aceptación formal si residual high/extreme', () => {
    render(<ResidualRiskCard assessment={highRisk} controls={lowControls} />);
    expect(screen.getByTestId('residual-acceptance-r1')).toBeInTheDocument();
  });

  it('no muestra banner si controles fuertes bajan a low/medium', () => {
    render(<ResidualRiskCard assessment={highRisk} controls={strongControls} />);
    expect(screen.queryByTestId('residual-acceptance-r1')).toBeNull();
  });

  it('dispara onRequestAcceptance al click', () => {
    const onReq = vi.fn();
    render(
      <ResidualRiskCard
        assessment={highRisk}
        controls={lowControls}
        onRequestAcceptance={onReq}
      />,
    );
    fireEvent.click(screen.getByTestId('residual-acceptance-btn-r1'));
    expect(onReq).toHaveBeenCalledWith('r1');
  });
});
