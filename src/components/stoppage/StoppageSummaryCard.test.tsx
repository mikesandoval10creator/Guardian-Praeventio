// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoppageSummaryCard } from './StoppageSummaryCard.js';
import type { StoppageSummary } from '../../services/stoppage/stoppageEngine.js';

const summary: StoppageSummary = {
  total: 5,
  active: 1,
  pendingResumption: 2,
  resumed: 1,
  cancelled: 1,
  longestActiveHours: 3.25,
};

describe('<StoppageSummaryCard />', () => {
  it('muestra totales y stats por estado', () => {
    render(<StoppageSummaryCard summary={summary} projectLabel="Faena Norte" />);
    expect(screen.getByTestId('stoppage.card.title')).toHaveTextContent('Faena Norte');
    expect(screen.getByTestId('stoppage.card.total')).toHaveTextContent('5');
    expect(screen.getByTestId('stoppage.card.active')).toHaveTextContent('1');
    expect(screen.getByTestId('stoppage.card.pending')).toHaveTextContent('2');
    expect(screen.getByTestId('stoppage.card.resumed')).toHaveTextContent('1');
    expect(screen.getByTestId('stoppage.card.cancelled')).toHaveTextContent('1');
  });

  it('muestra horas de la más larga activa formateado', () => {
    render(<StoppageSummaryCard summary={summary} />);
    expect(screen.getByTestId('stoppage.card.longest')).toHaveTextContent('3.3 h');
  });
});
