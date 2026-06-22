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
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const catalog = useMemo(() => buildNavCatalog(t, features, isAdmin), [t, features, isAdmin]);
  const results = useMemo(() => searchNav(catalog, query, 8), [catalog, query]);

  const go = (path: string): void => {
    navigate(path);
    setQuery('');
    setSelectedIndex(-1);
  };

  const isExpanded = results.length > 0;
  const activeId =
    isExpanded && selectedIndex >= 0 && results[selectedIndex]
      ? `nav-opt-${results[selectedIndex].item.path.replace(/\//g, '-')}`
      : undefined;

  return (
    <div className="relative w-full">
      <div className="relative flex items-center group">
        <Search className="absolute left-4 w-4 h-4 text-muted-token group-focus-within:text-[var(--accent-primary)] transition-colors" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(-1); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const target = selectedIndex >= 0 ? results[selectedIndex] : results[0];
              if (target) go(target.item.path);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelectedIndex((i) => Math.max(i - 1, -1));
            } else if (e.key === 'Escape') {
              setQuery('');
              setSelectedIndex(-1);
            }
          }}
          placeholder={t('nav.search_placeholder', '¿Qué necesitas?')}
          aria-label={t('nav.search_placeholder', '¿Qué necesitas?')}
          role="combobox"
          aria-expanded={isExpanded}
          aria-controls="nav-search-results"
          aria-activedescendant={activeId}
          className="w-full rounded-2xl py-2.5 pl-11 pr-4 text-sm bg-surface text-primary-token border border-default-token placeholder:text-muted-token focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus:outline-none transition-all"
        />
      </div>
      {isExpanded && (
        <ul
          id="nav-search-results"
          role="listbox"
          className="absolute z-[90] mt-2 w-full max-h-80 overflow-y-auto rounded-2xl bg-elevated border border-default-token shadow-mode-lg py-1"
        >
          {results.map(({ item, blockTitle }, index) => (
            <NavSearchResultRow
              key={item.path}
              id={`nav-opt-${item.path.replace(/\//g, '-')}`}
              title={item.title}
              blockTitle={blockTitle}
              Icon={item.icon}
              color={item.color}
              isSelected={index === selectedIndex}
              onSelect={() => go(item.path)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NavSearchResultRow({
  id, title, blockTitle, Icon, color, isSelected, onSelect,
}: {
  id: string;
  title: string;
  blockTitle: string;
  Icon: LucideIcon;
  color: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  // ~280px de ancho útil de fila menos íconos/padding ≈ 200px para el label.
  const { fits } = useTextFits(title, '14px Inter', 200);
  return (
    <li id={id} role="option" aria-selected={isSelected}>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-xl transition-colors',
          'hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          isSelected && 'bg-canvas',
        )}
      >
        <Icon className={cn('w-4 h-4 shrink-0', color)} />
        <span className="flex flex-col min-w-0">
          <span
            className="text-sm font-medium text-primary-token truncate"
            title={fits ? undefined : title}
          >
            {title}
          </span>
          <span className="text-xs text-muted-token truncate">{blockTitle}</span>
        </span>
      </button>
    </li>
  );
}
