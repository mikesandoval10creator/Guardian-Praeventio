// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarrierAnalysisCard } from './BarrierAnalysisCard.js';
import type {
  CriticalControl,
  ControlValidation,
} from '../../services/criticalControls/criticalControlsLibrary.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const catalog: CriticalControl[] = [
  {
    id: 'c1',
    riskCategory: 'altura',
    label: 'Línea de vida',
    level: 'engineering',
    verificationMethod: 'visual',
    normReference: 'DS 594',
  },
  {
    id: 'c2',
    riskCategory: 'altura',
    label: 'Arnés',
    level: 'epp',
    verificationMethod: 'visual',
    normReference: 'DS 594',
  },
  {
    id: 'c3',
    riskCategory: 'altura',
    label: 'Permiso',
    level: 'administrative',
    verificationMethod: 'documental',
    normReference: 'DS 76',
  },
];

function val(controlId: string, present: boolean): ControlValidation {
  return {
    controlId,
    present,
    validatedByUid: 'sup1',
    validatedAt: '2026-05-12T10:00:00Z',
  };
}

describe('<BarrierAnalysisCard />', () => {
  it('flag single barrier cuando hay solo 1 viva', () => {
    render(
      <BarrierAnalysisCard
        riskCategory="altura"
        catalog={catalog}
        validations={[val('c1', true), val('c2', false), val('c3', false)]}
      />,
    );
    expect(screen.getByTestId('barrier-card-altura')).toBeInTheDocument();
    expect(screen.getByTestId('barrier-single-altura')).toBeInTheDocument();
    expect(screen.getByTestId('barrier-count-altura').textContent).toMatch(/1/);
  });

  it('no flag con múltiples capas vivas', () => {
    render(
      <BarrierAnalysisCard
        riskCategory="altura"
        catalog={catalog}
        validations={[val('c1', true), val('c2', true), val('c3', true)]}
      />,
    );
    expect(screen.queryByTestId('barrier-single-altura')).toBeNull();
    expect(screen.getByTestId('barrier-count-altura').textContent).toMatch(/3/);
  });

  it('renderiza niveles ISO', () => {
    render(
      <BarrierAnalysisCard
        riskCategory="altura"
        catalog={catalog}
        validations={[val('c1', true)]}
      />,
    );
    expect(screen.getByTestId('barrier-level-altura-elimination')).toBeInTheDocument();
    expect(screen.getByTestId('barrier-level-altura-engineering')).toBeInTheDocument();
    expect(screen.getByTestId('barrier-level-altura-epp')).toBeInTheDocument();
  });
});
