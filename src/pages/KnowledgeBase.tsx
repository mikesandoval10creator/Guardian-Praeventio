// Praeventio Guard — Fase §185-190 page wrapper.
//
// Base de Conocimiento — repositorio consultable de artículos
// (glosario, FAQ, procedimientos, guías, resúmenes normativos)
// reutilizable entre proyectos del tenant. Esta página cierra el
// último eslabón del flujo §185-190 que ya tenía service + endpoint +
// hook implementados:
//
//   1. Lee entradas vía `useKnowledgeBase(projectId, { category?, search? })`.
//   2. Toolbar de búsqueda + filtros por categoría (chips clickeables).
//   3. Renderiza cada entrada como tarjeta con título, categoría,
//      tags, sourceType + warning de obsolescencia si flag activado.
//   4. Botón "Nueva entrada" → form modal (title/content/category/
//      tags/sourceType).
//   5. Click en tarjeta → modal de detalle con contenido completo +
//      "Marcar como usada" + "Reportar obsoleta" + indicador "Derivado
//      de Lecciones Aprendidas (F.12)" si sourceType==='lesson'.
//
// Cumple las directivas §185-190: curador + detector de obsolescencia +
// reutilización medida por viewCount. El motor determinístico
// (`services/knowledgeBase/knowledgeBaseService.ts`) ya lo respalda;
// esta página solo wire UI + hooks.

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Database,
  WifiOff,
  Search,
  Tag,
  AlertTriangle,
  Plus,
  BookOpen,
  CheckCircle2,
  X,
  Link as LinkIcon,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useKnowledgeBase,
  createKbEntry,
  recordKbEntryUse,
  flagKbObsolete,
  type KnowledgeEntry,
  type KbCategory,
  type KbSourceType,
} from '../hooks/useKnowledgeBase';
import { KnowledgeBaseSearch } from '../components/knowledgeBase/KnowledgeBaseSearch';
import { logger } from '../utils/logger';

type TLite = (key: string, fallback?: string) => string;

