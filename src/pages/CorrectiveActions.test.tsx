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
// Codex P2 fix rounds 1 + 3 on PR #309: page now fetches every F.4
// status independently (open/in_progress/closed/verified/reopened).
type StatusMock = { data: { actions: LegacyAction[] } | null; loading: boolean; error: Error | null };
let mockOpen: StatusMock;
let mockInProgress: StatusMock;
let mockClosed: StatusMock;
let mockVerified: StatusMock;
let mockReopened: StatusMock;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useCorrectiveActions', () => ({
  useCorrectiveActions: (_pid: string | null, opts?: { status?: string }) => {
    if (opts?.status === 'in_progress') return mockInProgress;
    if (opts?.status === 'closed') return mockClosed;
    if (opts?.status === 'verified') return mockVerified;
    if (opts?.status === 'reopened') return mockReopened;
    return mockOpen;
  },
  scheduleCorrectiveActionEffectivenessReview: vi.fn(),
}));

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  const empty = { data: null, loading: false, error: null };
  mockOpen = empty;
  mockInProgress = empty;
  mockClosed = empty;
  mockVerified = empty;
  mockReopened = empty;
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
    mockOpen = { data: null, loading: true, error: null };
    render(<CorrectiveActions />);
    expect(screen.getByTestId('corrective-actions-loading')).toBeInTheDocument();
  });

  it('promueve acciones legacy al shape extendido sin perder campos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockOpen = {
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
    mockClosed = { data: { actions: [] }, loading: false, error: null };
    mockVerified = { data: { actions: [] }, loading: false, error: null };
    render(<CorrectiveActions />);
    expect(screen.getByTestId('corrective-actions-page')).toBeInTheDocument();
    expect(
      screen.getByTestId('corrective-actions-center-panel'),
    ).toBeInTheDocument();
    // Subtitle interpolates the count: `{{count}} acciones cargadas`.
    expect(screen.getByText(/1 acciones cargadas/i)).toBeInTheDocument();
  });

  it('mezcla open + closed + verified en una sola lista (Codex P2 fix)', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockOpen = {
      data: { actions: [{ id: 'a1', description: 'open one', status: 'open', isSystemic: false }] },
      loading: false,
      error: null,
    };
    mockClosed = {
      data: { actions: [{ id: 'a2', description: 'closed one', status: 'closed', isSystemic: false }] },
      loading: false,
      error: null,
    };
    mockVerified = {
      data: { actions: [{ id: 'a3', description: 'verified one', status: 'verified', isSystemic: false }] },
      loading: false,
      error: null,
    };
    render(<CorrectiveActions />);
    // 1 + 1 + 1 = 3 actions cargadas — PDCA phases now reflect closed/verified.
    expect(screen.getByText(/3 acciones cargadas/i)).toBeInTheDocument();
  });

  it('renderiza ActionBalanceCard alimentado con el portfolio real merged (PR #996)', () => {
    // The ISO 45001 hierarchy-balance card is fed by `balanceActions` — the
    // merged list across every F.4 status. This pins the real wiring: the
    // card must render AND its derived per-level bars must reflect the actual
    // fetched actions (classified by the deterministic weakActionDetector),
    // not an empty/hardcoded shell.
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    // Two training-flavoured + one engineering across open/in_progress.
    mockOpen = {
      data: {
        actions: [
          { id: 'ca1', description: 'Capacitar al equipo en bloqueo LOTO.', status: 'open', isSystemic: false },
          { id: 'ca2', description: 'Realizar curso de manejo defensivo.', status: 'open', isSystemic: false },
        ],
      },
      loading: false,
      error: null,
    };
    mockInProgress = {
      data: {
        actions: [
          { id: 'ca3', description: 'Instalar barrera física en zona de pinch-point.', status: 'open', isSystemic: false },
        ],
      },
      loading: false,
      error: null,
    };
    mockClosed = { data: { actions: [] }, loading: false, error: null };
    mockVerified = { data: { actions: [] }, loading: false, error: null };
    mockReopened = { data: { actions: [] }, loading: false, error: null };
    render(<CorrectiveActions />);

    const card = screen.getByTestId('action-balance-card');
    expect(card).toBeInTheDocument();
    // Header total reflects the 3 merged actions (real count, not 0).
    expect(card).toHaveTextContent(/3\s+acciones/i);
    // The two "capacitar/curso" actions classify as `training` → row shows 2.
    expect(screen.getByTestId('action-balance-row-training')).toHaveTextContent('2');
    // The "instalar barrera física" action classifies as `engineering` → 1.
    expect(screen.getByTestId('action-balance-row-engineering')).toHaveTextContent('1');
  });

  it('muestra el chip de offline cuando isOnline=false', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsOnline = false;
    mockOpen = { data: { actions: [] }, loading: false, error: null };
    mockClosed = { data: { actions: [] }, loading: false, error: null };
    mockVerified = { data: { actions: [] }, loading: false, error: null };
    render(<CorrectiveActions />);
    expect(
      screen.getByTestId('corrective-actions-offline-chip'),
    ).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockOpen = {
      data: null,
      loading: false,
      error: new Error('Network down'),
    };
    render(<CorrectiveActions />);
    expect(screen.getByTestId('corrective-actions-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });
});
