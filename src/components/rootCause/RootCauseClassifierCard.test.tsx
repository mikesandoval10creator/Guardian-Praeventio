// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RootCauseClassifierCard } from './RootCauseClassifierCard.js';
import type { RootCauseAnalysis } from '../../services/rootCause/rootCauseClassifier.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const baseAnalysis: RootCauseAnalysis = {
  incidentId: 'inc-42',
  factors: ['falla_procedimiento', 'falla_capacitacion'],
  primaryFactor: 'falla_procedimiento',
  fiveWhys: [
    'El operador no siguió el procedimiento de bloqueo de energía',
    'No conocía el procedimiento porque nunca lo capacitaron',
    'Capacitación no estaba en el plan anual del proyecto',
  ],
  analyzedByUid: 'sup-1',
  analyzedAt: '2026-05-10T00:00:00Z',
  suggestedActions: ['Capacitar a la cuadrilla en LOTO', 'Actualizar procedimiento'],
};

describe('<RootCauseClassifierCard />', () => {
  it('renderiza incident id + primary factor', () => {
    render(<RootCauseClassifierCard analysis={baseAnalysis} />);
    expect(screen.getByTestId('root-cause-card')).toBeInTheDocument();
    expect(screen.getByTestId('rc-incident-id')).toHaveTextContent('inc-42');
    expect(screen.getByTestId('rc-primary')).toHaveTextContent('Falla procedimiento');
  });

  it('renderiza todos los factores y los 5 porqués', () => {
    render(<RootCauseClassifierCard analysis={baseAnalysis} />);
    expect(screen.getByTestId('rc-factors')).toHaveTextContent('Falla procedimiento');
    expect(screen.getByTestId('rc-factors')).toHaveTextContent('Falla capacitación');
    const whys = screen.getByTestId('rc-five-whys');
    expect(whys.querySelectorAll('li').length).toBe(3);
  });

  it('renderiza acciones sugeridas', () => {
    render(<RootCauseClassifierCard analysis={baseAnalysis} />);
    const actions = screen.getByTestId('rc-actions');
    expect(actions.querySelectorAll('li').length).toBe(2);
    expect(actions).toHaveTextContent('LOTO');
  });

  it('no renderiza stats si no hay history', () => {
    render(<RootCauseClassifierCard analysis={baseAnalysis} />);
    expect(screen.queryByTestId('rc-stats')).toBeNull();
  });

  it('renderiza stats cuando history se provee', () => {
    const history: RootCauseAnalysis[] = [
      baseAnalysis,
      { ...baseAnalysis, incidentId: 'inc-43', primaryFactor: 'falla_procedimiento' },
      { ...baseAnalysis, incidentId: 'inc-44', primaryFactor: 'falla_epp', factors: ['falla_epp'] },
    ];
    render(<RootCauseClassifierCard analysis={baseAnalysis} history={history} />);
    expect(screen.getByTestId('rc-stats')).toBeInTheDocument();
    expect(screen.getByTestId('rc-stat-falla_procedimiento')).toHaveTextContent('67%');
  });
});
