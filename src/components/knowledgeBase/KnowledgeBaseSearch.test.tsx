// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KnowledgeBaseSearch } from './KnowledgeBaseSearch.js';
import type { KnowledgeArticle } from '../../services/knowledgeBase/knowledgeBaseService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function article(over: Partial<KnowledgeArticle> & { id: string }): KnowledgeArticle {
  return {
    id: over.id,
    kind: over.kind ?? 'glossary',
    title: over.title ?? 'arnés definicion',
    content: over.content ?? 'el arnes es equipo individual de altura',
    tags: over.tags ?? ['arnes', 'altura'],
    lastReviewedAt: '2026-05-01',
    viewCount: 0,
    isObsolete: over.isObsolete ?? false,
    authorUid: 'a1',
  };
}

describe('<KnowledgeBaseSearch />', () => {
  it('renderiza sin resultados con query corta (<3 chars)', async () => {
    const user = userEvent.setup();
    render(<KnowledgeBaseSearch library={[article({ id: 'a1' })]} />);
    await user.type(screen.getByTestId('kb-search-input'), 'ar');
    expect(screen.queryByTestId('kb-results')).toBeNull();
  });

  it('muestra resultados con query >=3 chars', async () => {
    const user = userEvent.setup();
    render(<KnowledgeBaseSearch library={[article({ id: 'a1' })]} />);
    await user.type(screen.getByTestId('kb-search-input'), 'arnes');
    expect(screen.getByTestId('kb-result-a1')).toBeInTheDocument();
  });

  it('filtro por kind', async () => {
    const user = userEvent.setup();
    render(
      <KnowledgeBaseSearch
        library={[
          article({ id: 'glo', kind: 'glossary', title: 'arnes def' }),
          article({ id: 'faq', kind: 'faq', title: 'arnes faq' }),
        ]}
      />,
    );
    await user.type(screen.getByTestId('kb-search-input'), 'arnes');
    fireEvent.change(screen.getByTestId('kb-kind-filter'), { target: { value: 'faq' } });
    expect(screen.queryByTestId('kb-result-glo')).toBeNull();
    expect(screen.getByTestId('kb-result-faq')).toBeInTheDocument();
  });
});
