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
} from '../hooks/useSprintK';

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

vi.mock('../hooks/useSprintK', () => ({
  useInspections: (_pid: string | null, opts?: { status?: string }) => {
    lastHookOpts = opts ?? {};
    return mockResp;
  },
  startInspection: (...args: unknown[]) => startInspectionSpy(...args),
  addObservation: (...args: unknown[]) => addObservationSpy(...args),
  completeInspection: (...args: unknown[]) => completeInspectionSpy(...args),
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
    observationId: 'obs_x',
    recordedAt: '2026-05-17T10:05:00.000Z',
    recordedBy: 'u1',
  });
  completeInspectionSpy.mockReset();
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

  it('abre el modal "Nueva inspección" y llama startInspection con el template y un id generado', async () => {
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
    expect(startInspectionSpy).toHaveBeenCalledWith('p-1', {
      id: 'rid_fixed',
      templateId: 'tpl_altura_v1',
      responsibleUid: 'self',
    });
    // The refetch must run after a successful create so the list
    // reflects the new session immediately.
    expect(refetchSpy).toHaveBeenCalled();
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
  });
});
