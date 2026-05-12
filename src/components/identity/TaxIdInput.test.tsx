// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaxIdInput } from './TaxIdInput.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<TaxIdInput />', () => {
  it('renderiza placeholder por país', () => {
    render(<TaxIdInput country="CL" />);
    const input = screen.getByTestId('tax-id-field-cl') as HTMLInputElement;
    expect(input.placeholder).toMatch(/12\.345\.678-9/);
  });

  it('valida RUT chileno OK', () => {
    render(<TaxIdInput country="CL" initialValue="12.345.678-5" />);
    expect(screen.getByTestId('tax-id-icon-cl-ok')).toBeInTheDocument();
  });

  it('marca inválido para RUT mal formado', () => {
    render(<TaxIdInput country="CL" initialValue="abc" />);
    expect(screen.getByTestId('tax-id-icon-cl-err')).toBeInTheDocument();
  });

  it('dispara onValidate', () => {
    const onValidate = vi.fn();
    render(<TaxIdInput country="CL" onValidate={onValidate} />);
    const input = screen.getByTestId('tax-id-field-cl') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12.345.678-5' } });
    expect(onValidate).toHaveBeenCalledWith(
      '12.345.678-5',
      expect.objectContaining({ valid: true }),
    );
  });
});
