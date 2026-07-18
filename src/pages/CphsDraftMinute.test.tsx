// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.7 page wrapper tests.
//
// Smoke tests for `<CphsDraftMinute />`:
//   1. Empty-state when no project is selected.
//   2. Loading state from the hook.
//   3. Error state surfaces the hook's error message.
//   4. Renders all sections of the draft when data is present.
//   5. Download button serializes the draft as JSON via Blob.
//   6. Offline chip shows when isOnline=false.
//
// Mocks: react-i18next (passthrough with {{var}} interpolation),
// useProject, useOnlineStatus, useCphsDraftMinute. No Firestore, no
// fetch — hermetic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CphsDraftMinute } from './CphsDraftMinute';
import type { MinuteDraft } from '../services/cphs/cphsMinuteAutogenerator';

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
type HookState = {
  data: { draft: MinuteDraft } | null;
  loading: boolean;
  error: Error | null;
};
let mockHookState: HookState;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useCphsMinute', () => ({
  useCphsDraftMinute: () => mockHookState,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <CphsDraftMinute />
    </MemoryRouter>,
  );
}

function fakeDraft(): MinuteDraft {
  return {
    markdown:
      '# Acta CPHS — Empresa Faena Norte\n**Período**: 2026-04\n\n## I. Asistentes\n- Pedro\n- Ana\n\n## II. Incidentes (2)\n- [HIGH] Caída en altura\n- [LOW] Resbalón',
    sections: [
      'Encabezado',
      'Asistentes',
      'Incidentes',
      'Acciones correctivas',
      'Capacitaciones',
      'Inspecciones',
      'Acuerdos sugeridos',
    ],
    suggestedResolutions: [
      {
        text: 'Investigación raíz formal para 1 incidente(s) de severidad alta/crítica.',
        responsibleHint: 'prevencionista + supervisor del área',
      },
      { text: 'Implementar: revisar EPP de altura.' },
    ],
    completenessScore: 72,
    metrics: {
      incidentsCount: 2,
      criticalIncidentsCount: 1,
      openActionsCount: 3,
      closedActionsCount: 5,
      trainingParticipantsTotal: 14,
    },
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockHookState = { data: null, loading: false, error: null };
});

describe('<CphsDraftMinute /> page wrapper (Fase F.7)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    renderPage();
    expect(
      screen.getByTestId('cphs-draft-minute-page-empty'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae el borrador', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHookState = { data: null, loading: true, error: null };
    renderPage();
    expect(
      screen.getByTestId('cphs-draft-minute-loading'),
    ).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook cuando falla', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHookState = {
      data: null,
      loading: false,
      error: new Error('Network down'),
    };
    renderPage();
    expect(
      screen.getByTestId('cphs-draft-minute-error'),
    ).toBeInTheDocument();
    expect(screen.getByText(/conectar con el servidor/i)).toBeInTheDocument();
  });

  it('renderiza secciones del draft cuando hay data', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHookState = {
      data: { draft: fakeDraft() },
      loading: false,
      error: null,
    };
    renderPage();
    // Header + content blocks.
    expect(screen.getByTestId('cphs-draft-minute-page')).toBeInTheDocument();
    expect(
      screen.getByTestId('cphs-draft-minute-content'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('cphs-draft-minute-completeness'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('cphs-draft-minute-metrics'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('cphs-draft-minute-markdown'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('cphs-draft-minute-resolutions'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('cphs-draft-minute-sections'),
    ).toBeInTheDocument();
    // Markdown body actually shows the content.
    expect(screen.getByText(/Caída en altura/)).toBeInTheDocument();
    // Score visible.
    expect(screen.getByText(/72\/100/)).toBeInTheDocument();
    // Sections chips render.
    expect(screen.getByText('Encabezado')).toBeInTheDocument();
    expect(screen.getByText('Acciones correctivas')).toBeInTheDocument();
  });

  it('descarga el draft como JSON al clickear el botón', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHookState = {
      data: { draft: fakeDraft() },
      loading: false,
      error: null,
    };
    // Mock URL.createObjectURL / revokeObjectURL — jsdom doesn't ship them.
    // Type as `any` to bypass the strict `(blob: Blob) => string` signature
    // (we want to capture the Blob arg for assertions).
    const createObjectURL = vi.fn((_blob: Blob): string => 'blob:fake-url');
    const revokeObjectURL = vi.fn((_url: string): void => undefined);
    (global.URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL =
      createObjectURL;
    (global.URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL =
      revokeObjectURL;

    renderPage();
    const btn = screen.getByTestId('cphs-draft-minute-download');
    fireEvent.click(btn);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // Blob was passed; first call arg should be a Blob instance.
    const blobArg = createObjectURL.mock.calls[0]?.[0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect((blobArg as Blob).type).toBe('application/json');
  });

  it('muestra el chip de offline cuando isOnline=false', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsOnline = false;
    mockHookState = {
      data: { draft: fakeDraft() },
      loading: false,
      error: null,
    };
    renderPage();
    expect(
      screen.getByTestId('cphs-draft-minute-offline-chip'),
    ).toBeInTheDocument();
  });
});
