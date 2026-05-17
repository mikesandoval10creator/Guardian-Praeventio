// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.12 page wrapper tests.
//
// Smoke tests for `<LessonsLearned />`:
//   1. Empty state cuando no hay proyecto seleccionado.
//   2. Loading state desde el hook.
//   3. Empty state cuando el proyecto sí está pero el hook devuelve 0
//      lecciones (mensaje explica que se generan desde incidentes).
//   4. Render de tarjetas: summary, scope badge, link al incidente
//      origen, acción preventiva.
//   5. Chip de offline.
//   6. Toolbar: clic en un filtro de riesgo aplica el filtro y se
//      refleja en aria-pressed.
//   7. Error con mensaje del hook.
//
// Mocks contexts/hooks para que el test sea hermético — no fetch, no
// Firebase, no i18n internals.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LessonsLearned } from './LessonsLearned';
import type { Lesson } from '../services/lessonsLearned/lessonsLibrary';

// Codex P2 (PR #310): la página ahora usa <Link> de react-router-dom
// (no <a href>) para preservar la selección de proyecto. Mock mínimo:
// el Link sólo necesita renderizar un <a> con el `to` como `href` para
// que el test siga validando el destino. Importamos React inline para
// evitar tocar las dependencias del bundle de tests.
vi.mock('react-router-dom', async () => {
  const React = await import('react');
  type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    children?: React.ReactNode;
  };
  return {
    Link: ({ to, children, ...rest }: LinkProps) =>
      React.createElement('a', { ...rest, href: to }, children),
  };
});

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
vi.mock('../hooks/useSprintK', () => ({
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

// Codex P2 (PR #310): canonical risk category key is the Spanish
// `altura` (matches the adapter/fixtures/work-permit kinds). Scope
// stays 'project' so the source-incident link is rendered (the page
// now suppresses the link for tenant-wide global/industry scopes
// because the lesson may originate in a different project).
const sampleLesson: Lesson = {
  id: 'lesson_xyz_1',
  summary: 'Verificar arnés antes de subir andamio.',
  preventiveAction: 'Checklist diario de EPP con firma del supervisor.',
  riskCategories: ['altura'],
  tags: ['arnes', 'andamio', 'epp'],
  scope: 'project',
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

  it('renderiza una tarjeta por lección con summary, scope badge y link al incidente', () => {
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
    // Scope badge — 'project' renderiza el label "Proyecto".
    expect(
      screen.getByTestId(`lesson-scope-${sampleLesson.id}`),
    ).toHaveTextContent(/proyecto/i);
    // Link al incidente origen.
    const link = screen.getByTestId(`lesson-source-link-${sampleLesson.id}`);
    expect(link).toHaveAttribute(
      'href',
      `/incidents/${sampleLesson.derivedFromIncidentId}/bundle`,
    );
    // Subtítulo interpolado con count.
    expect(screen.getByText(/1 lecciones disponibles/i)).toBeInTheDocument();
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
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });
});
