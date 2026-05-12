// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgendaDigestCard } from './AgendaDigestCard.js';
import type { AgendaItem } from '../../services/agenda/agendaScheduler.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function item(id: string, focus = false): AgendaItem {
  return {
    id,
    workerUid: 'u1',
    title: `Task ${id}`,
    startAt: '2026-05-12T09:00:00Z',
    endAt: '2026-05-12T10:00:00Z',
    focusBlock: focus,
    urgency: 'medium',
    reminders: [],
  };
}

describe('<AgendaDigestCard />', () => {
  it('renderiza secciones con bullets', () => {
    render(
      <AgendaDigestCard
        workerUid="u1"
        forDate="2026-05-12"
        inputs={{
          upcomingItems: [item('a'), item('b', true)],
          overdueActions: 3,
          pendingApprovals: 2,
          freshIncidents: 0,
        }}
      />,
    );
    expect(screen.getByTestId('agenda-digest-card')).toBeInTheDocument();
    expect(screen.getByTestId('agenda-digest-section-0')).toBeInTheDocument();
    expect(screen.getByTestId('agenda-digest-bullet-0-0')).toBeInTheDocument();
  });

  it('empty state si sin secciones', () => {
    render(
      <AgendaDigestCard
        workerUid="u1"
        forDate="2026-05-12"
        inputs={{
          upcomingItems: [],
          overdueActions: 0,
          pendingApprovals: 0,
          freshIncidents: 0,
        }}
      />,
    );
    expect(screen.getByTestId('agenda-digest-empty')).toBeInTheDocument();
  });
});
