// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LegalDocGeneratorForm } from './LegalDocGeneratorForm.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

// Frontier mock: the real PDF rendering pipeline (jspdf) is exercised in
// legalDocPdf.test.ts. Here we assert the form drives the download with the
// REAL rendered markdown produced by the (un-mocked) legalDocTemplates service.
const downloadLegalDocPdf = vi.fn();
vi.mock('../../utils/legalDocPdf.js', () => ({
  downloadLegalDocPdf: (...args: unknown[]) => downloadLegalDocPdf(...args),
}));

beforeEach(() => {
  downloadLegalDocPdf.mockClear();
});

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

  it('genera el PDF REAL (download) con el markdown renderizado + dispara onGenerate', () => {
    const onGen = vi.fn();
    render(<LegalDocGeneratorForm onGenerate={onGen} initialKind="ODI" />);
    fireEvent.change(screen.getByTestId('legaldoc-field-workerName'), {
      target: { value: 'Ana Pérez' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-workerRut'), {
      target: { value: '15.123.456-7' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-position'), {
      target: { value: 'Operadora de grúa' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-companyName'), {
      target: { value: 'Constructora Andes' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-date'), {
      target: { value: '2026-05-12' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-specificRisks'), {
      target: { value: 'Trabajo en altura' },
    });
    fireEvent.click(screen.getByTestId('legaldoc-generate-btn'));

    // The REAL download was triggered with the kind + the rendered markdown
    // that embeds the user-typed data (proves the template ran for real).
    expect(downloadLegalDocPdf).toHaveBeenCalledTimes(1);
    const [pdfInput, kindArg] = downloadLegalDocPdf.mock.calls[0];
    expect(kindArg).toBe('ODI');
    expect(pdfInput.title).toMatch(/Obligación de Informar/);
    expect(pdfInput.markdown).toContain('Ana Pérez');
    expect(pdfInput.markdown).toContain('Operadora de grúa');
    expect(pdfInput.markdown).toContain('Trabajo en altura');
    expect(pdfInput.references).toEqual(expect.arrayContaining([expect.stringMatching(/Ley 16\.744 art\. 21/)]));

    // The optional persistence callback still fires after the download.
    expect(onGen).toHaveBeenCalled();
    expect(onGen.mock.calls[0][0]).toBe('ODI');
  });

  it('no genera ni descarga si faltan campos requeridos (botón deshabilitado)', () => {
    const onGen = vi.fn();
    render(<LegalDocGeneratorForm onGenerate={onGen} initialKind="ODI" />);
    fireEvent.click(screen.getByTestId('legaldoc-generate-btn'));
    expect(downloadLegalDocPdf).not.toHaveBeenCalled();
    expect(onGen).not.toHaveBeenCalled();
  });

  it('referencias normativas visibles', () => {
    render(<LegalDocGeneratorForm />);
    expect(screen.getByTestId('legaldoc-references').textContent).toMatch(/Ley 16.744/);
  });
});
