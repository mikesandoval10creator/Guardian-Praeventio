// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.6 page wrapper tests.
//
// Smoke tests for `<OfflineInspection />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Error state from the hook surfaces with message.
//   4. List render: inspection cards visible with template + status + obs count.
//   5. Filter switching updates the hook call args (En curso → Completadas → Todas).
//   6. "Nueva inspección" CTA opens modal + calls startInspection on confirm.
//   7. Clicking a card opens the detail modal + adding a note calls addObservation.
//
// Hermetic: hooks, contexts and online status are mocked so the test
// has no fetch, no Firestore, no router state. Pattern mirrors
// `CorrectiveActions.test.tsx` and `DrillsManager.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OfflineInspection } from './OfflineInspection';
import type {
  InspectionRecord,
  InspectionsResponse,
} from '../hooks/useOfflineInspections';

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
  data: InspectionsResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockResp: MockState;
let lastHookOpts: { status?: string } | null = null;
const refetchSpy = vi.fn();
const startInspectionSpy = vi.fn();
const addObservationSpy = vi.fn();
const completeInspectionSpy = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

vi.mock('../hooks/useOfflineInspections', () => ({
  useInspections: (_pid: string | null, opts?: { status?: string }) => {
    lastHookOpts = opts ?? {};
    return mockResp;
  },
  startInspection: (...args: unknown[]) => startInspectionSpy(...args),
  addObservation: (...args: unknown[]) => addObservationSpy(...args),
  completeInspection: (...args: unknown[]) => completeInspectionSpy(...args),
}));

// Codex PR #322 P2 #3: the page now reads the signed-in caller's uid
// from Firebase to populate responsibleUid. Mock the auth surface so
// the tests don't pull in the Firebase SDK init path.
vi.mock('../services/firebase', () => ({
  auth: { currentUser: { uid: 'u_inspector' } },
}));

// Codex PR #322 P1 #3: the page now enqueues into IndexedDB before
// calling the network. Mock the outbox module with plain spies so the
// test stays hermetic (no fake-indexeddb plumbing required) and we can
// assert the enqueue ordering.
const enqueueInspectionStartSpy = vi.fn();
const enqueueObservationSpy = vi.fn();
const markInspectionSyncedSpy = vi.fn();
const markInspectionFailedSpy = vi.fn();
const markObservationSyncedSpy = vi.fn();
const markObservationFailedSpy = vi.fn();
const rekeyObservationSpy = vi.fn();
let mockPendingInspections: Array<{ id: string }> = [];
let mockPendingObservations: Array<{
  observationId: string;
  inspectionId: string;
}> = [];
// Codex round 2 additions: module-level flush lock, cross-user purge.
const acquireFlushLockSpy = vi.fn();
const releaseFlushLockSpy = vi.fn();
const clearOutboxForOtherUsersSpy = vi.fn();
vi.mock('../services/inspections/inspectionOutbox', () => ({
  acquireFlushLock: (...args: unknown[]) => acquireFlushLockSpy(...args),
  releaseFlushLock: (...args: unknown[]) => releaseFlushLockSpy(...args),
  clearOutboxForOtherUsers: (...args: unknown[]) =>
    clearOutboxForOtherUsersSpy(...args),
  enqueueInspectionStart: (...args: unknown[]) =>
    enqueueInspectionStartSpy(...args),
  enqueueObservation: (...args: unknown[]) => enqueueObservationSpy(...args),
  // Accept both (ownerUid?) and (inspectionId?, ownerUid?) call shapes.
  listPendingInspections: (..._args: unknown[]) =>
    Promise.resolve(mockPendingInspections),
  listPendingObservations: (..._args: unknown[]) =>
    Promise.resolve(mockPendingObservations),
  markInspectionSynced: (...args: unknown[]) =>
    markInspectionSyncedSpy(...args),
  markInspectionFailed: (...args: unknown[]) =>
    markInspectionFailedSpy(...args),
  markObservationSynced: (...args: unknown[]) =>
    markObservationSyncedSpy(...args),
  markObservationFailed: (...args: unknown[]) =>
    markObservationFailedSpy(...args),
  rekeyObservation: (...args: unknown[]) => rekeyObservationSpy(...args),
}));