const CATEGORIES: ReadonlyArray<{
  key: KbCategory;
  label: string;
  activeClasses: string;
}> = [
  {
    key: 'glossary',
    label: 'Glosario',
    activeClasses: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  },
  {
    key: 'faq',
    label: 'FAQ',
    activeClasses: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20',
  },
  {
    key: 'procedure',
    label: 'Procedimiento',
    activeClasses: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  {
    key: 'guide',
    label: 'Guía',
    activeClasses: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  },
  {
    key: 'norm_summary',
    label: 'Normativa',
    activeClasses: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
  },
];

const SOURCE_TYPES: ReadonlyArray<{
  key: KbSourceType;
  label: string;
}> = [
  { key: 'experience', label: 'Experiencia' },
  { key: 'procedure', label: 'Procedimiento' },
  { key: 'standard', label: 'Estándar' },
  { key: 'lesson', label: 'Lección aprendida (F.12)' },
];

function categoryLabel(kind: KbCategory): string {
  const found = CATEGORIES.find((c) => c.key === kind);
  return found?.label ?? kind;
}

function categoryBadgeClasses(kind: KbCategory): string {
  const found = CATEGORIES.find((c) => c.key === kind);
  return (
    found?.activeClasses ??
    'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20'
  );
}

function sourceTypeLabel(s: KbSourceType): string {
  const found = SOURCE_TYPES.find((c) => c.key === s);
  return found?.label ?? s;
}

export function KnowledgeBase() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [search, setSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<KbCategory | undefined>(
    undefined,
  );
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<KnowledgeEntry | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const { data, loading, error, refetch } = useKnowledgeBase(projectId, {
    category: categoryFilter,
    search: search.trim().length >= 3 ? search.trim() : undefined,
  });

  const entries: KnowledgeEntry[] = useMemo(
    () => data?.entries ?? [],
    [data?.entries],
  );

  const handleCreate = async (payload: {
    title: string;
    content: string;
    category: KbCategory;
    tags: string[];
    sourceType: KbSourceType;
  }) => {
    if (!projectId) return;
    try {
      await createKbEntry(projectId, payload);
      setShowCreate(false);
      setMutationError(null);
      refetch();
    } catch (err) {
      logger.error?.('knowledgeBase.create.failed', err);
      setMutationError((err as Error).message);
    }
  };

  const handleUseEntry = async (entryId: string) => {
    if (!projectId) return;
    try {
      await recordKbEntryUse(projectId, entryId);
      setMutationError(null);
      refetch();
    } catch (err) {
      logger.error?.('knowledgeBase.use.failed', err);
      setMutationError((err as Error).message);
    }
  };

  const handleFlagObsolete = async (entryId: string, reason: string) => {
    if (!projectId) return;
    try {
      await flagKbObsolete(projectId, entryId, reason);
      setSelectedEntry(null);
      setMutationError(null);
      refetch();
    } catch (err) {
      logger.error?.('knowledgeBase.flagObsolete.failed', err);
      setMutationError((err as Error).message);
    }
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="knowledge-base-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Database
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('knowledgeBase.page.title', 'Base de Conocimiento')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'knowledgeBase.page.selectProject',
              'Selecciona un proyecto para consultar la base de conocimiento.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="knowledge-base-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center border border-violet-500/20">
          <Database className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('knowledgeBase.page.title', 'Base de Conocimiento')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'knowledgeBase.page.subtitle',
              'Repositorio consultable: glosario, FAQ, procedimientos y guías. {{count}} entradas disponibles.',
              { count: entries.length },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="knowledge-base-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          data-testid="knowledge-base-create-btn"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wide bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors"
        >
          <Plus className="w-3 h-3" aria-hidden="true" />
          {t('knowledgeBase.create.button', 'Nueva entrada')}
        </button>
      </header>

      {/* Toolbar: búsqueda + filtros por categoría */}
      <div
        className="flex flex-col gap-3 rounded-2xl border border-default-token bg-surface p-3"
        data-testid="knowledge-base-toolbar"
      >
        <label className="flex items-center gap-2">
          <Search className="w-4 h-4 text-secondary-token" aria-hidden="true" />
          <input
            type="search"
            placeholder={t(
              'knowledgeBase.search.placeholder',
              'Buscar (mínimo 3 caracteres)…',
            )}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="knowledge-base-search-input"
            className="flex-1 bg-transparent text-sm text-primary-token placeholder:text-secondary-token focus:outline-none"
            aria-label={t(
              'knowledgeBase.search.ariaLabel',
              'Buscar en la base de conocimiento',
            )}
          />
        </label>
        <div
          className="flex flex-wrap items-center gap-2"
          role="toolbar"
          aria-label={t(
            'knowledgeBase.toolbar.ariaLabel',
            'Filtros por categoría',
          )}
        >
          <span className="text-[11px] font-bold uppercase tracking-widest text-secondary-token">
            {t('knowledgeBase.toolbar.filterBy', 'Categoría:')}
          </span>
          <button
            type="button"
            onClick={() => setCategoryFilter(undefined)}
            data-testid="knowledge-base-filter-all"
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border transition-colors ${
              categoryFilter === undefined
                ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20'
                : 'bg-transparent text-secondary-token border-default-token hover:bg-surface-elevated'
            }`}
            aria-pressed={categoryFilter === undefined}
          >
            {t('knowledgeBase.toolbar.all', 'Todas')}
          </button>
          {CATEGORIES.map((cat) => {
            const active = categoryFilter === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setCategoryFilter(cat.key)}
                data-testid={`knowledge-base-filter-${cat.key}`}
                className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border transition-colors ${
                  active
                    ? cat.activeClasses
                    : 'bg-transparent text-secondary-token border-default-token hover:bg-surface-elevated'
                }`}
                aria-pressed={active}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      <KnowledgeBaseSearch
        library={entries}
        onArticleClick={(id) => {
          const entry = entries.find((e) => e.id === id);
          if (entry) setSelectedEntry(entry);
        }}
      />

      {mutationError && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-600 dark:text-rose-400"
          data-testid="knowledge-base-mutation-error"
          role="alert"
        >
          {mutationError}
        </div>
      )}

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="knowledge-base-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="knowledge-base-error"
          role="alert"
        >
          {t(
            'knowledgeBase.page.error',
            'No se pudo cargar la base de conocimiento: {{msg}}',
            { msg: error.message },
          )}
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center"
          data-testid="knowledge-base-empty"
        >
          <BookOpen
            className="w-10 h-10 mx-auto mb-3 text-secondary-token"
            aria-hidden="true"
          />
          <p className="text-sm font-bold text-primary-token">
            {t('knowledgeBase.empty.title', 'Aún no hay entradas registradas.')}
          </p>
          <p className="mt-2 text-xs text-secondary-token max-w-md mx-auto">
            {t(
              'knowledgeBase.empty.subtitle',
              'Crea la primera entrada de glosario, FAQ o procedimiento. También puedes promover una lección aprendida (F.12) al repositorio reutilizable.',
            )}
          </p>
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <ul
          className="space-y-3"
          data-testid="knowledge-base-list"
          aria-label={t(
            'knowledgeBase.list.ariaLabel',
            'Lista de entradas de la base de conocimiento',
          )}
        >
          {entries.map((entry) => (
            <li
              key={entry.id}
              data-testid={`kb-card-${entry.id}`}
              className={`rounded-2xl border bg-surface p-4 space-y-3 cursor-pointer hover:bg-surface-elevated transition-colors ${
                entry.isObsolete
                  ? 'border-amber-500/30'
                  : 'border-default-token'
              }`}
              onClick={() => setSelectedEntry(entry)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedEntry(entry);
                }
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-sm font-bold text-primary-token">
                  {entry.title}
                </h2>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${categoryBadgeClasses(
                    entry.kind,
                  )}`}
                  data-testid={`kb-category-${entry.id}`}
                >
                  {categoryLabel(entry.kind)}
                </span>
              </div>

              {entry.isObsolete && (
                <div
                  className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400"
                  data-testid={`kb-obsolete-warning-${entry.id}`}
                  role="alert"
                >
                  <AlertTriangle
                    className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {t(
                      'knowledgeBase.card.obsolete',
                      'Marcada como obsoleta. {{reason}}',
                      { reason: entry.obsoleteReason ?? '' },
                    )}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-secondary-token">
                {entry.sourceType && (
                  <span className="inline-flex items-center gap-1">
                    <LinkIcon className="w-3 h-3" aria-hidden="true" />
                    {sourceTypeLabel(entry.sourceType)}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  {t('knowledgeBase.card.uses', 'Usos: {{count}}', {
                    count: entry.viewCount,
                  })}
                </span>
                {entry.sourceType === 'lesson' && (
                  <span
                    className="ml-auto text-[10px] uppercase tracking-widest text-violet-600 dark:text-violet-400"
                    data-testid={`kb-from-lesson-${entry.id}`}
                  >
                    {t('knowledgeBase.card.fromLesson', '↩ Lecciones')}
                  </span>
                )}
              </div>

              {entry.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {entry.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-zinc-500/10 text-secondary-token border border-zinc-500/20"
                    >
                      <Tag className="w-2.5 h-2.5" aria-hidden="true" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <CreateEntryModal
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
          t={t as TLite}
        />
      )}

      {selectedEntry && (
        <EntryDetailModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onMarkUsed={() => handleUseEntry(selectedEntry.id)}
          onFlagObsolete={(reason) =>
            handleFlagObsolete(selectedEntry.id, reason)
          }
          t={t as TLite}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// CreateEntryModal
// ────────────────────────────────────────────────────────────────────────

interface CreateEntryModalProps {
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    content: string;
    category: KbCategory;
    tags: string[];
    sourceType: KbSourceType;
  }) => void;
  t: TLite;
}

function CreateEntryModal({ onClose, onSubmit, t }: CreateEntryModalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<KbCategory>('guide');
  const [tagsInput, setTagsInput] = useState('');
  const [sourceType, setSourceType] = useState<KbSourceType>('experience');

  const canSubmit = title.trim().length >= 3 && content.trim().length >= 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="knowledge-base-create-modal"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-default-token bg-surface p-4 space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-primary-token uppercase tracking-tight">
            {t('knowledgeBase.create.title', 'Nueva entrada')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="knowledge-base-create-close"
            className="text-secondary-token hover:text-primary-token"
            aria-label={t('common.close', 'Cerrar')}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-secondary-token">
            {t('knowledgeBase.create.titleField', 'Título')}
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="knowledge-base-create-title"
            className="rounded-lg border border-default-token bg-surface-elevated px-2 py-1 text-sm text-primary-token focus:outline-none focus:border-violet-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-secondary-token">
            {t('knowledgeBase.create.contentField', 'Contenido')}
          </span>
          <textarea
            rows={6}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            data-testid="knowledge-base-create-content"
            className="rounded-lg border border-default-token bg-surface-elevated px-2 py-1 text-sm text-primary-token focus:outline-none focus:border-violet-500 resize-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-secondary-token">
            {t('knowledgeBase.create.categoryField', 'Categoría')}
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as KbCategory)}
            data-testid="knowledge-base-create-category"
            className="rounded-lg border border-default-token bg-surface-elevated px-2 py-1 text-sm text-primary-token focus:outline-none focus:border-violet-500"
          >
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-secondary-token">
            {t('knowledgeBase.create.sourceField', 'Fuente')}
          </span>
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as KbSourceType)}
            data-testid="knowledge-base-create-source"
            className="rounded-lg border border-default-token bg-surface-elevated px-2 py-1 text-sm text-primary-token focus:outline-none focus:border-violet-500"
          >
            {SOURCE_TYPES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-secondary-token">
            {t('knowledgeBase.create.tagsField', 'Etiquetas (separadas por coma)')}
          </span>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            data-testid="knowledge-base-create-tags"
            className="rounded-lg border border-default-token bg-surface-elevated px-2 py-1 text-sm text-primary-token focus:outline-none focus:border-violet-500"
            placeholder="altura, epp, arnes"
          />
        </label>
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() =>
              onSubmit({
                title: title.trim(),
                content: content.trim(),
                category,
                tags: tagsInput
                  .split(',')
                  .map((t2) => t2.trim())
                  .filter((t2) => t2.length > 0),
                sourceType,
              })
            }
            disabled={!canSubmit}
            data-testid="knowledge-base-create-submit"
            className="flex-1 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wide bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('knowledgeBase.create.submit', 'Crear entrada')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wide bg-transparent text-secondary-token border border-default-token hover:bg-surface-elevated transition-colors"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// EntryDetailModal
// ────────────────────────────────────────────────────────────────────────

interface EntryDetailModalProps {
  entry: KnowledgeEntry;
  onClose: () => void;
  onMarkUsed: () => void;
  onFlagObsolete: (reason: string) => void;
  t: TLite;
}

function EntryDetailModal({
  entry,
  onClose,
  onMarkUsed,
  onFlagObsolete,
  t,
}: EntryDetailModalProps) {
  const [showFlag, setShowFlag] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="knowledge-base-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`kb-detail-title-${entry.id}`}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-default-token bg-surface p-4 space-y-3">
        <header className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h2
              id={`kb-detail-title-${entry.id}`}
              className="text-base font-black text-primary-token"
            >
              {entry.title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${categoryBadgeClasses(
                  entry.kind,
                )}`}
              >
                {categoryLabel(entry.kind)}
              </span>
              {entry.sourceType === 'lesson' && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20"
                  data-testid={`kb-detail-from-lesson-${entry.id}`}
                >
                  <LinkIcon className="w-2.5 h-2.5" aria-hidden="true" />
                  {t(
                    'knowledgeBase.detail.fromLesson',
                    'Derivado de Lecciones Aprendidas',
                  )}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="knowledge-base-detail-close"
            className="text-secondary-token hover:text-primary-token flex-shrink-0"
            aria-label={t('common.close', 'Cerrar')}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        {entry.isObsolete && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400"
            role="alert"
          >
            <AlertTriangle
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
              aria-hidden="true"
            />
            <span>
              {t(
                'knowledgeBase.detail.obsolete',
                'Marcada como obsoleta. Motivo: ' +
                  (entry.obsoleteReason ?? 'sin motivo'),
              )}
            </span>
          </div>
        )}

        <div
          className="prose prose-sm max-w-none whitespace-pre-wrap text-sm text-primary-token"
          data-testid={`kb-detail-content-${entry.id}`}
        >
          {entry.content}
        </div>

        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {entry.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-zinc-500/10 text-secondary-token border border-zinc-500/20"
              >
                <Tag className="w-2.5 h-2.5" aria-hidden="true" />
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] text-secondary-token border-t border-default-token pt-2">
          <span>
            {t('knowledgeBase.detail.uses', `Usos: ${entry.viewCount}`)}
          </span>
          <span>
            {t(
              'knowledgeBase.detail.lastReviewed',
              `Última revisión: ${new Date(
                entry.lastReviewedAt,
              ).toLocaleDateString('es-CL')}`,
            )}
          </span>
        </div>

        {showFlag ? (
          <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
                {t('knowledgeBase.detail.flagReasonLabel', 'Motivo de obsolescencia')}
              </span>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="knowledge-base-flag-reason"
                className="rounded-lg border border-amber-500/30 bg-surface-elevated px-2 py-1 text-sm text-primary-token focus:outline-none resize-none"
                placeholder={t(
                  'knowledgeBase.detail.flagReasonPlaceholder',
                  'p.ej. normativa actualizada DS 132 2026',
                )}
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onFlagObsolete(reason.trim())}
                disabled={reason.trim().length < 3}
                data-testid="knowledge-base-flag-submit"
                className="flex-1 px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wide bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('knowledgeBase.detail.flagConfirm', 'Confirmar obsolescencia')}
              </button>
              <button
                type="button"
                onClick={() => setShowFlag(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wide bg-transparent text-secondary-token border border-default-token hover:bg-surface-elevated transition-colors"
              >
                {t('common.cancel', 'Cancelar')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onMarkUsed}
              data-testid="knowledge-base-mark-used-btn"
              className="flex-1 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wide bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 hover:bg-teal-500/20 transition-colors inline-flex items-center justify-center gap-1"
            >
              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
              {t('knowledgeBase.detail.markUsed', 'Marcar como usada')}
            </button>
            {!entry.isObsolete && (
              <button
                type="button"
                onClick={() => setShowFlag(true)}
                data-testid="knowledge-base-flag-obsolete-btn"
                className="px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wide bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-colors inline-flex items-center gap-1"
              >
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                {t('knowledgeBase.detail.flagObsolete', 'Reportar obsoleta')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default KnowledgeBase;
