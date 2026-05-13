// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PreShiftRiskCard } from './PreShiftRiskCard.js';
import type { ShiftRiskReport } from '../../services/shiftRiskPanel/preShiftRiskComposer.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function buildReport(over: Partial<ShiftRiskReport> = {}): ShiftRiskReport {
  return {
    projectId: 'p1',
    shift: 'night',
    date: '2026-05-13',
    riskScore: 45,
    level: 'amber',
    factors: [
      { id: 'weather', label: 'Lluvia 80%', weight: 15 },
      { id: 'fatigue', label: 'Cuadrilla con fatiga moderada', weight: 12 },
    ],
    topRecommendations: ['Revisar pronóstico', 'Reasignar tareas críticas'],
    recommendDelayShiftStart: false,
    ...over,
  };
}

describe('<PreShiftRiskCard />', () => {
  it('renderiza score, level y bar', () => {
    render(<PreShiftRiskCard report={buildReport()} />);
    expect(screen.getByTestId('pre-shift-risk-p1-night')).toBeInTheDocument();
    expect(screen.getByTestId('pre-shift-risk-score-p1').textContent).toBe('45');
    expect(screen.getByTestId('pre-shift-risk-level-p1').textContent).toBe('amber');
  });

  it('muestra banner delay cuando recommendDelayShiftStart', () => {
    render(
      <PreShiftRiskCard
        report={buildReport({ riskScore: 90, level: 'red', recommendDelayShiftStart: true })}
      />,
    );
    expect(screen.getByTestId('pre-shift-risk-delay-p1')).toBeInTheDocument();
  });

  it('sin banner delay si recommendDelayShiftStart = false', () => {
    render(<PreShiftRiskCard report={buildReport()} />);
    expect(screen.queryByTestId('pre-shift-risk-delay-p1')).toBeNull();
  });

  it('lista top recomendaciones', () => {
    render(<PreShiftRiskCard report={buildReport()} />);
    expect(screen.getByTestId('pre-shift-risk-recommendations-p1')).toBeInTheDocument();
    expect(screen.getByTestId('pre-shift-risk-rec-p1-0')).toBeInTheDocument();
    expect(screen.getByTestId('pre-shift-risk-rec-p1-1')).toBeInTheDocument();
  });

  it('factores en details expandible', () => {
    render(<PreShiftRiskCard report={buildReport()} />);
    expect(screen.getByTestId('pre-shift-risk-factor-weather')).toBeInTheDocument();
    expect(screen.getByTestId('pre-shift-risk-factor-fatigue')).toBeInTheDocument();
  });

  it('onAcknowledge dispara callback', () => {
    const onAck = vi.fn();
    render(<PreShiftRiskCard report={buildReport()} onAcknowledge={onAck} />);
    fireEvent.click(screen.getByTestId('pre-shift-risk-ack-p1'));
    expect(onAck).toHaveBeenCalled();
  });

  it('empty state cuando ni inputs ni report', () => {
    render(<PreShiftRiskCard />);
    expect(screen.getByTestId('pre-shift-risk-empty')).toBeInTheDocument();
  });
});
