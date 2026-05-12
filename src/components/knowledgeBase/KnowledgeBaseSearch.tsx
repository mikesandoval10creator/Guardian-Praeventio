// Praeventio Guard — Wire UI #31: <KnowledgeBaseSearch />
//
// Búsqueda de artículos en la base de conocimiento con filtros por
// kind + tag + flag de obsoleto.

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, BookOpen, AlertTriangle } from 'lucide-react';
import {
  searchArticles,
  type KnowledgeArticle,
  type ArticleKind,
} from '../../services/knowledgeBase/knowledgeBaseService.js';

interface KnowledgeBaseSearchProps {
  library: KnowledgeArticle[];
  onArticleClick?: (id: string) => void;
}

const KIND_LABEL: Record<ArticleKind, string> = {
  glossary: 'Glosario',
  faq: 'FAQ',
  procedure: 'Procedimiento',
  guide: 'Guía',
  norm_summary: 'Resumen normativo',
};

export function KnowledgeBaseSearch({ library, onArticleClick }: KnowledgeBaseSearchProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<ArticleKind | ''>('');
  const [excludeObsolete, setExcludeObsolete] = useState(true);

  const results = useMemo(() => {
    if (query.trim().length < 3) return [];
    return searchArticles(library, query, {
      kind: kindFilter || undefined,
      excludeObsolete,
    });
  }, [library, query, kindFilter, excludeObsolete]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="kb-search"
      aria-label={t('kb.aria', 'Buscar en base de conocimiento') as string}
    >
      <header className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('kb.title', 'Base de Conocimiento')}
        </h2>
        <span className="ml-auto text-[10px] text-secondary-token">
          {library.length} {t('kb.articlesLabel', 'artículos')}
        </span>
      </header>

      <div className="relative">
        <Search
          className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-secondary-token"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="kb-search-input"
          placeholder={t('kb.placeholder', 'Buscar (min 3 caracteres)...') as string}
          className="w-full pl-7 pr-2 py-1.5 rounded-md border border-default-token bg-surface text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-2 items-center text-xs">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as ArticleKind | '')}
          data-testid="kb-kind-filter"
          className="rounded border border-default-token bg-surface px-2 py-1 text-xs"
        >
          <option value="">{t('kb.allKinds', 'Todos los tipos')}</option>
          {(Object.keys(KIND_LABEL) as ArticleKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 text-secondary-token">
          <input
            type="checkbox"
            checked={excludeObsolete}
            onChange={(e) => setExcludeObsolete(e.target.checked)}
            data-testid="kb-exclude-obsolete"
          />
          {t('kb.excludeObsolete', 'Excluir obsoletos')}
        </label>
      </div>

      {query.trim().length >= 3 && (
        <div data-testid="kb-results">
          {results.length === 0 ? (
            <p className="text-xs text-secondary-token italic text-center py-3">
              {t('kb.noResults', 'Sin resultados para esta búsqueda.')}
            </p>
          ) : (
            <ul className="space-y-2">
              {results.slice(0, 10).map((r) => (
                <li
                  key={r.id}
                  data-testid={`kb-result-${r.id}`}
                  className="rounded-lg border border-default-token bg-surface-elevated p-2.5"
                >
                  <button
                    type="button"
                    onClick={() => onArticleClick?.(r.id)}
                    disabled={!onArticleClick}
                    className={`w-full text-left ${onArticleClick ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-700 dark:text-sky-300">
                        {KIND_LABEL[r.kind]}
                      </span>
                      {r.isObsolete && (
                        <span className="text-[10px] font-bold inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                          {t('kb.obsoleteLabel', 'Obsoleto')}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] font-bold tabular-nums opacity-70">
                        {r.score}%
                      </span>
                    </div>
                    <h3 className="text-xs font-bold text-primary-token leading-tight">
                      {r.title}
                    </h3>
                    <p className="text-[10px] text-secondary-token mt-0.5 line-clamp-2">
                      {r.content.slice(0, 120)}
                      {r.content.length > 120 ? '…' : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
