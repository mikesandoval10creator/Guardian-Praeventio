// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkerReadinessCard } from './WorkerReadinessCard.js';
import type { ReadinessReport } from '../../services/workerReadiness/readinessScore.js';

const baseReport: ReadinessReport = {
  workerUid: 'w42',
  taskCategory: 'trabajo_altura',
  score: 78,
  level: 'minor_gaps',
  gaps: [
    {
      kind: 'missing_epp',
      description: 'Falta arnés vigente',
      weight: 10,
      recommendation: 'Entregar arnés categoría 2',
    },
  ],
  recommendations: ['Entregar arnés categoría 2'],
  subScores: {
    trainings: 20,
    epp: 10,
    medical: 15,
    documents: 10,
    experience: 15,
    fatigue: 8,
  },
};

describe('<WorkerReadinessCard />', () => {
  it('renderiza score, sub-scores y nivel', () => {
    render(<WorkerReadinessCard report={baseReport} />);
    expect(screen.getByTestId('workerReadiness.card.title')).toHaveTextContent('w42');
    expect(screen.getByTestId('workerReadiness.card.score')).toHaveTextContent('78');
    expect(screen.getByTestId('workerReadiness.card.level')).toHaveTextContent(
      'Brechas menores',
    );
    expect(screen.getByTestId('workerReadiness.card.sub.epp')).toHaveTextContent('10');
  });

  it('incluye disclaimer no-bloqueante y lista de brechas', () => {
    render(<WorkerReadinessCard report={baseReport} />);
    expect(screen.getByTestId('workerReadiness.card.disclaimer').textContent).toContain(
      'no bloquea',
    );
    expect(screen.getByTestId('workerReadiness.card.gaps').textContent).toContain('arnés');
  });
});