// Predictable id so we can assert the start payload without coupling
// to the runtime random output.
vi.mock('../utils/randomId', () => ({
  randomId: () => 'rid_fixed',
}));

function inspectionRecord(over: Partial<InspectionRecord> = {}): InspectionRecord {
  return {
    id: 'insp_1',
    templateId: 'tpl_altura_v1',
    responsibleUid: 'self',
    status: 'in_progress',
    startedAt: '2026-05-17T10:00:00.000Z',
    startedBy: 'u1',
    observations: [],
    ...over,
  };
}

function emptyState(): MockState {
  return {
    data: { inspections: [] },
    loading: false,
    error: null,
    refetch: refetchSpy,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockResp = emptyState();
  lastHookOpts = null;
  refetchSpy.mockReset();
  startInspectionSpy.mockReset();
  startInspectionSpy.mockResolvedValue(inspectionRecord({ id: 'rid_fixed' }));
  addObservationSpy.mockReset();
  addObservationSpy.mockResolvedValue({
    observationId: 'rid_fixed',
    recordedAt: '2026-05-17T10:05:00.000Z',
    recordedBy: 'u_inspector',
  });
  completeInspectionSpy.mockReset();
  enqueueInspectionStartSpy.mockReset();
  enqueueInspectionStartSpy.mockResolvedValue(undefined);
  enqueueObservationSpy.mockReset();
  enqueueObservationSpy.mockResolvedValue(undefined);
  markInspectionSyncedSpy.mockReset();
  markInspectionSyncedSpy.mockResolvedValue(undefined);
  markInspectionFailedSpy.mockReset();
  markInspectionFailedSpy.mockResolvedValue(undefined);
  markObservationSyncedSpy.mockReset();
  markObservationSyncedSpy.mockResolvedValue(undefined);
  markObservationFailedSpy.mockReset();
  markObservationFailedSpy.mockResolvedValue(undefined);
  rekeyObservationSpy.mockReset();
  rekeyObservationSpy.mockResolvedValue(null);
  // Codex round 2 — new helpers.
  acquireFlushLockSpy.mockReset();
  acquireFlushLockSpy.mockReturnValue(true);
  releaseFlushLockSpy.mockReset();
  clearOutboxForOtherUsersSpy.mockReset();
  clearOutboxForOtherUsersSpy.mockResolvedValue(0);
  mockPendingInspections = [];
  mockPendingObservations = [];
});

