// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaturityIndexCard } from './MaturityIndexCard.js';
import {
  computeMaturityLevel,
  recommendNextSteps,
  type MaturitySignals,
} from '../../services/maturity/preventionMaturityIndex.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function lowSignals(): MaturitySignals {
  return {
    trainingCoverage: 0.1,
    ipersCompleted: 0.1,
    cphsMeetingFrequency: 0.1,
    leadingIndicatorsUsed: [],
    rootCauseAnalysisRate: 0.1,
    behaviorBasedSafety: 0,
    executiveEngagement: 0,
    workerEmpowerment: 0,
    integrationWithOperations: 0,
    continuousImprovement: 0,
  };
}

function highSignals(): MaturitySignals {
  return {
    trainingCoverage: 1,
    ipersCompleted: 1,
    cphsMeetingFrequency: 1,
    leadingIndicatorsUsed: ['a', 'b', 'c', 'd', 'e', 'f'],
    rootCauseAnalysisRate: 1,
    behaviorBasedSafety: 1,
    executiveEngagement: 1,
    workerEmpowerment: 1,
    integrationWithOperations: 1,
    continuousImprovement: 1,
  };
}

describe('<MaturityIndexCard />', () => {
  it('renderiza el badge de nivel actual', () => {
    const report = computeMaturityLevel(lowSignals());
    const recs = recommendNextSteps(report);
    render(<MaturityIndexCard report={report} recommendations={recs} />);
    expect(screen.getByTestId('maturity-level-badge').textContent).toMatch(
      /Nivel 1/,
    );
  });

  it('renderiza la Bradley Curve con 5 estaciones', () => {
    const report = computeMaturityLevel(highSignals());
    const recs = recommendNextSteps(report);
    render(<MaturityIndexCard report={report} recommendations={recs} />);
    for (let lv = 1; lv <= 5; lv += 1) {
      expect(screen.getByTestId(`bradley-step-${lv}`)).toBeTruthy();
    }
  });

  it('muestra los sub-scores de las 5 categorías', () => {
    const report = computeMaturityLevel(highSignals());
    const recs = recommendNextSteps(report);
    render(<MaturityIndexCard report={report} recommendations={recs} />);
    expect(screen.getByTestId('category-foundation')).toBeTruthy();
    expect(screen.getByTestId('category-measurement')).toBeTruthy();
    expect(screen.getByTestId('category-behavior')).toBeTruthy();
    expect(screen.getByTestId('category-leadership')).toBeTruthy();
    expect(screen.getByTestId('category-integration')).toBeTruthy();
  });

  it('muestra exactamente 3 next steps', () => {
    const report = computeMaturityLevel(lowSignals());
    const recs = recommendNextSteps(report);
    render(<MaturityIndexCard report={report} recommendations={recs} />);
    expect(screen.getByTestId('next-step-0')).toBeTruthy();
    expect(screen.getByTestId('next-step-1')).toBeTruthy();
    expect(screen.getByTestId('next-step-2')).toBeTruthy();
    expect(screen.queryByTestId('next-step-3')).toBeNull();
  });
});
