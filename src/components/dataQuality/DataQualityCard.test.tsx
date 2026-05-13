// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataQualityCard } from './DataQualityCard.js';
import type {
  DataQualityReport,
  Gap,
} from '../../services/dataQuality/incompletenessScanner.js';

const report: DataQualityReport = {
  gaps: [],
  totalGaps: 7,
  byDomain: { worker: 3, project: 4 },
  bySeverity: { high: 2, medium: 3, low: 2 },
  qualityScore: 72,
};

const topGaps: Gap[] = [
  {
    docId: 'w1',
    domain: 'worker',
    field: 'rut',
    reason: 'RUT faltante',
    severity: 'high',
    quickFixHint: 'Pedir RUT al supervisor',
  },
  {
    docId: 'p1',
    domain: 'project',
    field: 'coordinates',
    reason: 'Sin geolocalización',
    severity: 'medium',
    quickFixHint: 'Capturar GPS en terreno',
  },
];

describe('<DataQualityCard />', () => {
  it('muestra score y totales por severidad', () => {
    render(<DataQualityCard report={report} />);
    expect(screen.getByTestId('dataQuality.card.score')).toHaveTextContent('72');
    expect(screen.getByTestId('dataQuality.card.totalGaps')).toHaveTextContent('7');
    expect(screen.getByTestId('dataQuality.card.high')).toHaveTextContent('2');
    expect(screen.getByTestId('dataQuality.card.medium')).toHaveTextContent('3');
  });

  it('renderiza topGaps si se pasan', () => {
    render(<DataQualityCard report={report} topGaps={topGaps} />);
    expect(screen.getByTestId('dataQuality.card.topGaps')).toBeInTheDocument();
    expect(screen.getByTestId('dataQuality.card.gap.0').textContent).toContain('RUT');
    expect(screen.getByTestId('dataQuality.card.gap.1').textContent).toContain('coordinates');
  });
});
