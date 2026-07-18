// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.20 page wrapper tests.
//
// Smoke tests for `<DrillsManager />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook (initial fetch).
//   3. Error state from the hook surfaces with message.
//   4. List render: drill cards visible with kind/status badges.
//   5. Filter by kind: clicking a kind chip updates the active hook call.
//   6. Filter by status: switching to "Completados" shows completed drills.
//   7. Clicking a card opens the detail modal.
//
// Hermetic: hooks and contexts are mocked so the test has no fetch,
// no Firestore, no router state to drive. Matches the patterns used
// by `Inbox.test.tsx` and `CorrectiveActions.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DrillsManager } from './DrillsManager';
import type { DrillRecord, DrillsResponse } from '../hooks/useDrillsManager';
// `executeDrill` is mocked below; we re-grab the spy after `render`
// so the failure test can assert/reject without coupling the order in
// the manual mock factory.
import * as sprintKHooks from '../hooks/useDrillsManager';

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

type MockState = {
  data: DrillsResponse | null;
  loading: boolean;
  error: Error | null;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockPlanned: MockState;
let mockInProgress: MockState;
let mockCompleted: MockState;
let mockCancelled: MockState;

// Track the most recent call args so we can assert the hook receives
// the right filter set after a chip click.
let lastDrillsCallArgs: {
  status?: string;
  kind?: string;
} | null = null;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useDrillsManager', () => ({
  useDrills: (
    _projectId: string | null,
    opts?: { status?: string; kind?: string },
  ) => {
    lastDrillsCallArgs = opts ?? {};
    if (opts?.status === 'in_progress') return mockInProgress;
    if (opts?.status === 'completed') return mockCompleted;
    if (opts?.status === 'cancelled') return mockCancelled;
    return mockPlanned;
  },
  planDrill: vi.fn(),
  executeDrill: vi.fn(),
}));

function emptyState(): MockState {
  return {
    data: { drills: [] },
    loading: false,
    error: null,
  };
}

function plannedDrill(over: Partial<DrillRecord> = {}): DrillRecord {
  return {
    id: 'drill_p1',
    kind: 'evacuation',
    scheduledAt: '2026-06-01T09:00:00.000Z',
    responsibleUid: 'uid_responsable',
    status: 'planned',
    title: 'Simulacro semestral Faena Norte',
    createdAt: '2026-05-01T00:00:00.000Z',
    createdBy: 'uid_admin',
    ...over,
  };
}

function completedDrill(over: Partial<DrillRecord> = {}): DrillRecord {
  return {
    id: 'drill_c1',
    kind: 'fire',
    scheduledAt: '2026-04-01T09:00:00.000Z',
    responsibleUid: 'uid_brigada',
    status: 'completed',
    title: 'Simulacro incendio Q1',
    createdAt: '2026-03-01T00:00:00.000Z',
    createdBy: 'uid_admin',
    executedAt: '2026-04-01T10:00:00.000Z',
    participantCount: 95,
    expectedCount: 100,
    responseTimeSeconds: 180,
    benchmarkSeconds: 240,
    observedGaps: [],
    requiredExternal: false,
    report: {
      participationRate: 95,
      speedDeficitPercent: -25,
      level: 'excellent',
      recommendations: [],
    },
    ...over,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  lastDrillsCallArgs = null;
  mockPlanned = emptyState();
  mockInProgress = emptyState();
  mockCompleted = emptyState();
  mockCancelled = emptyState();
});

