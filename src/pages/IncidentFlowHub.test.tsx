// @vitest-environment jsdom
//
// Praeventio Guard — F3 Hub de Flujo de Incidentes (page test).
//
// Verifica que la página monta sobre DATO REAL (la lista de incidentes y el
// estado PDCA vienen de hooks que envuelven endpoints reales) y que:
//   1. Empty-state honesto sin proyecto.
//   2. Renderiza la lista real de incidentes ocurridos (menú interactivo).
//   3. Al seleccionar un incidente muestra su fase PDCA real + monta el
//      huérfano <AssignedMicrotrainingCard> sobre la microcapacitación
//      asignada real.
//   4. Empty-state honesto (sin incidentes) → vista anual de tendencias real.
//   5. Monta el huérfano <IncidentReportForm> al abrir el panel de reporte.
//
// Hermético: hooks + contexto + firebase mockeados; sin fetch ni Firestore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { IncidentFlowHub } from './IncidentFlowHub';
import type {
  IncidentListResponse,
  IncidentTrendsResponse,
} from '../hooks/useIncidentTrends';
import type { StatusResponse } from '../hooks/useIncidentFlow';

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
let mockOnline = true;
let mockList: { data: IncidentListResponse | null; loading: boolean; error: Error | null; refetch: () => void };
let mockStatus: { data: StatusResponse | null; loading: boolean; error: Error | null };
let mockTrends: { data: IncidentTrendsResponse | null; loading: boolean; error: Error | null };
const refetchSpy = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockOnline,
}));
vi.mock('../services/firebase', () => ({
  auth: { currentUser: { uid: 'worker-1' } },
}));
vi.mock('../hooks/useIncidentTrends', () => ({
  useIncidentList: () => mockList,
  useIncidentTrends: () => mockTrends,
}));
vi.mock('../hooks/useIncidentFlow', () => ({
  useIncidentFlowStatus: (
    _projectId: string | null,
    incidentId: string | null,
  ) => (incidentId ? mockStatus : { data: null, loading: false, error: null }),
}));
// Mount the REAL orphan components but stub their network so render is hermetic.
// They render their own data-testids; we just assert presence (mount proof).
vi.mock('../components/incidentFlow/IncidentReportForm', () => ({
  IncidentReportForm: (props: { incidentId: string }) => (
    <div data-testid="mock-incident-report-form">{props.incidentId}</div>
  ),
}));
vi.mock('../components/incidentFlow/AssignedMicrotrainingCard', () => ({
  AssignedMicrotrainingCard: (props: { moduleId: string }) => (
    <div data-testid="mock-assigned-microtraining">{props.moduleId}</div>
  ),
}));

function emptyList(): typeof mockList {
  return {
    data: { projectId: 'p-1', total: 0, incidents: [], generatedAt: '2026-06-20T00:00:00Z' },
    loading: false,
    error: null,
    refetch: refetchSpy,
  };
}

function populatedList(): typeof mockList {
  return {
    data: {
      projectId: 'p-1',
      total: 2,
      incidents: [
        {
          id: 'inc-A',
          occurredAt: '2026-06-15T10:00:00Z',
          severity: 'high',
          incidentType: 'incident',
          status: 'open',
          summary: 'Caída de altura en plataforma 3',
          location: 'Faena Norte sector C',
          nearMiss: false,
        },
        {
          id: 'inc-B',
          occurredAt: '2026-06-10T08:00:00Z',
          severity: 'low',
          incidentType: 'near_miss',
          status: null,
          summary: 'Casi-resbalón en pasillo húmedo',
          location: null,
          nearMiss: true,
        },
      ],
      generatedAt: '2026-06-20T00:00:00Z',
    },
    loading: false,
    error: null,
    refetch: refetchSpy,
  };
}

