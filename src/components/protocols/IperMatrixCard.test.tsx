// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IperMatrixCard } from './IperMatrixCard.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<IperMatrixCard />', () => {
  it('renderiza con valores iniciales 3x3 → moderado', () => {
    render(<IperMatrixCard />);
    expect(screen.getByTestId('iper-matrix-card')).toBeInTheDocument();
    expect(screen.getByTestId('iper-level').textContent).toBe('moderado');
    expect(screen.getByTestId('iper-score').textContent).toBe('9');
  });

  it('5x5 → intolerable', () => {
    render(<IperMatrixCard initialProbability={5} initialSeverity={5} />);
    expect(screen.getByTestId('iper-level').textContent).toBe('intolerable');
  });

  it('cambio en select actualiza', () => {
    render(<IperMatrixCard />);
    const sev = screen.getByTestId('iper-severity') as HTMLSelectElement;
    fireEvent.change(sev, { target: { value: '5' } });
    expect(screen.getByTestId('iper-score').textContent).toBe('15');
  });

  it('control effectiveness produce residual', () => {
    render(
      <IperMatrixCard
        initialProbability={4}
        initialSeverity={4}
        initialControlEffectiveness="high"
      />,
    );
    expect(screen.getByTestId('iper-residual')).toBeInTheDocument();
  });

  it('dispara onChange', () => {
    const onChange = vi.fn();
    render(<IperMatrixCard onChange={onChange} />);
    expect(onChange).toHaveBeenCalled();
  });
});
