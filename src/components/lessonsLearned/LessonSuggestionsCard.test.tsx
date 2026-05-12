// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LessonSuggestionsCard } from './LessonSuggestionsCard.js';
import type { Lesson } from '../../services/lessonsLearned/lessonsLibrary.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function lesson(id: string, riskCategories: string[], scope: 'global' | 'project' = 'project'): Lesson {
  return {
    id,
    summary: `Lección ${id}`,
    preventiveAction: `Acción preventiva ${id}`,
    riskCategories,
    tags: riskCategories,
    scope,
    publishedAt: '2026-05-01T00:00:00Z',
    adoptionCount: 0,
  };
}

describe('<LessonSuggestionsCard />', () => {
  it('empty si no hay lecciones relevantes', () => {
    render(
      <LessonSuggestionsCard
        library={[lesson('l1', ['quimico'])]}
        context={{ taskId: 't1', riskCategories: ['altura'] }}
      />,
    );
    expect(screen.getByTestId('lesson-suggestions-empty')).toBeInTheDocument();
  });

  it('muestra lecciones que matchean categoría', () => {
    render(
      <LessonSuggestionsCard
        library={[lesson('l1', ['altura']), lesson('l2', ['altura'])]}
        context={{ taskId: 't1', riskCategories: ['altura'] }}
      />,
    );
    expect(screen.getByTestId('lesson-l1')).toBeInTheDocument();
    expect(screen.getByTestId('lesson-l2')).toBeInTheDocument();
  });

  it('respeta topN', () => {
    render(
      <LessonSuggestionsCard
        library={[
          lesson('l1', ['altura']),
          lesson('l2', ['altura']),
          lesson('l3', ['altura']),
        ]}
        context={{ taskId: 't', riskCategories: ['altura'] }}
        topN={2}
      />,
    );
    const items = screen.getAllByTestId(/^lesson-(?!open-)(?!suggestions-)/);
    expect(items).toHaveLength(2);
  });

  it('onLessonClick recibe id', () => {
    const onClick = vi.fn();
    render(
      <LessonSuggestionsCard
        library={[lesson('l1', ['altura'])]}
        context={{ taskId: 't', riskCategories: ['altura'] }}
        onLessonClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('lesson-open-l1'));
    expect(onClick).toHaveBeenCalledWith('l1');
  });
});
