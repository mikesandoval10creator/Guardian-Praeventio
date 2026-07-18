// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.12 page wrapper tests.
//
// Smoke tests for `<LessonsLearned />`:
//   1. Empty state cuando no hay proyecto seleccionado.
//   2. Loading state desde el hook.
//   3. Empty state cuando el proyecto sí está pero el hook devuelve 0
//      lecciones (mensaje explica que se generan desde incidentes).
//   4. Render de tarjetas: summary, scope badge, referencia textual al
//      incidente origen (Codex P2 round 2: el link se eliminó porque
//      `Lesson` no carga `sourceProjectId`).
//   5. Filtra en cliente lecciones con scope `project`/`crew` (Codex
//      P2 round 2: la API es tenant-scoped y mostrarlas filtraría
//      conocimiento de otro proyecto del tenant como aplicable).
//   6. Chip default etiquetado "Top adoptadas" y subtítulo coherente
//      (Codex P2 round 2: la ruta sin filtro devuelve top-10, no todo).
//   7. Chip de offline.
//   8. Toolbar: clic en un filtro de riesgo aplica el filtro y se
//      refleja en aria-pressed.
//   9. Error con mensaje del hook.
//
// Mocks contexts/hooks para que el test sea hermético — no fetch, no
// Firebase, no i18n internals.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LessonsLearned } from './LessonsLearned';
import type { Lesson } from '../services/lessonsLearned/lessonsLibrary';

// Codex P2 round 2 (PR #310): la página ya NO renderiza un Link al
// incidente origen — el endpoint `/lessons` es tenant-scoped y
// `Lesson` no carga `sourceProjectId`, así que cualquier href que
// armemos contra `/incidents/:id/bundle` puede caer en
// `cross_project_forbidden`. En lugar del Link mostramos sólo una
// referencia textual al ID del incidente. Ya no hace falta mock de
// `react-router-dom`.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let out = fallback;
          for (const [key, val] of Object.entries(opts)) {
            out = out.replace(`{{${key}}}`, String(val));
          }
          return out;
        }
        return fallback;
      }
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
type LessonsHookState = {
  data: { lessons: Lesson[] } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
let mockLessonsState: LessonsHookState;
const refetchSpy = vi.fn();
// Mantenemos la última opt pasada al hook para verificar que el chip
// de filtro la propaga.
let lastHookOpts: { scope?: string; riskCategory?: string } | undefined;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useLessonsLearned', () => ({
  useLessons: (
    _pid: string | null,
    opts?: { scope?: string; riskCategory?: string },
  ) => {
    lastHookOpts = opts;
    return mockLessonsState;
  },
}));

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  refetchSpy.mockReset();
  lastHookOpts = undefined;
  mockLessonsState = {
    data: null,
    loading: false,
    error: null,
    refetch: refetchSpy,
  };
});

// Codex P2 round 2 (PR #310): la página ahora filtra en cliente para
// quedarse solo con scopes tenant-wide (`global` + `industry`). El
// scope `project` se descarta porque `Lesson` no carga `sourceProjectId`
// y mostrarla sería presentar conocimiento de otro proyecto como
// aplicable al actual. Por eso el sample test usa `industry`: la
// página la renderiza, y verifica el badge correcto.
const sampleLesson: Lesson = {
  id: 'lesson_xyz_1',
  summary: 'Verificar arnés antes de subir andamio.',
  preventiveAction: 'Checklist diario de EPP con firma del supervisor.',
  riskCategories: ['altura'],
  tags: ['arnes', 'andamio', 'epp'],
  scope: 'industry',
  industry: 'construccion',
  derivedFromIncidentId: 'inc_abc_42',
  publishedAt: '2026-04-15T10:00:00.000Z',
  adoptionCount: 7,
};

