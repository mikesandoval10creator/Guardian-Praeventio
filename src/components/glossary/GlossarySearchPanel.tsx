// Praeventio Guard — Wire UI: <GlossarySearchPanel />
//
// Wire UI para `glossaryEngine.searchGlossary()` + `searchFaq()`.
// Tabs term/FAQ + input de búsqueda con search en vivo (motor puro).
// Feedback (thumbs up/down) opcional por item — caller cablea persistencia
// via `recordUtilityFeedback()`.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  HelpCircle,
  Search,
  ThumbsUp,
  ThumbsDown,
  Tag,
} from 'lucide-react';
import {
  searchGlossary,
  searchFaq,
  type GlossaryTerm,
  type FaqEntry,
  type TermCategory,
} from '../../services/glossary/glossaryEngine.js';

interface GlossarySearchPanelProps {
  terms: GlossaryTerm[];
  faqs: FaqEntry[];
  /** Categoría filtro opcional (caller controla). */
  categoryFilter?: TermCategory;
  /** Callback feedback "útil/no útil" sobre un item. */
  onFeedback?: (kind: 'term' | 'faq', itemId: string, helpful: boolean) => void;
  /** Callback al click en un término relacionado dentro de una FAQ. */
  onTermClick?: (termId: string) => void;
}

const CATEGORY_LABEL: Record<TermCategory, string> = {
  normativa: 'Normativa',
  epp: 'EPP',
  riesgo: 'Riesgo',
  controlIngenieria: 'Control ing.',
  salud: 'Salud',
  medico: 'Médico',
  procedimiento: 'Procedimiento',
  siglas: 'Siglas',
  general: 'General',
};

const CATEGORY_CLASS: Record<TermCategory, string> = {
  normativa: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  epp: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  riesgo: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  controlIngenieria: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  salud: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  medico: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  procedimiento: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  siglas: 'bg-stone-500/15 text-stone-700 dark:text-stone-300',
  general: 'bg-stone-500/10 text-stone-700 dark:text-stone-300',
};