describe('<OfflineInspection /> page wrapper (Fase F.6)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<OfflineInspection />);
    expect(
      screen.getByTestId('offline-inspection-page-empty'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = { data: null, loading: true, error: null, refetch: refetchSpy };
    render(<OfflineInspection />);
    expect(
      screen.getByTestId('offline-inspection-loading'),
    ).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: refetchSpy,
    };
    render(<OfflineInspection />);
    expect(
      screen.getByTestId('offline-inspection-error'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renderiza la lista de inspecciones con el contador de observaciones', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: {
        inspections: [
          inspectionRecord({
            id: 'insp_1',
            templateId: 'tpl_altura_v1',
            observations: [
              {
                observationId: 'o1',
                recordedAt: '2026-05-17T10:01:00.000Z',
                recordedBy: 'u1',
              },
              {
                observationId: 'o2',
                recordedAt: '2026-05-17T10:02:00.000Z',
                recordedBy: 'u1',
              },
            ],
          }),
        ],
      },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<OfflineInspection />);
    expect(screen.getByTestId('offline-inspection-list')).toBeInTheDocument();
    expect(
      screen.getByTestId('offline-inspection-card-insp_1'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('offline-inspection-card-insp_1-obs-count'),
    ).toHaveTextContent('2 observaciones');
    expect(screen.getByText(/Inspección Trabajo en Altura/i)).toBeInTheDocument();
  });

  it('cambia el filtro al hacer click en "Completadas" y refleja la opción en el hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = emptyState();
    render(<OfflineInspection />);
    // Initial filter is in_progress (default).
    expect(lastHookOpts).toMatchObject({ status: 'in_progress' });
    fireEvent.click(screen.getByTestId('offline-inspection-filter-completed'));
    expect(lastHookOpts).toMatchObject({ status: 'completed' });
    fireEvent.click(screen.getByTestId('offline-inspection-filter-all'));
    expect(lastHookOpts).toMatchObject({ status: 'all' });
  });

  it('abre el modal "Nueva inspección" y llama startInspection con el template, el caller uid (P2 #3) y un id generado', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = emptyState();
    render(<OfflineInspection />);
    fireEvent.click(screen.getByTestId('offline-inspection-new-btn'));
    expect(
      screen.getByTestId('offline-inspection-new-modal'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('offline-inspection-new-confirm'));
    await waitFor(() => {
      expect(startInspectionSpy).toHaveBeenCalledTimes(1);
    });
    expect(startInspectionSpy).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        id: 'rid_fixed',
        templateId: 'tpl_altura_v1',
        // Codex PR #322 P2 #3 — actual caller, not 'self'.
        responsibleUid: 'u_inspector',
      }),
    );
    // Codex PR #322 P1 #3: the outbox enqueue runs BEFORE the network
    // call so a sudden offline doesn't lose the session.
    expect(enqueueInspectionStartSpy).toHaveBeenCalledTimes(1);
    expect(enqueueInspectionStartSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'rid_fixed',
        projectId: 'p-1',
        templateId: 'tpl_altura_v1',
        responsibleUid: 'u_inspector',
      }),
    );
    // The refetch must run after a successful create so the list
    // reflects the new session immediately.
    expect(refetchSpy).toHaveBeenCalled();
  });

  it('Codex PR #322 P2 #1: muestra la nueva inspección como optimistic incluso con filtro "Completadas"', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = emptyState();
    render(<OfflineInspection />);
    // Switch to "Completadas" — without the optimistic + filter-switch
    // logic the new in_progress session would be invisible.
    fireEvent.click(screen.getByTestId('offline-inspection-filter-completed'));
    fireEvent.click(screen.getByTestId('offline-inspection-new-btn'));
    fireEvent.click(screen.getByTestId('offline-inspection-new-confirm'));
    await waitFor(() => {
      expect(
        screen.getByTestId('offline-inspection-detail-modal'),
      ).toBeInTheDocument();
    });
    // Filter should have flipped back to in_progress so the new
    // session is visible in the underlying list too.
    expect(lastHookOpts).toMatchObject({ status: 'in_progress' });
  });

  it('Codex PR #322 P1 #3: cuando offline + el POST falla, la sesión queda en el outbox como pending', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsOnline = false;
    mockResp = emptyState();
    startInspectionSpy.mockRejectedValueOnce(new Error('Network down'));
    render(<OfflineInspection />);
    fireEvent.click(screen.getByTestId('offline-inspection-new-btn'));
    fireEvent.click(screen.getByTestId('offline-inspection-new-confirm'));
    await waitFor(() => {
      expect(enqueueInspectionStartSpy).toHaveBeenCalledTimes(1);
    });
    // The outbox enqueue still happened, the network attempt failed,
    // and we marked the outbox entry as failed (it stays in the queue
    // for next flush).
    await waitFor(() => {
      expect(markInspectionFailedSpy).toHaveBeenCalledWith(
        'rid_fixed',
        expect.stringContaining('Network down'),
      );
    });
    expect(markInspectionSyncedSpy).not.toHaveBeenCalled();
  });

  it('Codex PR #322 P2 #3: bloquea el inicio si el usuario no está autenticado', async () => {
    // Re-mock auth.currentUser as null for this scenario.
    const firebaseMod = await import('../services/firebase');
    const originalUser = firebaseMod.auth.currentUser;
    Object.defineProperty(firebaseMod.auth, 'currentUser', {
      value: null,
      writable: true,
      configurable: true,
    });
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = emptyState();
    render(<OfflineInspection />);
    fireEvent.click(screen.getByTestId('offline-inspection-new-btn'));
    fireEvent.click(screen.getByTestId('offline-inspection-new-confirm'));
    await waitFor(() => {
      // An inline error should surface inside the modal.
      expect(
        screen.getByText(/iniciar sesión antes de iniciar una inspección/i),
      ).toBeInTheDocument();
    });
    expect(startInspectionSpy).not.toHaveBeenCalled();
    expect(enqueueInspectionStartSpy).not.toHaveBeenCalled();
    // Restore for other tests.
    Object.defineProperty(firebaseMod.auth, 'currentUser', {
      value: originalUser,
      writable: true,
      configurable: true,
    });
  });

  it('abre el detalle al click sobre una card y permite agregar una observación', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: {
        inspections: [
          inspectionRecord({ id: 'insp_open', observations: [] }),
        ],
      },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    render(<OfflineInspection />);
    fireEvent.click(screen.getByTestId('offline-inspection-card-insp_open'));
    expect(
      screen.getByTestId('offline-inspection-detail-modal'),
    ).toBeInTheDocument();
    // Empty observation guard: clicking save with no input should
    // surface an inline error and NOT call the API.
    fireEvent.click(screen.getByTestId('offline-inspection-detail-save-obs'));
    await waitFor(() => {
      expect(
        screen.getByTestId('offline-inspection-detail-error'),
      ).toBeInTheDocument();
    });
    expect(addObservationSpy).not.toHaveBeenCalled();
    expect(enqueueObservationSpy).not.toHaveBeenCalled();
    // Now fill the notes field and save.
    fireEvent.change(screen.getByTestId('offline-inspection-detail-notes'), {
      target: { value: 'Falta señalética en pasillo norte.' },
    });
    fireEvent.click(screen.getByTestId('offline-inspection-detail-save-obs'));
    await waitFor(() => {
      expect(addObservationSpy).toHaveBeenCalledTimes(1);
    });
    expect(addObservationSpy).toHaveBeenCalledWith(
      'p-1',
      'insp_open',
      expect.objectContaining({
        observationId: 'rid_fixed',
        notes: 'Falta señalética en pasillo norte.',
      }),
    );
    // Codex PR #322 P1 #3 — outbox enqueue runs BEFORE the network call.
    expect(enqueueObservationSpy).toHaveBeenCalledTimes(1);
    expect(enqueueObservationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        observationId: 'rid_fixed',
        inspectionId: 'insp_open',
        projectId: 'p-1',
        notes: 'Falta señalética en pasillo norte.',
      }),
    );
    // …and we mark it synced on success.
    expect(markObservationSyncedSpy).toHaveBeenCalledWith('rid_fixed');
  });

  it('Codex PR #322 P2 #2: re-keys with a fresh id cuando server devuelve 409 observation_id_conflict', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: {
        inspections: [inspectionRecord({ id: 'insp_conflict', observations: [] })],
      },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    // First call rejects with the canonical conflict error, second
    // succeeds — that's what the retry loop expects.
    addObservationSpy
      .mockRejectedValueOnce(new Error('observation_id_conflict'))
      .mockResolvedValueOnce({
        observationId: 'rid_fixed',
        recordedAt: '2026-05-17T10:05:00.000Z',
        recordedBy: 'u_inspector',
      });
    render(<OfflineInspection />);
    fireEvent.click(
      screen.getByTestId('offline-inspection-card-insp_conflict'),
    );
    fireEvent.change(screen.getByTestId('offline-inspection-detail-notes'), {
      target: { value: 'Conflicted obs' },
    });
    fireEvent.click(screen.getByTestId('offline-inspection-detail-save-obs'));
    await waitFor(() => {
      expect(rekeyObservationSpy).toHaveBeenCalledTimes(1);
    });
    expect(rekeyObservationSpy).toHaveBeenCalledWith('rid_fixed', 'rid_fixed');
    await waitFor(() => {
      expect(addObservationSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('Codex PR #322 P2 #4: deshabilita "Cerrar inspección" mientras hay observaciones pending en el outbox', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: {
        inspections: [inspectionRecord({ id: 'insp_busy', observations: [] })],
      },
      loading: false,
      error: null,
      refetch: refetchSpy,
    };
    mockPendingObservations = [
      { observationId: 'obs_pending', inspectionId: 'insp_busy' },
    ];
    render(<OfflineInspection />);
    fireEvent.click(screen.getByTestId('offline-inspection-card-insp_busy'));
    // Wait for the outbox-read effect to populate state.
    await waitFor(() => {
      const btn = screen.getByTestId(
        'offline-inspection-detail-complete',
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
    // The complete API is never called — guard worked.
    fireEvent.click(screen.getByTestId('offline-inspection-detail-complete'));
    expect(completeInspectionSpy).not.toHaveBeenCalled();
    // The "Sincronizando N observaciones…" hint shows the count.
    expect(screen.getByText(/Sincronizando 1 observaciones/i)).toBeInTheDocument();
  });
});
