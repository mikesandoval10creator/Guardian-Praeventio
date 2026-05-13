// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RepeatingRiskRadarCard } from './RepeatingRiskRadarCard.js';
import type {
  RadarReport,
  RepeatingPattern,
} from '../../services/riskRadar/repeatingRiskRadar.js';

function pattern(id: string, severity: RepeatingPattern['severity']): RepeatingPattern {
  return {
    id,
    kind: 'same_zone_multiple_kinds',
    label: `Patrón ${id}`,
    involvedIncidentIds: ['i1', 'i2', 'i3'],
    occurrences: 3,
    lastSeenAt: '2026-05-01T00:00:00Z',
    recommendedAction: 'Inspección preventiva',
    severity,
  };
}

describe('<RepeatingRiskRadarCard />', () => {
  it('renderiza patrones', () => {
    const report: RadarReport = {
      patterns: [pattern('p1', 'high'), pattern('p2', 'medium')],
      totalPatterns: 2,
      byKind: { same_zone_multiple_kinds: 2 },
      maxSeverity: 'high',
      windowDays: 90,
      consideredIncidents: 12,
    };
    render(<RepeatingRiskRadarCard report={report} />);
    expect(screen.getByTestId('riskRadar.card')).toBeInTheDocument();
    expect(screen.getByTestId('riskRadar.list')).toBeInTheDocument();
    expect(screen.getByTestId('riskRadar.item.p1')).toBeInTheDocument();
    expect(screen.getByTestId('riskRadar.item.p2')).toBeInTheDocument();
  });

  it('muestra empty state sin patrones', () => {
    const report: RadarReport = {
      patterns: [],
      totalPatterns: 0,
      byKind: {},
      maxSeverity: 'low',
      windowDays: 90,
      consideredIncidents: 0,
    };
    render(<RepeatingRiskRadarCard report={report} />);
    expect(screen.getByTestId('riskRadar.empty')).toBeInTheDocument();
  });
});
