// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DrillResultReviewCard } from './DrillResultReviewCard.js';
import type { DrillResult } from '../../services/drillsManager/drillsManager.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function result(over: Partial<DrillResult> = {}): DrillResult {
  return {
    id: 'd1',
    drillKind: 'evacuation',
    executedAt: '2026-05-12T10:00:00Z',
    participantCount: 80,
    expectedCount: 100,
    responseTimeSeconds: 180,
    benchmarkSeconds: 240,
    observedGaps: [],
    requiredExternal: false,
    ...over,
  };
}

describe('<DrillResultReviewCard />', () => {
  it('renderiza card con level badge', () => {
    render(<DrillResultReviewCard result={result()} />);
    expect(screen.getByTestId('drill-result-d1')).toBeInTheDocument();
    expect(screen.getByTestId('drill-result-level-d1')).toBeInTheDocument();
  });

  it('participation % y conteo', () => {
    render(<DrillResultReviewCard result={result()} />);
    const p = screen.getByTestId('drill-result-participation-d1');
    expect(p.textContent).toMatch(/80%/);
    expect(p.textContent).toMatch(/80\/100/);
  });

  it('flag external cuando required', () => {
    render(<DrillResultReviewCard result={result({ requiredExternal: true })} />);
    expect(screen.getByTestId('drill-result-external-d1')).toBeInTheDocument();
  });

  it('lista observedGaps', () => {
    render(
      <DrillResultReviewCard
        result={result({ observedGaps: ['Salida bloqueada', 'Falta señalética'] })}
      />,
    );
    expect(screen.getByTestId('drill-result-gap-d1-0')).toBeInTheDocument();
    expect(screen.getByTestId('drill-result-gap-d1-1')).toBeInTheDocument();
  });

  it('respeta precomputedReport si se pasa', () => {
    const customReport = {
      drillId: 'd1',
      participationRate: 99,
      speedDeficitPercent: -50,
      level: 'excellent' as const,
      recommendations: ['Documentar lecciones'],
    };
    render(<DrillResultReviewCard result={result()} precomputedReport={customReport} />);
    expect(screen.getByTestId('drill-result-level-d1').textContent).toBe('excellent');
    expect(screen.getByTestId('drill-result-rec-d1-0')).toBeInTheDocument();
  });

  it('speed mejor que benchmark muestra flecha abajo', () => {
    render(
      <DrillResultReviewCard
        result={result({ responseTimeSeconds: 120, benchmarkSeconds: 240 })}
      />,
    );
    const speed = screen.getByTestId('drill-result-speed-d1');
    expect(speed.textContent).toMatch(/↓/);
  });
});
