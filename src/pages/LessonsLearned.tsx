// Praeventio Guard — Fase F.12 page wrapper.
//
// Biblioteca de Lecciones Aprendidas. Esta página cierra el último
// eslabón del flujo F.12, que ya tenía service + adapter + endpoint +
// hook implementados, pero no estaba accesible desde la navegación
// del prevencionista: las lecciones derivadas de incidentes cerrados
// vivían sólo dentro del grafo (`LESSON` nodes) y no eran navegables.
//
// Esta página:
//   1. Lee lecciones vía `useLessons(projectId, { riskCategory? })`.
//   2. Toolbar de filtros por categoría de riesgo (chips clickeables:
//      altura, eléctrico, químico, confinado, caliente). El filtro se
//      aplica server-side reusando `useLessons({ riskCategory })`.
//   3. Renderiza cada lección como tarjeta con summary, acción
//      preventiva, scope (badge), tags y referencia al incidente origen.
//   4. Empty-state explicando que las lecciones se generan
//      automáticamente desde incidentes cerrados.
//
// Cumple la promesa F.12: hace navegable la Biblioteca como surface
// product, no sólo como dato interno del grafo.
//
// Codex P2 round 2 (PR #310): el endpoint subyacente es **tenant-scoped**
// — devuelve lecciones de todos los proyectos del tenant — y `Lesson`
// no carga `sourceProjectId`. Para no presentar conocimiento de otros
// proyectos como aplicable al actual:
//   - Filtramos en cliente a scopes tenant-wide (`global` + `industry`)
//     porque project/crew sin source-project ID es engañoso.
//   - Suprimimos el link al incidente origen (el guard server-side
//     bloquearía cualquier ID que no pertenezca al proyecto actual).
//     Mostramos sólo una referencia textual al ID para auditoría.
//   - El chip por defecto ("Todas") se renombró a "Top adoptadas" y
//     el subtítulo explica que el default trae el top-10 más adoptado
//     del tenant (no el listado completo). Cuando el usuario aplica
//     un riskCategory, el conteo refleja el resultado real del filtro.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, WifiOff, Tag, Layers, Calendar, FileText } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useLessons } from '../hooks/useLessonsLearned';
import type { Lesson, LessonScope } from '../services/lessonsLearned/lessonsLibrary';
import { LessonSuggestionsCard } from '../components/lessonsLearned/LessonSuggestionsCard';

// Codex P2 (PR #310): claves canónicas alineadas con las que el resto
// del dominio ya persiste en Firestore. Las fixtures del adapter
// (`lessonsFirestoreAdapter.test.ts`) y los services hermanos
// (`zones/restrictedZonesEngine`, `services/ar/posterCatalog`, work
// permits `kind`, `BarrierAnalysisCard`, etc.) usan los términos en
// español: `altura`, `electric`, `quimico`, `confinado`, `caliente`.
// Antes mandábamos claves en inglés (`height`, `electrical`, …) que
// chocaban con el filtro `array-contains` del adapter y dejaban la
// página vacía aunque hubiera lecciones guardadas. Los labels siguen en
// ES (sidebar/UI completos en ES); sólo las KEYs se realinearon.
// Importante: las clases Tailwind aparecen como strings literales (no
// concatenados con `${color}`) para que el purger no las pierda en
// build de producción.
const RISK_CATEGORIES: ReadonlyArray<{
  key: string;
  label: string;
  activeClasses: string;
}> = [
  {
    key: 'altura',
    label: 'Altura',
    activeClasses: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  {
    key: 'electric',
    label: 'Eléctrico',
    activeClasses: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
  },
  {
    key: 'quimico',
    label: 'Químico',
    activeClasses: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  },
  {
    key: 'confinado',
    label: 'Confinado',
    activeClasses: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  },
  {
    key: 'caliente',
    label: 'Caliente',
    activeClasses: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
  },
];

// Accepts a generic translator-shaped function so the helper composes
// cleanly with the broad TFunction overload set i18next exposes —
// passing `t` directly was tripping TS's variadic overload inference.
type TLite = (key: string, fallback?: string) => string;

function scopeLabel(scope: LessonScope, t: TLite): string {
  switch (scope) {
    case 'global':
      return t('lessons.scope.global', 'Global');
    case 'industry':
      return t('lessons.scope.industry', 'Industria');
    case 'project':
      return t('lessons.scope.project', 'Proyecto');
    case 'crew':
      return t('lessons.scope.crew', 'Cuadrilla');
    default:
      return scope;
  }
}

function scopeBadgeClasses(scope: LessonScope): string {
  // Tokens semánticos: scope=global es el más amplio (teal "trust"),
  // industry es secundario (blue), project/crew son ámbitos cercanos
  // (violeta/indigo). Evitamos el coral porque está reservado para
  // alertas (ver user_color_preferences).
  switch (scope) {
    case 'global':
      return 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20';
    case 'industry':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
    case 'project':
      return 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20';
    case 'crew':
      return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20';
    default:
      return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20';
  }
}

function formatPublishedAt(iso: string, t: TLite): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleDateString('es-CL', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return t('common.unknownDate', 'Fecha desconocida');
  }
}

