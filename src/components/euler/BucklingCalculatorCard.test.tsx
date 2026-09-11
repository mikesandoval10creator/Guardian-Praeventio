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

  it('shows an invalid-geometry state instead of an infinite safety factor', () => {
    render(<BucklingCalculatorCard />);
    fireEvent.change(screen.getByTestId('buckling-length'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('buckling-width'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('buckling-height'), { target: { value: '0' } });

    expect(screen.getByTestId('buckling-pcr')).toHaveTextContent('—');
    expect(screen.getByTestId('buckling-sf')).toHaveTextContent('—');
    expect(screen.getByTestId('buckling-invalid')).toBeInTheDocument();
    expect(screen.queryByTestId('buckling-warning')).not.toBeInTheDocument();
  });

  it('keeps infinity only for valid geometry with zero applied load', () => {
    render(<BucklingCalculatorCard />);
    fireEvent.change(screen.getByTestId('buckling-applied-load'), { target: { value: '0' } });

    expect(screen.getByTestId('buckling-pcr')).not.toHaveTextContent('—');
    expect(screen.getByTestId('buckling-sf')).toHaveTextContent('∞');
    expect(screen.queryByTestId('buckling-invalid')).not.toBeInTheDocument();
  });

  it('warning si SF < 2', () => {
    render(<BucklingCalculatorCard />);
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
