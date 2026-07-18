// @vitest-environment jsdom
//
// Praeventio Guard — Fase §185-190 page wrapper tests.
//
// 6 smoke tests for `<KnowledgeBase />`:
//   1. Empty state cuando no hay proyecto seleccionado.
//   2. Loading state desde el hook.
//   3. Error con mensaje del hook.
//   4. Empty del hook (proyecto sí, entradas []): render del empty-state
//      explicativo + chip "Crear entrada".
//   5. Búsqueda escribe en el input y propaga al hook.
//   6. Creación: abre modal → submit con título+contenido → llama
//      `createKbEntry`.
//   7. Flag obsoleto: abre modal de detalle → confirma motivo → llama
//      `flagKbObsolete`.
//
// Mocks contexts/hooks/mutations para que el test sea hermético — no
// fetch, no Firebase, no i18n internals.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KnowledgeBase } from './KnowledgeBase';
import type { KnowledgeEntry } from '../hooks/useKnowledgeBase';

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
type KbHookState = {
  data: {
    entries: KnowledgeEntry[];
    searched: boolean;
    category: string | null;
  } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
let mockKbState: KbHookState;
const refetchSpy = vi.fn();
let lastHookOpts: { category?: string; search?: string } | undefined;

const createSpy = vi.fn().mockResolvedValue({ entry: { id: 'new' } });
const entryUseSpy = vi.fn().mockResolvedValue(undefined);
const flagObsoleteSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useKnowledgeBase', () => ({
  useKnowledgeBase: (
    _pid: string | null,
    opts?: { category?: string; search?: string },
  ) => {
    lastHookOpts = opts;
    return mockKbState;
  },
  createKbEntry: (pid: string, payload: unknown) => createSpy(pid, payload),
  recordKbEntryUse: (pid: string, id: string) => entryUseSpy(pid, id),
  flagKbObsolete: (pid: string, id: string, reason: string) =>
    flagObsoleteSpy(pid, id, reason),
}));

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  refetchSpy.mockReset();
  createSpy.mockClear();
  entryUseSpy.mockClear();
  flagObsoleteSpy.mockClear();
  lastHookOpts = undefined;
  mockKbState = {
    data: null,
    loading: false,
    error: null,
    refetch: refetchSpy,
  };
});

const sampleEntry: KnowledgeEntry = {
  id: 'kb_1',
  kind: 'glossary',
  title: 'Arnés de seguridad',
  content: 'El arnés es equipo individual obligatorio para trabajos en altura.',
  tags: ['altura', 'epp'],
  lastReviewedAt: '2026-04-01T00:00:00.000Z',
  viewCount: 5,
  isObsolete: false,
  authorUid: 'u1',
  sourceType: 'experience',
};

describe('<KnowledgeBase /> page wrapper (§185-190)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<KnowledgeBase />);
    expect(screen.getByTestId('knowledge-base-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockKbState = {
      data: null,
      loading: true,
      error: null,
      refetch: refetchSpy,
    };
    render(<KnowledgeBase />);
    expect(screen.getByTestId('knowledge-base-loading')).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockKbState = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: refetchSpy,
    };
    render(<KnowledgeBase />);
    expect(screen.getByTestId('knowledge-base-error')).toBeInTheDocument();
    expect(screen.getByText(/conectar con el servidor/i)).toBeInTheDocument();
  });

  it('renderiza resultados de búsqueda y propaga el search query al hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockKbState = {
      data: {
        entries: [sampleEntry],
        searched: true,
        category: null,
      },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<KnowledgeBase />);
    // Verifica la tarjeta se renderiza con el badge de categoría.
    expect(screen.getByTestId(`kb-card-${sampleEntry.id}`)).toBeInTheDocument();
    expect(screen.getByText(sampleEntry.title)).toBeInTheDocument();
    expect(
      screen.getByTestId(`kb-category-${sampleEntry.id}`),
    ).toHaveTextContent(/glosario/i);
    // Escribe en la búsqueda: con length >= 3 la opt debería incluir
    // `search`. La opt inicial es `{ category: undefined, search: undefined }`.
    fireEvent.change(screen.getByTestId('knowledge-base-search-input'), {
      target: { value: 'arnes' },
    });
    expect(lastHookOpts?.search).toBe('arnes');
  });

  it('permite crear una entrada via el modal de creación', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockKbState = {
      data: { entries: [], searched: false, category: null },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<KnowledgeBase />);
    fireEvent.click(screen.getByTestId('knowledge-base-create-btn'));
    expect(screen.getByTestId('knowledge-base-create-modal')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('knowledge-base-create-title'), {
      target: { value: 'Nuevo procedimiento de bloqueo' },
    });
    fireEvent.change(screen.getByTestId('knowledge-base-create-content'), {
      target: { value: 'Pasos: 1) cortar energía, 2) candar, 3) verificar.' },
    });
    fireEvent.click(screen.getByTestId('knowledge-base-create-submit'));
    // Espera al microtask que ejecuta la promesa.
    await Promise.resolve();
    await Promise.resolve();
    expect(createSpy).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        title: 'Nuevo procedimiento de bloqueo',
        content: 'Pasos: 1) cortar energía, 2) candar, 3) verificar.',
        category: 'guide',
        sourceType: 'experience',
      }),
    );
  });

  it('permite reportar una entrada como obsoleta desde el detalle', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockKbState = {
      data: { entries: [sampleEntry], searched: false, category: null },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<KnowledgeBase />);
    // Clic en la tarjeta abre el detalle.
    fireEvent.click(screen.getByTestId(`kb-card-${sampleEntry.id}`));
    expect(screen.getByTestId('knowledge-base-detail-modal')).toBeInTheDocument();
    // Clic en "Reportar obsoleta" muestra el form.
    fireEvent.click(screen.getByTestId('knowledge-base-flag-obsolete-btn'));
    fireEvent.change(screen.getByTestId('knowledge-base-flag-reason'), {
      target: { value: 'Normativa DS 132 fue actualizada en 2026.' },
    });
    fireEvent.click(screen.getByTestId('knowledge-base-flag-submit'));
    await Promise.resolve();
    await Promise.resolve();
    expect(flagObsoleteSpy).toHaveBeenCalledWith(
      'p-1',
      sampleEntry.id,
      'Normativa DS 132 fue actualizada en 2026.',
    );
  });
});