describe('<LessonsLearned /> page wrapper (Fase F.12)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<LessonsLearned />);
    expect(screen.getByTestId('lessons-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockLessonsState = {
      data: null,
      loading: true,
      error: null,
      refetch: refetchSpy,
    };
    render(<LessonsLearned />);
    expect(screen.getByTestId('lessons-loading')).toBeInTheDocument();
  });

  it('renderiza empty-state explicativo cuando no hay lecciones aún', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockLessonsState = {
      data: { lessons: [] },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<LessonsLearned />);
    expect(screen.getByTestId('lessons-page')).toBeInTheDocument();
    expect(screen.getByTestId('lessons-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/se generan automáticamente desde incidents cerrados/i),
    ).toBeInTheDocument();
  });

  it('renderiza una tarjeta por lección con summary, scope badge y referencia textual al incidente', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockLessonsState = {
      data: { lessons: [sampleLesson] },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<LessonsLearned />);
    expect(screen.getByTestId('lessons-list')).toBeInTheDocument();
    expect(
      screen.getByTestId(`lesson-card-${sampleLesson.id}`),
    ).toBeInTheDocument();
    expect(screen.getByText(sampleLesson.summary)).toBeInTheDocument();
    // Scope badge — 'industry' renderiza el label "Industria".
    expect(
      screen.getByTestId(`lesson-scope-${sampleLesson.id}`),
    ).toHaveTextContent(/industria/i);
    // Codex P2 round 2 (PR #310): ya no esperamos un Link clickeable
    // al incidente origen — sólo una referencia textual con el ID.
    // El elemento NO debe ser un anchor (no href).
    const ref = screen.getByTestId(`lesson-source-ref-${sampleLesson.id}`);
    expect(ref).toBeInTheDocument();
    expect(ref).toHaveTextContent(sampleLesson.derivedFromIncidentId!);
    expect(ref.tagName.toLowerCase()).not.toBe('a');
    // Subtítulo: sin filtro de riesgo, el modo default es "Top
    // adoptadas" y debe explicar que el listado está truncado al
    // top-10 del tenant.
    expect(screen.getByText(/top 1 más adoptadas del tenant/i)).toBeInTheDocument();
  });

  it('filtra en cliente lecciones con scope project/crew (no pueden verificarse contra el proyecto actual)', () => {
    // Codex P2 round 2 (PR #310): la API es tenant-scoped, así que
    // una lección con scope 'project' puede provenir de cualquier
    // proyecto del tenant. Sin `sourceProjectId` no podemos
    // validarla; debe omitirse del render.
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const projectLesson: Lesson = {
      ...sampleLesson,
      id: 'lesson_proj_leak',
      scope: 'project',
    };
    const crewLesson: Lesson = {
      ...sampleLesson,
      id: 'lesson_crew_leak',
      scope: 'crew',
    };
    const globalLesson: Lesson = {
      ...sampleLesson,
      id: 'lesson_global_ok',
      scope: 'global',
    };
    mockLessonsState = {
      data: { lessons: [projectLesson, crewLesson, globalLesson] },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<LessonsLearned />);
    expect(screen.queryByTestId(`lesson-card-${projectLesson.id}`)).toBeNull();
    expect(screen.queryByTestId(`lesson-card-${crewLesson.id}`)).toBeNull();
    expect(
      screen.getByTestId(`lesson-card-${globalLesson.id}`),
    ).toBeInTheDocument();
  });

  it('etiqueta el chip default como "Top adoptadas" (no "Todas") y el subtítulo lo refleja', () => {
    // Codex P2 round 2 (PR #310): el endpoint sin filtro cae en
    // `listTopAdopted(limit=10)`, no en un listado exhaustivo. La
    // copy debe ser honesta al respecto.
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockLessonsState = {
      data: { lessons: [] },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<LessonsLearned />);
    expect(screen.getByTestId('lessons-filter-all')).toHaveTextContent(
      /top adoptadas/i,
    );
    expect(screen.getByText(/top 0 más adoptadas del tenant/i)).toBeInTheDocument();
  });

  it('aplica un filtro de riesgo cuando el usuario clickea un chip', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockLessonsState = {
      data: { lessons: [] },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<LessonsLearned />);
    // Estado inicial: sin filtro (el hook recibe `{}`).
    expect(lastHookOpts).toEqual({});
    // Codex P2 (PR #310): click en chip "Altura" — la clave canónica
    // alineada con el adapter es `altura` (no `height`), así el
    // filtro `array-contains` del adapter realmente encuentra las
    // lecciones almacenadas.
    fireEvent.click(screen.getByTestId('lessons-filter-altura'));
    // Después del click el componente re-renderiza con riskCategory.
    expect(lastHookOpts).toEqual({ riskCategory: 'altura' });
    expect(screen.getByTestId('lessons-filter-altura')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('muestra el chip de offline cuando isOnline=false', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsOnline = false;
    mockLessonsState = {
      data: { lessons: [] },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<LessonsLearned />);
    expect(screen.getByTestId('lessons-offline-chip')).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockLessonsState = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: refetchSpy,
    };
    render(<LessonsLearned />);
    expect(screen.getByTestId('lessons-error')).toBeInTheDocument();
    expect(screen.getByText(/conectar con el servidor/i)).toBeInTheDocument();
  });

  // Mount regression: <LessonSuggestionsCard /> must render inside
  // <LessonsLearned /> when a risk-category filter is active and the
  // library has at least one matching lesson. Verifies the component
  // is truly rendered (not just imported / phantom-mounted per CLAUDE.md #23).
  it('renderiza LessonSuggestionsCard cuando hay filtro activo y lecciones cargadas', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const alturaLesson: Lesson = {
      ...sampleLesson,
      id: 'lesson_altura_1',
      riskCategories: ['altura'],
      scope: 'global',
    };
    mockLessonsState = {
      data: { lessons: [alturaLesson] },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<LessonsLearned />);
    // Apply the "altura" risk-category filter first.
    fireEvent.click(screen.getByTestId('lessons-filter-altura'));
    // <LessonSuggestionsCard /> renders with data-testid="lesson-suggestions-card"
    // (or "lesson-suggestions-empty" if no match — either proves it rendered).
    const card = screen.queryByTestId('lesson-suggestions-card') ?? screen.queryByTestId('lesson-suggestions-empty');
    expect(card).toBeInTheDocument();
  });

  it('NO renderiza LessonSuggestionsCard cuando no hay filtro activo (modo top-adoptadas)', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockLessonsState = {
      data: { lessons: [sampleLesson] },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<LessonsLearned />);
    // Without a filter (default top-adoptadas mode) the suggestions card must NOT appear.
    expect(screen.queryByTestId('lesson-suggestions-card')).toBeNull();
    expect(screen.queryByTestId('lesson-suggestions-empty')).toBeNull();
  });
});