export function GlossarySearchPanel({
  terms,
  faqs,
  categoryFilter,
  onFeedback,
  onTermClick,
}: GlossarySearchPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'terms' | 'faqs'>('terms');
  const [query, setQuery] = useState('');

  const termResults = useMemo(() => {
    if (query.trim().length === 0) {
      // Sin query: mostrar primeros 20 ordenados por update, filtrados por categoría
      const filtered = categoryFilter
        ? terms.filter((tt) => tt.category === categoryFilter)
        : terms;
      return filtered
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 20)
        .map((item) => ({ item, score: 0, matchedTokens: [] }));
    }
    return searchGlossary(terms, query, {
      category: categoryFilter,
      limit: 20,
    });
  }, [terms, query, categoryFilter]);

  const faqResults = useMemo(() => {
    if (query.trim().length === 0) {
      const filtered = categoryFilter
        ? faqs.filter((f) => f.topic === categoryFilter)
        : faqs;
      return filtered
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 20)
        .map((item) => ({ item, score: 0, matchedTokens: [] }));
    }
    return searchFaq(faqs, query, { topic: categoryFilter, limit: 20 });
  }, [faqs, query, categoryFilter]);

  const tabClass = (active: boolean) =>
    active
      ? 'bg-teal-600 text-white border-teal-600'
      : 'bg-white/40 dark:bg-stone-800/40 text-stone-700 dark:text-stone-300 border-stone-500/30 hover:bg-stone-100/40';

  return (
    <section
      className="rounded-2xl border border-stone-500/30 bg-white/70 dark:bg-stone-900/40 p-4"
      data-testid="glossary-panel"
      aria-label={t('glossary.aria', 'Glosario y preguntas frecuentes') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <BookOpen
          className="w-5 h-5 text-teal-600 dark:text-teal-400"
          aria-hidden="true"
        />
        <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100">
          {t('glossary.title', 'Glosario')}
        </h2>
      </header>

      {/* Search input */}
      <div className="relative mb-3">
        <Search
          className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="glossary-search-input"
          placeholder={t('glossary.searchPlaceholder', 'Buscar término o pregunta...') as string}
          className="w-full pl-8 pr-2 py-1.5 rounded-md border border-stone-500/30 bg-white/60 dark:bg-stone-800/50 text-sm text-stone-800 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'terms'}
          onClick={() => setTab('terms')}
          data-testid="glossary-tab-terms"
          className={`px-3 py-1 rounded-md border text-xs font-bold ${tabClass(tab === 'terms')}`}
        >
          <BookOpen className="w-3 h-3 inline -mt-0.5 mr-1" aria-hidden="true" />
          {t('glossary.tabTerms', 'Términos')} ({termResults.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'faqs'}
          onClick={() => setTab('faqs')}
          data-testid="glossary-tab-faqs"
          className={`px-3 py-1 rounded-md border text-xs font-bold ${tabClass(tab === 'faqs')}`}
        >
          <HelpCircle className="w-3 h-3 inline -mt-0.5 mr-1" aria-hidden="true" />
          {t('glossary.tabFaqs', 'Preguntas')} ({faqResults.length})
        </button>
      </div>

      {/* Results */}
      {tab === 'terms' ? (
        <ul className="space-y-2" data-testid="glossary-term-results">
          {termResults.length === 0 ? (
            <li
              data-testid="glossary-empty"
              className="text-xs italic text-stone-500 py-2 text-center"
            >
              {t('glossary.empty', 'Sin resultados')}
            </li>
          ) : (
            termResults.map(({ item }) => (
              <TermRow
                key={item.id}
                term={item}
                onFeedback={
                  onFeedback ? (h) => onFeedback('term', item.id, h) : undefined
                }
              />
            ))
          )}
        </ul>
      ) : (
        <ul className="space-y-2" data-testid="glossary-faq-results">
          {faqResults.length === 0 ? (
            <li
              data-testid="glossary-empty"
              className="text-xs italic text-stone-500 py-2 text-center"
            >
              {t('glossary.empty', 'Sin resultados')}
            </li>
          ) : (
            faqResults.map(({ item }) => (
              <FaqRow
                key={item.id}
                faq={item}
                onFeedback={
                  onFeedback ? (h) => onFeedback('faq', item.id, h) : undefined
                }
                onTermClick={onTermClick}
              />
            ))
          )}
        </ul>
      )}
    </section>
  );
}

interface TermRowProps {
  term: GlossaryTerm;
  onFeedback?: (helpful: boolean) => void;
}

function TermRow({ term, onFeedback }: TermRowProps) {
  return (
    <li
      data-testid={`glossary-term-${term.id}`}
      className="rounded-md border border-stone-500/20 bg-stone-500/5 p-2.5"
    >
      <div className="flex items-start gap-2 flex-wrap">
        <p className="text-sm font-bold text-stone-800 dark:text-stone-100 flex-1 min-w-0">
          {term.term}
        </p>
        <span
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${CATEGORY_CLASS[term.category]}`}
        >
          <Tag className="w-2.5 h-2.5" aria-hidden="true" />
          {CATEGORY_LABEL[term.category]}
        </span>
      </div>
      <p className="text-xs text-stone-700 dark:text-stone-300 mt-1 leading-snug">
        {term.shortDefinition}
      </p>
      {term.synonyms && term.synonyms.length > 0 && (
        <p className="text-[10px] mt-1 opacity-70 italic">
          Sinónimos: {term.synonyms.join(', ')}
        </p>
      )}
      {onFeedback && (
        <FeedbackButtons
          onHelpful={() => onFeedback(true)}
          onNotHelpful={() => onFeedback(false)}
          testIdPrefix={`glossary-term-${term.id}`}
        />
      )}
    </li>
  );
}

interface FaqRowProps {
  faq: FaqEntry;
  onFeedback?: (helpful: boolean) => void;
  onTermClick?: (termId: string) => void;
}

function FaqRow({ faq, onFeedback, onTermClick }: FaqRowProps) {
  return (
    <li
      data-testid={`glossary-faq-${faq.id}`}
      className="rounded-md border border-stone-500/20 bg-stone-500/5 p-2.5"
    >
      <p className="text-sm font-bold text-stone-800 dark:text-stone-100">
        {faq.question}
      </p>
      <p className="text-xs text-stone-700 dark:text-stone-300 mt-1 leading-snug">
        {faq.answer}
      </p>
      {faq.relatedTermIds && faq.relatedTermIds.length > 0 && onTermClick && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {faq.relatedTermIds.map((tid) => (
            <button
              key={tid}
              type="button"
              onClick={() => onTermClick(tid)}
              data-testid={`glossary-faq-${faq.id}-term-${tid}`}
              className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-300 text-[10px] font-bold hover:brightness-110"
            >
              {tid}
            </button>
          ))}
        </div>
      )}
      {onFeedback && (
        <FeedbackButtons
          onHelpful={() => onFeedback(true)}
          onNotHelpful={() => onFeedback(false)}
          testIdPrefix={`glossary-faq-${faq.id}`}
        />
      )}
    </li>
  );
}

interface FeedbackButtonsProps {
  onHelpful: () => void;
  onNotHelpful: () => void;
  testIdPrefix: string;
}

function FeedbackButtons({
  onHelpful,
  onNotHelpful,
  testIdPrefix,
}: FeedbackButtonsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 mt-2 text-[10px] opacity-80">
      <span>{t('glossary.feedbackPrompt', '¿Útil?')}</span>
      <button
        type="button"
        onClick={onHelpful}
        data-testid={`${testIdPrefix}-helpful`}
        className="p-1 rounded-md hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      >
        <ThumbsUp className="w-3 h-3" aria-hidden="true" />
        <span className="sr-only">Sí</span>
      </button>
      <button
        type="button"
        onClick={onNotHelpful}
        data-testid={`${testIdPrefix}-not-helpful`}
        className="p-1 rounded-md hover:bg-rose-500/15 text-rose-700 dark:text-rose-300"
      >
        <ThumbsDown className="w-3 h-3" aria-hidden="true" />
        <span className="sr-only">No</span>
      </button>
    </div>
  );
}