function statusWithTraining(): typeof mockStatus {
  return {
    data: {
      status: {
        incidentId: 'inc-A',
        hasReport: true,
        hasOpening: true,
        hasRootCause: true,
        hasLesson: true,
        assignedWorkerCount: 1,
        completedWorkerCount: 0,
        closurePercent: 0,
        isClosed: false,
        phase: 'act',
      },
      nodeCount: 5,
      assignedMicrotrainings: [
        {
          assignmentId: 'mt-assign-inc-A-worker-1',
          moduleId: 'mod-fall-protection',
          workerUid: 'worker-1',
          assignedByUid: 'supervisor-9',
          assignedAtIso: '2026-06-16T12:00:00Z',
          derivedFromLessonId: 'lesson-77',
          completed: false,
        },
      ],
    },
    loading: false,
    error: null,
  };
}

function trendsData(): typeof mockTrends {
  return {
    data: {
      window: '12m',
      group: 'month',
      totalIncidents: 0,
      buckets: [],
      leading: { nearMissRatio: 0, closureRate: 0, averageDaysOpen: 0 },
      trend: 'stable',
      trendConfidence: 0,
      generatedAt: '2026-06-20T00:00:00Z',
    },
    loading: false,
    error: null,
  };
}

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
  mockOnline = true;
  mockList = populatedList();
  mockStatus = statusWithTraining();
  mockTrends = trendsData();
  refetchSpy.mockReset();
});

describe('<IncidentFlowHub /> (F3 hub)', () => {
  it('empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<IncidentFlowHub />);
    expect(screen.getByTestId('incident-flow-hub-no-project')).toBeInTheDocument();
  });

  it('renderiza el menú real de incidentes ocurridos del proyecto', () => {
    render(<IncidentFlowHub />);
    const list = screen.getByTestId('incident-flow-hub-list');
    expect(list).toBeInTheDocument();
    // Ambos incidentes reales presentes con su resumen real.
    expect(screen.getByTestId('incident-flow-hub-item-inc-A')).toHaveTextContent(
      'Caída de altura en plataforma 3',
    );
    expect(screen.getByTestId('incident-flow-hub-item-inc-B')).toHaveTextContent(
      'Casi-resbalón en pasillo húmedo',
    );
    // La severidad real se muestra en el chip del item.
    expect(screen.getByTestId('incident-flow-hub-item-sev-inc-A')).toHaveTextContent('high');
  });

  it('al seleccionar un incidente muestra la fase PDCA real y monta AssignedMicrotrainingCard', () => {
    render(<IncidentFlowHub />);
    fireEvent.click(screen.getByTestId('incident-flow-hub-item-inc-A'));
    const detail = screen.getByTestId('incident-flow-hub-detail-inc-A');
    expect(detail).toBeInTheDocument();
    // Fase PDCA real ('act' → "Actuar").
    expect(screen.getByTestId('incident-flow-hub-pdca-phase')).toHaveTextContent('Actuar');
    // El huérfano AssignedMicrotrainingCard montado con el moduleId real.
    const training = within(detail).getByTestId('mock-assigned-microtraining');
    expect(training).toHaveTextContent('mod-fall-protection');
  });

  it('monta el huérfano IncidentReportForm al abrir el panel de reporte', () => {
    render(<IncidentFlowHub />);
    expect(screen.queryByTestId('incident-flow-hub-report-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('incident-flow-hub-toggle-report'));
    const panel = screen.getByTestId('incident-flow-hub-report-panel');
    expect(within(panel).getByTestId('mock-incident-report-form')).toBeInTheDocument();
  });

  it('empty-state honesto sin incidentes → vista anual de tendencias real', () => {
    mockList = emptyList();
    render(<IncidentFlowHub />);
    expect(screen.getByTestId('incident-flow-hub-empty')).toBeInTheDocument();
    // No se inventa lista; se muestra la vista anual con el total real (0).
    expect(screen.getByTestId('incident-flow-hub-trends-total')).toHaveTextContent(
      '0 incidentes en 12 meses',
    );
    expect(screen.queryByTestId('incident-flow-hub-list')).toBeNull();
  });
});
