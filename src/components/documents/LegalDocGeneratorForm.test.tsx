// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LegalDocGeneratorForm } from './LegalDocGeneratorForm.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<LegalDocGeneratorForm />', () => {
  it('renderiza selector de tipo + campos requeridos del default RIOHS', () => {
    render(<LegalDocGeneratorForm />);
    expect(screen.getByTestId('legaldoc-form')).toBeInTheDocument();
    expect(screen.getByTestId('legaldoc-kind')).toBeInTheDocument();
    expect(screen.getByTestId('legaldoc-field-companyName')).toBeInTheDocument();
    expect(screen.getByTestId('legaldoc-field-projectName')).toBeInTheDocument();
  });

  it('warning de campos faltantes al inicio', () => {
    render(<LegalDocGeneratorForm />);
    expect(screen.getByTestId('legaldoc-missing-warning')).toBeInTheDocument();
  });

  it('llena campos → desaparece warning + botón habilitado', () => {
    render(<LegalDocGeneratorForm />);
    fireEvent.change(screen.getByTestId('legaldoc-field-companyName'), {
      target: { value: 'Constructora Andes' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-companyRut'), {
      target: { value: '76.111.222-3' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-projectName'), {
      target: { value: 'Obra Andina' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-date'), {
      target: { value: '2026-05-12' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-workerCount'), {
      target: { value: '120' },
    });
    expect(screen.queryByTestId('legaldoc-missing-warning')).toBeNull();
    expect(screen.getByTestId('legaldoc-markdown').textContent).toMatch(/Constructora Andes/);
  });

  it('cambio de tipo limpia data y muestra los nuevos required', () => {
    render(<LegalDocGeneratorForm />);
    const select = screen.getByTestId('legaldoc-kind') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'DDR' } });
    expect(screen.getByTestId('legaldoc-field-workerName')).toBeInTheDocument();
    expect(screen.getByTestId('legaldoc-field-workerRut')).toBeInTheDocument();
  });

  it('dispara onGenerate con el result cuando OK', () => {
    const onGen = vi.fn();
    render(<LegalDocGeneratorForm onGenerate={onGen} initialKind="ODI" />);
    fireEvent.change(screen.getByTestId('legaldoc-field-workerName'), {
      target: { value: 'Ana' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-workerRut'), {
      target: { value: 'r' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-position'), {
      target: { value: 'Operadora' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-companyName'), {
      target: { value: 'X' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-date'), {
      target: { value: '2026-05-12' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-specificRisks'), {
      target: { value: 'Trabajo en altura' },
    });
    fireEvent.click(screen.getByTestId('legaldoc-generate-btn'));
    expect(onGen).toHaveBeenCalled();
    expect(onGen.mock.calls[0][0]).toBe('ODI');
  });

  it('referencias normativas visibles', () => {
    render(<LegalDocGeneratorForm />);
    expect(screen.getByTestId('legaldoc-references').textContent).toMatch(/Ley 16.744/);
  });
});
