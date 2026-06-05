// @vitest-environment jsdom
//
// B7 / ADR 0012 — the "fármacos" tab must be an EDUCATIONAL Vademécum reference,
// not clinical decision support. Pins: the CC0 ATC catalog + disclaimer render,
// and the old Gemini "is this safe to administer?" form is gone.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, f?: string) => (typeof f === 'string' ? f : _k) }),
}));
vi.mock('../medical/MedicalIcon', () => ({ MedicalIcon: () => null }));
vi.mock('../health/MedicalDisclaimer', () => ({
  MedicalDisclaimer: () => React.createElement('div', { 'data-testid': 'medical-disclaimer' }),
}));
vi.mock('./CatalogBrowser', () => ({
  CatalogBrowser: () => React.createElement('div', { 'data-testid': 'atc-catalog' }),
}));
vi.mock('../../data/medical', () => ({
  drugs: [],
  drugsMeta: { license: 'CC0', source: 'ISP' },
}));

import { DrugInteractions } from './DrugInteractions';

afterEach(cleanup);

describe('DrugInteractions — educational Vademécum reference (B7, ADR 0012)', () => {
  it('renders the ATC reference catalog + disclaimer, NOT a clinical analysis form', () => {
    render(<DrugInteractions />);
    expect(screen.getByTestId('atc-catalog')).toBeInTheDocument();
    expect(screen.getByTestId('medical-disclaimer')).toBeInTheDocument();
    // The dead clinical-decision form is gone.
    expect(screen.queryByText(/Analizar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/safe to administer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/segura con precauciones/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Ibuprofeno, Enalapril/i)).not.toBeInTheDocument();
  });

  it('frames itself as reference, not medical indication', () => {
    render(<DrugInteractions />);
    expect(screen.getByText(/referencia farmacológica/i)).toBeInTheDocument();
    expect(screen.getByText(/No es indicación médica/i)).toBeInTheDocument();
  });
});
