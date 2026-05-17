// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.4 page wrapper tests.
//
// Smoke tests for `<CorrectiveActions />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Promotion of legacy `CorrectiveAction` records to
//      `CorrectiveActionRecord` (defaults applied; no missing fields).
//   4. Hook error surfaces in the UI.
//
// The component mocks the Sprint K hook and project/online contexts so
// the test is hermetic — no Firestore, no fetch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CorrectiveActions } from './CorrectiveActions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        // Naïve {{count}}/{{msg}} interpolation so the test can read
        // the rendered subtitle without binding to i18n internals.
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
type LegacyAction = {
  id: string;
  description: string;
  status: 'open' | 'closed' | 'verified';
  isSystemic: boolean;
};
let mockUseCorrectiveActionsReturn: {
  data: { actions: LegacyAction[] } | null;
  loading: boolean;
  error: Error | null;
};

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSprintK', () => ({
  useCorrectiveActions: () => mockUseCorrectiveActionsReturn,
}));

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockUseCorrectiveActionsReturn = {
    data: null,
    loading: false,
    error: null,
  };
});

describe('<CorrectiveActions /> page wrapper (Fase F.4)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<CorrectiveActions />);
    expect(screen.getByTestId('corrective-actions-page-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockUseCorrectiveActionsReturn = { data: null, loading: true, error: null };
    render(<CorrectiveActions />);
    expect(screen.getByTestId('corrective-actions-loading')).toBeInTheDocument();
  });

  it('promueve acciones legacy al shape extendido sin perder campos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockUseCorrectiveActionsReturn = {
      data: {
        actions: [
          {
            id: 'ca_legacy_1',
            description: 'Capacitar al equipo en bloqueo LOTO.',
            status: 'open',
            isSystemic: false,
          },
        ],
      },
      loading: false,
      error: null,
    };
    render(<CorrectiveActions />);
    expect(screen.getByTestId('corrective-actions-page')).toBeInTheDocument();
    // The panel sub-component renders with the promoted record.
    expect(
      screen.getByTestId('corrective-actions-center-panel'),
    ).toBeInTheDocument();
    // Subtitle interpolates the count: header has `{{count}} acciones cargadas`.
    expect(screen.getByText(/1 acciones cargadas/i)).toBeInTheDocument();
  });

  it('muestra el chip de offline cuando isOnline=false', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsOnline = false;
    mockUseCorrectiveActionsReturn = {
      data: { actions: [] },
      loading: false,
      error: null,
    };
    render(<CorrectiveActions />);
    expect(
      screen.getByTestId('corrective-actions-offline-chip'),
    ).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockUseCorrectiveActionsReturn = {
      data: null,
      loading: false,
      error: new Error('Network down'),
    };
    render(<CorrectiveActions />);
    expect(screen.getByTestId('corrective-actions-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });
});
