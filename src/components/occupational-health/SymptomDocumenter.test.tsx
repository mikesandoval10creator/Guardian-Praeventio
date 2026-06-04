// @vitest-environment jsdom
//
// B7 / ADR 0012 — SymptomDocumenter replaces the diagnostic MedicalAnalyzer.
// It must help the worker DOCUMENT symptoms (where, since when, how, how it
// feels) into doctor-ready evidence — and NEVER produce a diagnosis (no
// inferred severity/specialist/treatment/recovery). These tests pin that.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { BodyRegion } from './HumanBodyViewer';
import { SymptomDocumenter, buildSymptomSummary, type RegionSymptomDetail } from './SymptomDocumenter';

vi.mock('../health/MedicalDisclaimer', () => ({
  MedicalDisclaimer: () => React.createElement('div', { 'data-testid': 'medical-disclaimer' }),
}));

afterEach(cleanup);

const marked = (over: Partial<BodyRegion> = {}): BodyRegion => ({
  id: 'head',
  label: 'Cabeza / Cuello',
  severity: 'moderado',
  ...over,
});

describe('buildSymptomSummary (pure)', () => {
  it('organizes the worker\'s own input into a doctor-ready, non-diagnostic summary', () => {
    const detail: RegionSymptomDetail = {
      onset: 'hace 3 días',
      mechanism: 'esfuerzo',
      sensations: ['dolor', 'rigidez'],
      intensity: 6,
      modifiers: 'empeora al girar el cuello',
      notes: 'me cuesta dormir',
    };
    const summary = buildSymptomSummary(
      [marked(), { id: 'leg', label: 'Pierna Izquierda', severity: null }],
      { head: detail },
    );

    expect(summary).toContain('RESUMEN DE SÍNTOMAS PARA MI MÉDICO');
    expect(summary).toContain('NO es un diagnóstico');
    expect(summary).toContain('Cabeza / Cuello');
    expect(summary).toContain('Desde cuándo: hace 3 días');
    expect(summary).toContain('Cómo se produjo: Esfuerzo / sobrecarga');
    expect(summary).toContain('Cómo lo siento: Dolor, Rigidez');
    expect(summary).toContain('Intensidad (1–10): 6');
    expect(summary).toContain('empeora al girar el cuello');
    expect(summary).toContain('me cuesta dormir');
    // Unmarked region is excluded.
    expect(summary).not.toContain('Pierna Izquierda');
  });

  it('omits fields the worker left blank (no fabricated content)', () => {
    const summary = buildSymptomSummary([marked()], {});
    expect(summary).toContain('Cabeza / Cuello');
    expect(summary).not.toContain('Desde cuándo:');
    expect(summary).not.toContain('Intensidad');
  });
});

describe('SymptomDocumenter (component)', () => {
  it('shows an empty prompt when no body region is marked', () => {
    render(<SymptomDocumenter regions={[marked({ severity: null })]} />);
    expect(screen.getByText(/Marca en el visor corporal/i)).toBeInTheDocument();
  });

  it('renders a documentation card per marked region + the doctor summary + disclaimer', () => {
    render(
      <SymptomDocumenter
        regions={[marked(), { id: 'leg', label: 'Pierna Izquierda', severity: null }]}
      />,
    );
    expect(screen.getByText('Cabeza / Cuello')).toBeInTheDocument();
    expect(screen.queryByText('Pierna Izquierda')).not.toBeInTheDocument(); // unmarked
    expect(screen.getByText(/Resumen para tu médico/i)).toBeInTheDocument();
    expect(screen.getByTestId('medical-disclaimer')).toBeInTheDocument();
  });

  it('produces NO diagnosis — no inferred severity verdict, specialist, treatment or recovery', () => {
    const { container } = render(<SymptomDocumenter regions={[marked()]} />);
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toContain('diagnóstico diferencial');
    expect(text).not.toContain('especialista recomendado');
    expect(text).not.toContain('tratamiento sugerido');
    expect(text).not.toContain('tiempo de recuperación');
    expect(text).not.toContain('requiere hospitalización');
  });

  it('updates the doctor summary as the worker documents a symptom', () => {
    const { container } = render(<SymptomDocumenter regions={[marked()]} />);
    const onset = screen.getByPlaceholderText(/hace 3 días/i);
    fireEvent.change(onset, { target: { value: 'desde el lunes' } });
    expect((container.textContent ?? '')).toContain('Desde cuándo: desde el lunes');
  });
});
