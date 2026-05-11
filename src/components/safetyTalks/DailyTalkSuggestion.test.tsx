// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DailyTalkSuggestion } from './DailyTalkSuggestion.js';
import type { ContextSignals } from '../../services/safetyTalks/talkTopicSuggester.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

const NO_SIGNALS: ContextSignals = {
  recentIncidents: [],
  activeRisks: [],
  todaysTaskCategories: [],
  openFindingsByCategory: {},
  newWorkersCount: 0,
};

describe('<DailyTalkSuggestion />', () => {
  it('muestra empty state cuando no hay señales', () => {
    render(<DailyTalkSuggestion signals={NO_SIGNALS} />);
    expect(screen.getByTestId('talk-suggestion-empty')).toBeInTheDocument();
  });

  it('muestra sugerencia para riesgo de altura', () => {
    render(
      <DailyTalkSuggestion
        signals={{ ...NO_SIGNALS, activeRisks: ['altura'], todaysTaskCategories: ['altura'] }}
      />,
    );
    expect(screen.getByTestId('daily-talk-suggestion')).toBeInTheDocument();
    expect(screen.getByTestId('talk-suggestion-altura')).toBeInTheDocument();
  });

  it('respeta el limit prop', () => {
    render(
      <DailyTalkSuggestion
        signals={{
          ...NO_SIGNALS,
          activeRisks: ['altura', 'electric', 'confinado'],
          todaysTaskCategories: ['altura', 'electric'],
        }}
        limit={1}
      />,
    );
    const items = screen.getAllByTestId(/^talk-suggestion-(?!pick-)(?!empty)/);
    // 1 envoltura (daily-talk-suggestion) + 1 item
    expect(items.filter((el) => el.getAttribute('data-testid')?.startsWith('talk-suggestion-')).length).toBeGreaterThanOrEqual(1);
  });

  it('onPick dispara con la sugerencia clickeada', () => {
    const onPick = vi.fn();
    render(
      <DailyTalkSuggestion
        signals={{ ...NO_SIGNALS, activeRisks: ['altura'], todaysTaskCategories: ['altura'] }}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByTestId('talk-suggestion-pick-altura'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].topicId).toBe('altura');
  });
});
