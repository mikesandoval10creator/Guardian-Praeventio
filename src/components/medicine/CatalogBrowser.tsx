/**
 * Sprint 21 — Bucket R · Browser genérico para los catálogos médicos bundled.
 * Usa Fuse.js para búsqueda fuzzy offline-first (no requiere IA ni conexión).
 *
 * Reutilizado por DifferentialDiagnosis, DrugInteractions y AnatomyLibrary
 * para exponer datos reales (CIE-10 / ATC / anatomía SST) sin depender de Gemini.
 */
import { useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import { Search, BookOpen, ChevronRight, X } from 'lucide-react';

interface CatalogBrowserProps<T> {
  title: string;
  badge?: string;
  items: T[];
  /** Keys passed to Fuse.js for fuzzy matching. */
  searchKeys: string[];
  /** Returns the primary identifier shown in the list (e.g. ICD-10 code). */
  getPrimary: (item: T) => string;
  /** Returns the human-readable label. */
  getLabel: (item: T) => string;
  /** Renders the detail card body for the selected item. */
  renderDetail: (item: T) => React.ReactNode;
  /** Optional placeholder for the search input. */
  placeholder?: string;
  /** Optional license/source footer. */
  metaFooter?: string;
}

export function CatalogBrowser<T>({
  title,
  badge,
  items,
  searchKeys,
  getPrimary,
  getLabel,
  renderDetail,
  placeholder = 'Buscar…',
  metaFooter,
}: CatalogBrowserProps<T>) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<T | null>(null);

  const fuse = useMemo(
    () => new Fuse(items, { keys: searchKeys, threshold: 0.4, includeScore: false }),
    [items, searchKeys],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 50);
    return fuse.search(query.trim()).slice(0, 50).map((r) => r.item);
  }, [fuse, items, query]);

  return (
    <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-zinc-50/40 dark:bg-zinc-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-200/50 dark:border-white/5 flex items-center gap-2">
        <BookOpen className="w-3.5 h-3.5 text-teal-500 dark:text-gold-400" />
        <p className="text-xs font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-200 flex-1">
          {title}
        </p>
        {badge && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-black tracking-widest bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 uppercase">
            {badge}
          </span>
        )}
        <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-mono">
          {items.length}
        </span>
      </div>

      <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* List + search */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-white/10 text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-400/40"
            />
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
            {filtered.length === 0 && (
              <p className="text-[11px] text-zinc-400 italic px-2 py-3 text-center">
                Sin resultados.
              </p>
            )}
            {filtered.map((item, i) => {
              const isSelected = selected === item;
              return (
                <button
                  key={`${getPrimary(item)}-${i}`}
                  type="button"
                  onClick={() => setSelected(item)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                    isSelected
                      ? 'bg-teal-400/10 dark:bg-gold-400/10 border border-teal-400/30 dark:border-gold-400/30'
                      : 'border border-transparent hover:bg-white dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[9px] font-mono font-black tracking-widest border border-violet-500/20 shrink-0">
                    {getPrimary(item)}
                  </span>
                  <span className="text-[11px] text-zinc-700 dark:text-zinc-300 line-clamp-1 flex-1">
                    {getLabel(item)}
                  </span>
                  <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail */}
        <div className="rounded-xl bg-white dark:bg-zinc-800/40 border border-zinc-200/50 dark:border-white/10 p-3 min-h-[200px] relative">
          {selected ? (
            <>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Cerrar detalle"
                className="absolute top-2 right-2 p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700/50 text-zinc-400"
              >
                <X className="w-3 h-3" />
              </button>
              {renderDetail(selected)}
            </>
          ) : (
            <p className="text-[11px] text-zinc-400 italic text-center py-12">
              Selecciona una entrada del catálogo para ver detalles.
            </p>
          )}
        </div>
      </div>

      {metaFooter && (
        <p className="px-4 py-2 border-t border-zinc-200/50 dark:border-white/5 text-[9px] text-zinc-400 italic">
          {metaFooter}
        </p>
      )}
    </div>
  );
}
