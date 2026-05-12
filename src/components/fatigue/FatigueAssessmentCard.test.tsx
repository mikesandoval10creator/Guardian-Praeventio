// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FatigueAssessmentCard } from './FatigueAssessmentCard.js';
import type { WorkSession } from '../../services/fatigue/fatigueMonitor.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const NOW = new Date('2026-05-12T18:00:00Z');

describe('<FatigueAssessmentCard />', () => {
  it('renderiza con sesiones moderadas', () => {
    const sessions: WorkSession[] = [
      {
        workerUid: 'w1',
        startedAt: '2026-05-12T08:00:00Z',
        endedAt: '2026-05-12T16:00:00Z',
        isNight: false,
        hadCriticalTasks: false,
      },
    ];
    render(<FatigueAssessmentCard workerUid="w1" sessions={sessions} now={NOW} />);
    expect(screen.getByTestId('fatigue-card-w1')).toBeInTheDocument();
    expect(screen.getByTestId('fatigue-risk-w1')).toBeInTheDocument();
  });

  it('flag restrict critical si jornada extendida', () => {
    const sessions: WorkSession[] = [
      {
        workerUid: 'w2',
        startedAt: '2026-05-12T03:00:00Z',
        endedAt: '2026-05-12T17:00:00Z',
        isNight: true,
        hadCriticalTasks: true,
      },
    ];
    render(<FatigueAssessmentCard workerUid="w2" sessions={sessions} now={NOW} />);
    // 14h > MAX_HOURS_24H (12) → debería restringir
    expect(screen.getByTestId('fatigue-restrict-w2')).toBeInTheDocument();
  });

  it('lista recomendaciones', () => {
    const sessions: WorkSession[] = [
      {
        workerUid: 'w3',
        startedAt: '2026-05-12T03:00:00Z',
        endedAt: '2026-05-12T17:00:00Z',
        isNight: true,
        hadCriticalTasks: false,
      },
    ];
    render(<FatigueAssessmentCard workerUid="w3" sessions={sessions} now={NOW} />);
    expect(screen.getByTestId('fatigue-recs-w3')).toBeInTheDocument();
  });
});
