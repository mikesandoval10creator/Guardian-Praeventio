// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeviationRadarPanel } from './DeviationRadarPanel.js';
import type { NormalizationPattern } from '../../services/governance/deviationNormalizationRadar.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function p(
  kind: NormalizationPattern['kind'],
  severity: NormalizationPattern['severity'],
  escalate: boolean,
): NormalizationPattern {
  return {
    kind,
    severity,
    description: `Patrón ${kind}`,
    exceptionIds: ['e1'],
    subjectKey: 's1',
    suggestedAction: 'Revisar',
    escalateToManagement: escalate,
  };
}

describe('<DeviationRadarPanel />', () => {
  it('renderiza summary y patrones', () => {
    render(
      <DeviationRadarPanel
        patterns={[
          p('same_subject_repeated', 'critical', true),
          p('approver_signing_streak', 'warning', false),
        ]}
      />,
    );
    expect(screen.getByTestId('deviation-radar-panel')).toBeInTheDocument();
    expect(screen.getByTestId('deviation-pattern-0')).toBeInTheDocument();
    expect(screen.getByTestId('deviation-pattern-1')).toBeInTheDocument();
    expect(screen.getByTestId('deviation-radar-critical').textContent).toMatch(/1/);
  });

  it('flag pending escalations', () => {
    render(<DeviationRadarPanel patterns={[p('same_subject_repeated', 'critical', true)]} />);
    expect(screen.getByTestId('deviation-radar-pending-escalations')).toBeInTheDocument();
  });

  it('botón onEscalate solo si escalateToManagement', () => {
    const onEsc = vi.fn();
    render(
      <DeviationRadarPanel
        patterns={[p('same_subject_repeated', 'critical', true)]}
        onEscalate={onEsc}
      />,
    );
    fireEvent.click(screen.getByTestId('deviation-pattern-action-0'));
    expect(onEsc).toHaveBeenCalled();
  });

  it('empty state si sin patrones', () => {
    render(<DeviationRadarPanel patterns={[]} />);
    expect(screen.getByTestId('deviation-radar-list').textContent).toMatch(/Sin patrones/);
  });
});
