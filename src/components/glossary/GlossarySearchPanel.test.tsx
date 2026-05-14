// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GlossarySearchPanel } from './GlossarySearchPanel.js';
import type {
  GlossaryTerm,
  FaqEntry,
} from '../../services/glossary/glossaryEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function term(over: Partial<GlossaryTerm> & { id: string }): GlossaryTerm {
  return {
    id: over.id,
    term: over.term ?? 'casco de seguridad',
    synonyms: over.synonyms,
    category: over.category ?? 'epp',
    shortDefinition: over.shortDefinition ?? 'Protección craneal contra impactos.',
    longDefinition: over.longDefinition,
    references: over.references,
    updatedAt: over.updatedAt ?? '2026-05-13T10:00:00Z',
    helpfulCount: over.helpfulCount,
    notHelpfulCount: over.notHelpfulCount,
  };
}

function faq(over: Partial<FaqEntry> & { id: string }): FaqEntry {
  return {
    id: over.id,
    question: over.question ?? '¿Cuándo se exige casco?',
    questionVariants: over.questionVariants,
    answer: over.answer ?? 'En toda zona donde haya riesgo de impacto craneal.',
    relatedTermIds: over.relatedTermIds,
    topic: over.topic ?? 'epp',
    contextHint: over.contextHint,
    updatedAt: over.updatedAt ?? '2026-05-13T10:00:00Z',
    helpfulCount: over.helpfulCount,
    notHelpfulCount: over.notHelpfulCount,
  };
}

describe('<GlossarySearchPanel />', () => {
  it('tab por defecto: términos visibles', () => {
    render(
      <GlossarySearchPanel
        terms={[term({ id: 't1' }), term({ id: 't2', term: 'arnés' })]}
        faqs={[]}
      />,
    );
    expect(screen.getByTestId('glossary-term-t1')).toBeInTheDocument();
    expect(screen.queryByTestId('glossary-faq-results')).toBeNull();
  });

  it('switching a tab faqs muestra preguntas', () => {
    render(
      <GlossarySearchPanel
        terms={[term({ id: 't1' })]}
        faqs={[faq({ id: 'q1' })]}
      />,
    );
    fireEvent.click(screen.getByTestId('glossary-tab-faqs'));
    expect(screen.getByTestId('glossary-faq-q1')).toBeInTheDocument();
  });

  it('búsqueda filtra términos', () => {
    render(
      <GlossarySearchPanel
        terms={[
          term({ id: 't1', term: 'casco de seguridad' }),
          term({ id: 't2', term: 'arnés', synonyms: ['cinturón'] }),
        ]}
        faqs={[]}
      />,
    );
    const input = screen.getByTestId('glossary-search-input');
    fireEvent.change(input, { target: { value: 'arnés' } });
    expect(screen.queryByTestId('glossary-term-t1')).toBeNull();
    expect(screen.getByTestId('glossary-term-t2')).toBeInTheDocument();
  });

  it('búsqueda en FAQ por question', () => {
    render(
      <GlossarySearchPanel
        terms={[]}
        faqs={[
          faq({ id: 'q1', question: '¿Cuándo usar arnés?' }),
          faq({ id: 'q2', question: '¿Qué es el DS 132?' }),
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId('glossary-tab-faqs'));
    fireEvent.change(screen.getByTestId('glossary-search-input'), {
      target: { value: 'arnés' },
    });
    expect(screen.getByTestId('glossary-faq-q1')).toBeInTheDocument();
    expect(screen.queryByTestId('glossary-faq-q2')).toBeNull();
  });

  it('sin resultados: empty state', () => {
    render(
      <GlossarySearchPanel
        terms={[term({ id: 't1', term: 'arnés' })]}
        faqs={[]}
      />,
    );
    fireEvent.change(screen.getByTestId('glossary-search-input'), {
      target: { value: 'zzzzunmatchedzzzz' },
    });
    expect(screen.getByTestId('glossary-empty')).toBeInTheDocument();
  });

  it('feedback term: helpful dispara callback', () => {
    const onFeedback = vi.fn();
    render(
      <GlossarySearchPanel
        terms={[term({ id: 't1' })]}
        faqs={[]}
        onFeedback={onFeedback}
      />,
    );
    fireEvent.click(screen.getByTestId('glossary-term-t1-helpful'));
    expect(onFeedback).toHaveBeenCalledWith('term', 't1', true);
  });

  it('feedback faq: not_helpful dispara callback', () => {
    const onFeedback = vi.fn();
    render(
      <GlossarySearchPanel
        terms={[]}
        faqs={[faq({ id: 'q1' })]}
        onFeedback={onFeedback}
      />,
    );
    fireEvent.click(screen.getByTestId('glossary-tab-faqs'));
    fireEvent.click(screen.getByTestId('glossary-faq-q1-not-helpful'));
    expect(onFeedback).toHaveBeenCalledWith('faq', 'q1', false);
  });

  it('sin onFeedback: botones no aparecen', () => {
    render(<GlossarySearchPanel terms={[term({ id: 't1' })]} faqs={[]} />);
    expect(screen.queryByTestId('glossary-term-t1-helpful')).toBeNull();
  });

  it('FAQ con relatedTermIds + onTermClick: chips clickables', () => {
    const onClick = vi.fn();
    render(
      <GlossarySearchPanel
        terms={[]}
        faqs={[faq({ id: 'q1', relatedTermIds: ['t-casco', 't-arnes'] })]}
        onTermClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('glossary-tab-faqs'));
    fireEvent.click(screen.getByTestId('glossary-faq-q1-term-t-casco'));
    expect(onClick).toHaveBeenCalledWith('t-casco');
  });

  it('categoryFilter aplica a la lista sin query', () => {
    render(
      <GlossarySearchPanel
        terms={[
          term({ id: 't1', category: 'epp' }),
          term({ id: 't2', category: 'normativa' }),
        ]}
        faqs={[]}
        categoryFilter="normativa"
      />,
    );
    expect(screen.queryByTestId('glossary-term-t1')).toBeNull();
    expect(screen.getByTestId('glossary-term-t2')).toBeInTheDocument();
  });

  it('contador en tabs refleja resultados de la query', () => {
    render(
      <GlossarySearchPanel
        terms={[term({ id: 't1', term: 'arnés' })]}
        faqs={[faq({ id: 'q1', question: 'arnés cómo' })]}
      />,
    );
    fireEvent.change(screen.getByTestId('glossary-search-input'), {
      target: { value: 'arnés' },
    });
    expect(screen.getByTestId('glossary-tab-terms')).toHaveTextContent('(1)');
    expect(screen.getByTestId('glossary-tab-faqs')).toHaveTextContent('(1)');
  });
});