export function LessonsLearned() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  // Filtro server-side por riskCategory: el hook expone `refetch`
  // pero como pasamos el filtro como argumento, useEffect dentro del
  // hook lo dispara automáticamente cuando cambia el path. No
  // necesitamos invocar refetch() manualmente.
  const [riskCategoryFilter, setRiskCategoryFilter] = useState<string | undefined>(undefined);
  const { data, loading, error } = useLessons(
    projectId,
    riskCategoryFilter ? { riskCategory: riskCategoryFilter } : {},
  );
  const rawLessons: Lesson[] = data?.lessons ?? [];

  // Codex P2 round 2 (PR #310): el endpoint `/lessons` es
  // **tenant-scoped**: la API devuelve lecciones de TODO el tenant,
  // no sólo del proyecto seleccionado. El modelo `Lesson` (ver
  // `services/lessonsLearned/lessonsLibrary.ts`) no incluye un
  // `sourceProjectId`, así que no podemos verificar si una lección
  // con scope `project` o `crew` realmente pertenece al proyecto
  // actual. Sin ese campo, una lección scoped a Proyecto A se vería
  // como aplicable al Proyecto B en el mismo tenant — engañoso y
  // potencialmente dañino (puede sugerir controles que no aplican).
  //
  // Hasta que `Lesson` cargue `sourceProjectId` (cambio de schema,
  // requiere migración Firestore + backfill), restringimos la lista
  // a scopes tenant-wide: `global` (aplica a todos) e `industry` (un
  // filtro coarse que la página puede tolerar). Las `project`/`crew`
  // quedan filtradas en cliente porque no son seguras.
  const lessons: Lesson[] = rawLessons.filter(
    (l) => l.scope === 'global' || l.scope === 'industry',
  );

  // Codex P2 round 2 (PR #310): la ruta `GET /:projectId/lessons`
  // sin query cae en `adapter.listTopAdopted()` con `limit=10`. Si
  // el tenant tiene >10 lecciones, el usuario ve apenas un subset
  // truncado, pero el chip "Todas" y el subtítulo decían "todas las
  // lecciones disponibles" — etiqueta engañosa. Distinguimos el
  // modo top-10 (sin filtro de riesgo) del modo filtrado para
  // ajustar copy y count.
  const isTopAdoptedDefault = !riskCategoryFilter;

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="lessons-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <BookOpen className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('lessons.page.title', 'Biblioteca de Lecciones Aprendidas')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'lessons.page.selectProject',
              'Selecciona un proyecto para ver las lecciones aprendidas disponibles.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="lessons-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
          <BookOpen className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('lessons.page.title', 'Biblioteca de Lecciones Aprendidas')}
          </h1>
          <p className="text-xs text-secondary-token">
            {isTopAdoptedDefault
              ? t(
                  'lessons.page.subtitleTopAdopted',
                  'Conocimiento reutilizable derivado de incidentes cerrados. Top {{count}} más adoptadas del tenant (filtra por riesgo para ver el resto).',
                  { count: lessons.length },
                )
              : t(
                  'lessons.page.subtitleFiltered',
                  'Conocimiento reutilizable derivado de incidentes cerrados. {{count}} lecciones aplicables.',
                  { count: lessons.length },
                )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="lessons-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {/* Toolbar: filtros por categoría de riesgo. El chip "Todas" limpia
          el filtro server-side. */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-default-token bg-surface p-3"
        data-testid="lessons-toolbar"
        role="toolbar"
        aria-label={t('lessons.toolbar.ariaLabel', 'Filtros por categoría de riesgo')}
      >
        <span className="text-[11px] font-bold uppercase tracking-widest text-secondary-token">
          {t('lessons.toolbar.filterBy', 'Filtrar por riesgo:')}
        </span>
        <button
          type="button"
          onClick={() => setRiskCategoryFilter(undefined)}
          data-testid="lessons-filter-all"
          className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border transition-colors ${
            riskCategoryFilter === undefined
              ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20'
              : 'bg-transparent text-secondary-token border-default-token hover:bg-surface-elevated'
          }`}
          aria-pressed={riskCategoryFilter === undefined}
          // Codex P2 round 2 (PR #310): chip antes decía "Todas",
          // pero la ruta `/lessons` sin filtro cae a
          // `listTopAdopted(limit=10)`, no a un listado exhaustivo.
          // Renombrado a "Top adoptadas" para que el contrato del
          // chip coincida con lo que el backend realmente devuelve.
        >
          {t('lessons.toolbar.topAdopted', 'Top adoptadas')}
        </button>
        {RISK_CATEGORIES.map((cat) => {
          const active = riskCategoryFilter === cat.key;
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => setRiskCategoryFilter(cat.key)}
              data-testid={`lessons-filter-${cat.key}`}
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

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="lessons-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="lessons-error"
          role="alert"
        >
          {t('lessons.page.error', 'No se pudieron cargar las lecciones: {{msg}}', {
            msg: error.message,
          })}
        </div>
      )}

      {!loading && !error && lessons.length === 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center"
          data-testid="lessons-empty"
        >
          <FileText className="w-10 h-10 mx-auto mb-3 text-secondary-token" aria-hidden="true" />
          <p className="text-sm font-bold text-primary-token">
            {t('lessons.empty.title', 'Aún no hay lecciones registradas.')}
          </p>
          <p className="mt-2 text-xs text-secondary-token max-w-md mx-auto">
            {t(
              'lessons.empty.subtitle',
              'Las lecciones se generan automáticamente desde incidents cerrados. Cierra un incidente y su análisis raíz alimentará esta biblioteca.',
            )}
          </p>
        </div>
      )}

      {/* LessonSuggestionsCard: pure-function ranking de las lecciones del tenant
          contra el contexto de riesgo activo. Aparece cuando hay filtro activo
          + biblioteca cargada — complementa la lista Firestore con un top-N local. */}
      {!loading && !error && lessons.length > 0 && riskCategoryFilter && (
        <LessonSuggestionsCard
          library={lessons}
          context={{
            taskId: `lessons-filter-${riskCategoryFilter}`,
            riskCategories: [riskCategoryFilter],
            projectId: selectedProject.id,
          }}
          topN={3}
          onLessonClick={(lessonId) => {
            const el = document.querySelector(`[data-testid="lesson-card-${lessonId}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        />
      )}

      {!loading && !error && lessons.length > 0 && (
        <ul
          className="space-y-3"
          data-testid="lessons-list"
          aria-label={t('lessons.list.ariaLabel', 'Lista de lecciones aprendidas')}
        >
          {lessons.map((lesson) => (
            <li
              key={lesson.id}
              data-testid={`lesson-card-${lesson.id}`}
              className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-sm font-bold text-primary-token">{lesson.summary}</h2>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${scopeBadgeClasses(
                    lesson.scope,
                  )}`}
                  data-testid={`lesson-scope-${lesson.id}`}
                >
                  <Layers className="w-2.5 h-2.5" aria-hidden="true" />
                  {scopeLabel(lesson.scope, t as TLite)}
                </span>
              </div>

              {lesson.preventiveAction && (
                <p className="text-xs text-secondary-token">
                  <span className="font-bold text-primary-token">
                    {t('lessons.card.preventive', 'Acción preventiva:')}
                  </span>{' '}
                  {lesson.preventiveAction}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-secondary-token">
                {lesson.riskCategories.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Tag className="w-3 h-3" aria-hidden="true" />
                    {lesson.riskCategories.join(' · ')}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" aria-hidden="true" />
                  {formatPublishedAt(lesson.publishedAt, t as TLite)}
                </span>
                {/* Codex P2 round 2 (PR #310): el link al incidente
                    origen quedó suprimido en TODOS los scopes.
                    Razonamiento: el endpoint `/lessons` es
                    tenant-scoped y `Lesson` no carga `sourceProjectId`,
                    así que aunque la lección tenga
                    `derivedFromIncidentId`, no podemos construir un
                    href seguro: el guard server-side
                    `incidentData.projectId !== projectId` rechazará
                    cualquier incidente que pertenezca a otro
                    proyecto del tenant (→ `cross_project_forbidden`).
                    La iteración previa filtraba sólo a
                    `scope==='project' | 'crew'`, pero ese scope no
                    garantiza el match — la lección con scope
                    'project' pudo originarse en Proyecto A y estar
                    siendo vista desde Proyecto B. Hasta que `Lesson`
                    incluya `sourceProjectId` (cambio de schema +
                    migración Firestore), el link queda oculto.
                    Mostramos en su lugar una referencia textual al
                    ID del incidente, suficiente para auditoría sin
                    construir un href roto. */}
                {lesson.derivedFromIncidentId && (
                  <span
                    className="inline-flex items-center gap-1 text-secondary-token"
                    data-testid={`lesson-source-ref-${lesson.id}`}
                  >
                    <FileText className="w-3 h-3" aria-hidden="true" />
                    {t('lessons.card.sourceIncidentRef', 'Origen: {{id}}', {
                      id: lesson.derivedFromIncidentId,
                    })}
                  </span>
                )}
                <span className="ml-auto text-[10px] uppercase tracking-widest">
                  {t('lessons.card.adoption', 'Adopciones: {{count}}', {
                    count: lesson.adoptionCount,
                  })}
                </span>
              </div>

              {lesson.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {lesson.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-500/10 text-secondary-token border border-zinc-500/20"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default LessonsLearned;
