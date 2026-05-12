// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BucklingCalculatorCard } from './BucklingCalculatorCard.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<BucklingCalculatorCard />', () => {
  it('renderiza con defaults y muestra P_cr', () => {
    render(<BucklingCalculatorCard />);
    expect(screen.getByTestId('buckling-card')).toBeInTheDocument();
    expect(screen.getByTestId('buckling-pcr')).toBeInTheDocument();
    expect(screen.getByTestId('buckling-sf')).toBeInTheDocument();
  });

  it('cambio length recalcula', () => {
    render(<BucklingCalculatorCard />);
    const input = screen.getByTestId('buckling-length') as HTMLInputElement;
    const initial = screen.getByTestId('buckling-pcr').textContent;
    fireEvent.change(input, { target: { value: '10' } });
    expect(screen.getByTestId('buckling-pcr').textContent).not.toBe(initial);
  });

  it('warning si SF < 2', () => {
    render(<BucklingCalculatorCard />);
    // Aumentar carga aplicada para forzar SF < 2 con defaults
    const load = screen.getByTestId('buckling-applied-load') as HTMLInputElement;
    fireEvent.change(load, { target: { value: '80000' } });
    expect(screen.getByTestId('buckling-warning')).toBeInTheDocument();
  });

  it('dispara onResult', () => {
    const onResult = vi.fn();
    render(<BucklingCalculatorCard onResult={onResult} />);
    expect(onResult).toHaveBeenCalled();
  });
});
