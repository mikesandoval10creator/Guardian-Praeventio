// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProcessClosePreviewCard } from './ProcessClosePreviewCard.js';
import type { Process } from '../../types/organic.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function proc(over: Partial<Process> = {}): Process {
  return {
    id: 'pr1',
    crewId: 'c1',
    projectId: 'p1',
    type: 'soldadura',
    name: 'Soldadura vigas torre B',
    description: '',
    startedAt: '2026-05-10T08:00:00Z',
    endedAt: null,
    plannedEndDate: '2026-05-15',
    status: 'active',
    complianceScore: 90,
    incidentsDuringProcess: 0,
    alertsResponded: 4,
    xpAwardedAtClose: null,
    ...over,
  };
}

describe('<ProcessClosePreviewCard />', () => {
  it('renderiza base XP, alertas y final XP', () => {
    render(<ProcessClosePreviewCard process={proc()} />);
    expect(screen.getByTestId('process-close-preview-pr1')).toBeInTheDocument();
    // soldadura baseXp=130, score=90, alerts=4 → 130*0.9*1.2 = 140.4 → 140
    expect(screen.getByTestId('process-close-final-xp-pr1').textContent).toMatch(/\+140/);
  });

  it('cambio en slider actualiza XP', () => {
    render(<ProcessClosePreviewCard process={proc()} />);
    const slider = screen.getByTestId('process-close-score-pr1') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '50' } });
    // 130*0.5*1.2 = 78
    expect(screen.getByTestId('process-close-final-xp-pr1').textContent).toMatch(/\+78/);
  });

  it('dispara onConfirmClose con score actual', () => {
    const onClose = vi.fn();
    render(<ProcessClosePreviewCard process={proc()} onConfirmClose={onClose} />);
    fireEvent.click(screen.getByTestId('process-close-confirm-pr1'));
    expect(onClose).toHaveBeenCalledWith(90);
  });
});
