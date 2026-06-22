// src/components/layout/NavSearch.tsx
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { buildNavCatalog } from '../../navigation/navCatalog';
import { searchNav } from '../../navigation/searchNav';
import { useTextFits } from '../../hooks/useTextFits';
import { cn } from '../../utils/cn';
import type { LucideIcon } from 'lucide-react';

/**
 * NavSearch — "¿qué necesitas?" jump-to-module search over the single nav
 * catalog. Atajo a los 80+ módulos sin recorrer el acordeón. Labels que
 * podrían cortarse muestran `title=` (tooltip) en vez de truncar en
 * silencio (directiva: no omitir información).
 */
export function NavSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { features } = useSubscription();
  const { isAdmin } = useFirebase();
  const [query, setQuery] = useState('');

  const catalog = useMemo(() => buildNavCatalog(t, features, isAdmin), [t, features, isAdmin]);
  const results = useMemo(() => searchNav(catalog, query, 8), [catalog, query]);

  const go = (path: string): void => {
    navigate(path);
    setQuery('');
  };

  return (
    <div className="relative w-full">
      <div className="relative flex items-center group">
        <Search className="absolute left-4 w-4 h-4 text-zinc-500 group-focus-within:text-[#4db6ac] transition-colors" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) go(results[0].item.path);
            if (e.key === 'Escape') setQuery('');
          }}
          placeholder={t('nav.search_placeholder', '¿Qué necesitas?')}
          aria-label={t('nav.search_placeholder', '¿Qué necesitas?')}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="nav-search-results"
          className="w-full rounded-2xl py-2.5 pl-11 pr-4 text-sm bg-white/30 dark:bg-zinc-900 text-zinc-900 dark:text-white border border-transparent dark:border-white/5 placeholder:text-zinc-500 focus:ring-2 focus:ring-[#4db6ac]/50 focus:outline-none transition-all"
        />
      </div>
      {results.length > 0 && (
        <ul
          id="nav-search-results"
          role="listbox"
          className="absolute z-[90] mt-2 w-full max-h-80 overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 shadow-xl py-1"
        >
          {results.map(({ item, blockTitle }) => (
            <NavSearchResultRow
              key={item.path}
              title={item.title}
              blockTitle={blockTitle}
              Icon={item.icon}
              color={item.color}
              onSelect={() => go(item.path)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NavSearchResultRow({
  title, blockTitle, Icon, color, onSelect,
}: {
  title: string;
  blockTitle: string;
  Icon: LucideIcon;
  color: string;
  onSelect: () => void;
}) {
  // ~280px de ancho útil de fila menos íconos/padding ≈ 200px para el label.
  const { fits } = useTextFits(title, '14px Inter', 200);
  return (
    <li role="option" aria-selected={false}>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-xl transition-colors',
          'hover:bg-zinc-100 dark:hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4db6ac]',
        )}
      >
        <Icon className={cn('w-4 h-4 shrink-0', color)} />
        <span className="flex flex-col min-w-0">
          <span
            className="text-sm font-medium text-zinc-900 dark:text-white truncate"
            title={fits ? undefined : title}
          >
            {title}
          </span>
          <span className="text-xs text-zinc-500 truncate">{blockTitle}</span>
        </span>
      </button>
    </li>
  );
}