describe('<DrillsManager /> page wrapper (Fase F.20)', () => {
  it('renderiza empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<DrillsManager />);
    expect(
      screen.getByTestId('drills-manager-page-empty'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook está cargando', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockPlanned = { data: null, loading: true, error: null };
    render(<DrillsManager />);
    expect(
      screen.getByTestId('drills-manager-loading'),
    ).toBeInTheDocument();
  });

  it('muestra el mensaje del error que devuelve el hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockPlanned = {
      data: null,
      loading: false,
      error: new Error('Network down'),
    };
    render(<DrillsManager />);
    expect(
      screen.getByTestId('drills-manager-error'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('drills-manager-error')).toHaveTextContent(
      /(conectar|conexión) con el servidor/i,
    );
  });

  it('renderiza la lista de simulacros planificados', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockPlanned = {
      data: { drills: [plannedDrill(), plannedDrill({ id: 'drill_p2', title: 'Simulacro Faena Sur' })] },
      loading: false,
      error: null,
    };
    render(<DrillsManager />);
    expect(screen.getByTestId('drills-manager-list')).toBeInTheDocument();
    expect(screen.getByTestId('drills-card-drill_p1')).toBeInTheDocument();
    expect(screen.getByTestId('drills-card-drill_p2')).toBeInTheDocument();
    expect(
      screen.getByText('Simulacro semestral Faena Norte'),
    ).toBeInTheDocument();
  });

  it('filtra por tipo cuando el usuario clickea un chip de tipo', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockPlanned = {
      data: { drills: [plannedDrill()] },
      loading: false,
      error: null,
    };
    render(<DrillsManager />);
    // Click "Incendio" kind chip. After this, the hook should be called
    // with kind: 'fire' (the last call is the planned one with kind).
    fireEvent.click(screen.getByTestId('drills-kind-chip-fire'));
    expect(lastDrillsCallArgs?.kind).toBe('fire');
  });

  it('filtra por estado cuando el usuario cambia a Completados', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockPlanned = {
      data: { drills: [plannedDrill()] },
      loading: false,
      error: null,
    };
    mockCompleted = {
      data: { drills: [completedDrill()] },
      loading: false,
      error: null,
    };
    render(<DrillsManager />);
    fireEvent.click(screen.getByTestId('drills-status-chip-completed'));
    // After switching to "Completados" the page should show the
    // completed drill card and its level badge ("Excelente").
    expect(screen.getByTestId('drills-card-drill_c1')).toBeInTheDocument();
    expect(screen.getByTestId('drills-level-drill_c1')).toHaveTextContent(
      /Excelente/i,
    );
  });

  it('abre el modal de detalle al clickear una tarjeta', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockPlanned = {
      data: { drills: [plannedDrill()] },
      loading: false,
      error: null,
    };
    render(<DrillsManager />);
    fireEvent.click(screen.getByTestId('drills-card-drill_p1'));
    expect(screen.getByTestId('drills-detail-modal')).toBeInTheDocument();
  });

  // Codex PR #316 P2 (DrillsManager.tsx line 330): si `executeDrill`
  // falla, el catch ya no se debe tragar el error. El modal queda
  // abierto (no se cierra) y aparece un banner con el mensaje real
  // para que el usuario no pierda lo escrito.
  //
  // Codex PR #316 R2 P2 (line 525): el banner ahora vive DENTRO del
  // modal (testid `drills-detail-execute-error`). Antes era page-level
  // pero quedaba detrás del backdrop `z-50` y nunca era visible.
  it('cuando executeDrill rechaza, el modal queda abierto y muestra banner de error dentro del modal', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    const planned = plannedDrill({
      id: 'drill_p1',
      // Plan con baselines para que el botón submit no se quede en
      // estado inválido por NaN al construir el payload.
      expectedCount: 100,
      benchmarkSeconds: 240,
    });
    mockPlanned = {
      data: { drills: [planned] },
      loading: false,
      error: null,
    };
    // Forzar el rechazo del mutador. Usamos `mockImplementationOnce`
    // sobre el spy ya creado por el factory en `vi.mock` arriba.
    const executeMock = vi.mocked(sprintKHooks.executeDrill);
    executeMock.mockRejectedValueOnce(
      new Error('Network down (firestore unavailable)'),
    );

    render(<DrillsManager />);
    fireEvent.click(screen.getByTestId('drills-card-drill_p1'));
    // El form ya viene pre-llenado con `participantCount` y
    // `responseTimeSeconds` del drill. Si no, los seteamos.
    const participants = screen.getByTestId(
      'drills-detail-participants-input',
    ) as HTMLInputElement;
    if (!participants.value || participants.value === 'undefined') {
      fireEvent.change(participants, { target: { value: '90' } });
    }
    const response = screen.getByTestId(
      'drills-detail-response-input',
    ) as HTMLInputElement;
    if (!response.value || response.value === 'undefined') {
      fireEvent.change(response, { target: { value: '200' } });
    }

    fireEvent.click(screen.getByTestId('drills-detail-execute-button'));

    // Banner visible DENTRO del modal con el mensaje real (Codex R2 P2).
    await waitFor(() => {
      expect(
        screen.getByTestId('drills-detail-execute-error'),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('drills-detail-execute-error')).toHaveTextContent(
      /(conectar|conexión) con el servidor/i,
    );
    // Modal sigue abierto — el usuario no perdió lo que escribió.
    expect(screen.getByTestId('drills-detail-modal')).toBeInTheDocument();
  });

  // Codex PR #316 R2 P2 (line 323): si `planDrill` rechaza
  // (offline / unauthorized / Firestore down), `NewDrillModal` debe
  // mostrar un banner inline en vez de cerrarse en silencio y dejar
  // al planner creyendo que el simulacro se guardó.
  it('cuando planDrill rechaza, NewDrillModal queda abierto y muestra banner inline', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockPlanned = {
      data: { drills: [] },
      loading: false,
      error: null,
    };
    const planMock = vi.mocked(sprintKHooks.planDrill);
    planMock.mockRejectedValueOnce(
      new Error('Unauthorized (no role for project)'),
    );

    render(<DrillsManager />);
    // Abrir el modal "Nuevo Simulacro" desde el header CTA (hay 2 CTAs
    // con el mismo label, header y empty-state — usamos el testid del
    // header para que el selector sea único).
    fireEvent.click(screen.getByTestId('drills-manager-new-button'));
    expect(screen.getByTestId('drills-new-modal')).toBeInTheDocument();

    // Rellenar el campo obligatorio: UID responsable.
    const responsible = screen.getByPlaceholderText(
      'uid_responsable',
    ) as HTMLInputElement;
    fireEvent.change(responsible, { target: { value: 'uid_resp_test' } });

    fireEvent.click(screen.getByTestId('drills-new-submit-button'));

    // Banner inline en el modal con el mensaje real.
    await waitFor(() => {
      expect(
        screen.getByTestId('drills-new-plan-error'),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('drills-new-plan-error')).toHaveTextContent(
      /sesión no es válida/i,
    );
    // Modal sigue abierto — no se cerró en silencio.
    expect(screen.getByTestId('drills-new-modal')).toBeInTheDocument();
  });
});
