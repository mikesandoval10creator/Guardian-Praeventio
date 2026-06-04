// @vitest-environment jsdom
//
// B7 / ADR 0012 — the "diagnóstico" tab must be an EDUCATIONAL CIE-10 reference,
// not a diagnostic engine. Pins: the CC0 catalog + disclaimer render, and the
// old Gemini differential-diagnosis form (symptoms → ranked conditions →
// suggested treatment) is gone.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, f?: string) => f ?? _k }),
}));
vi.mock('../medical/MedicalIcon', () => ({ MedicalIcon: () => null }));
vi.mock('../health/MedicalDisclaimer', () => ({
  MedicalDisclaimer: () => React.createElement('div', { 'data-testid': 'medical-disclaimer' }),
}));
vi.mock('./CatalogBrowser', () => ({
  CatalogBrowser: () => React.createElement('div', { 'data-testid': 'cie10-catalog' }),
}));
vi.mock('../../data/medical', () => ({
  diagnoses: [],
  diagnosesMeta: { license: 'CC0', source: 'MINSAL' },
}));

import { DifferentialDiagnosis } from './DifferentialDiagnosis';

afterEach(cleanup);

describe('DifferentialDiagnosis — educational CIE-10 reference (B7, ADR 0012)', () => {
  it('renders the CIE-10 reference catalog + disclaimer, NOT a diagnostic form', () => {
    render(<DifferentialDiagnosis />);
    expect(screen.getByTestId('cie10-catalog')).toBeInTheDocument();
    expect(screen.getByTestId('medical-disclaimer')).toBeInTheDocument();
    // The dead diagnostic form is gone.
    expect(screen.queryByText(/Generar diagnóstico diferencial/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tratamiento sugerido/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/tos persistente/i)).not.toBeInTheDocument();
  });

  it('frames itself as reference, not diagnosis', () => {
    render(<DifferentialDiagnosis />);
    expect(screen.getByText(/Referencia clínica CIE-10/i)).toBeInTheDocument();
    expect(screen.getByText(/No es un diagnóstico/i)).toBeInTheDocument();
  });
});
