// @vitest-environment jsdom
//
// Praeventio Guard — Cuadrillas dashboard wrapper tests.
//
// Covers the wiring added in feat/bucketd-organic-process: the page now mounts
// <ProcessClosePreviewCard /> in a "XP al cerrar" panel, sourced from
// `useProjectProcesses` (which fetches the canonical GET /api/processes and
// returns the REAL Process[] shape). The card was previously an orphan.
//
// Scenarios:
//   1. No project selected → select-project empty card (no preview panel).
//   2. Project + real open processes from the hook → preview cards rendered.
//   3. Project + zero closable processes → honest empty state in the panel.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CuadrillasDashboard } from './CuadrillasDashboard';
import type { Crew, Process } from '../types/organic';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

let mockSelectedProject: { id: string; name: string; startDate?: string; endDate?: string; status?: string } | null =
  null;
let mockProcesses: Process[] = [];
let mockCrews: Crew[] = [];

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

vi.mock('../hooks/useProjectProcesses', () => ({
  useProjectProcesses: () => ({
    processes: mockProcesses,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

// The page's own client subscription to crews/processes (onSnapshot) — feed
// crews so a crew is auto-selected; the close-preview panel reads the hook.
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  onSnapshot: (_q: unknown, onNext: (snap: unknown) => void) => {
    // First effect = crews, second = processes. Distinguish by a marker we
    // attach on the query object would be brittle; instead emit crews to the
    // first caller and processes to all callers via the captured arrays.
    onNext({
      docs: (CuadrillasDashboardTestState.nextSnapshot ?? []).map((d: { id: string } & Record<string, unknown>) => ({
        id: d.id,
        data: () => {
          const { id: _id, ...rest } = d;
          return rest;
        },
      })),
    });
    return () => {};
  },
}));

// Heavy children mocked at the boundary — we only assert the new preview wiring.
vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('../components/processes/StartProcessModal', () => ({ StartProcessModal: () => null }));
vi.mock('../components/processes/ProcessDetailModal', () => ({ ProcessDetailModal: () => null }));
vi.mock('../components/processes/CloseProcessModal', () => ({ CloseProcessModal: () => null }));
vi.mock('../components/processes/CreateCrewModal', () => ({ CreateCrewModal: () => null }));
vi.mock('../components/projects/GanttProjectView', () => ({ GanttProjectView: () => null }));
vi.mock('../components/etl/CsvImportExportModal', () => ({ CsvImportExportModal: () => null }));

// Shared state to drive the onSnapshot mock per-effect ordering.
const CuadrillasDashboardTestState: { nextSnapshot: Array<{ id: string } & Record<string, unknown>> | null } = {
  nextSnapshot: null,
};

function makeCrew(over: Partial<Crew> = {}): Crew {
  return {
    id: 'c1',
    projectId: 'p1',
    name: 'Cuadrilla A',
    memberUids: ['m1'],
    createdAt: '2026-05-01T00:00:00Z',
    totalProcessesCompleted: 0,
    daysWithoutIncident: 3,
    xp: 120,
    lastIncidentAt: null,
    ...over,
  };
}

function makeProcess(over: Partial<Process> = {}): Process {
  return {
    id: 'pr1',
    crewId: 'c1',
    projectId: 'p1',
    type: 'soldadura',
    name: 'Soldadura vigas torre B',
    description: '',
    startedAt: '2026-05-10T08:00:00Z',
    endedAt: null,
    plannedEndDate: '2026-05-15',
    status: 'active',
    complianceScore: 90,
    incidentsDuringProcess: 0,
    alertsResponded: 4,
    xpAwardedAtClose: null,
    ...over,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockProcesses = [];
  mockCrews = [];
  CuadrillasDashboardTestState.nextSnapshot = null;
});

describe('<CuadrillasDashboard /> close-XP preview wiring', () => {
  it('shows the select-project card when no project is active', () => {
    mockSelectedProject = null;
    render(<CuadrillasDashboard />);
    expect(screen.getByText('Selecciona un proyecto')).toBeInTheDocument();
    expect(screen.queryByTestId('process-close-preview-panel')).not.toBeInTheDocument();
  });

  it('renders a ProcessClosePreviewCard per open process from the server hook', () => {
    mockSelectedProject = { id: 'p1', name: 'Proyecto Torre' };
    mockCrews = [makeCrew()];
    CuadrillasDashboardTestState.nextSnapshot = mockCrews as unknown as Array<
      { id: string } & Record<string, unknown>
    >;
    mockProcesses = [makeProcess(), makeProcess({ id: 'pr2', name: 'Concreto losa', type: 'concreto' })];

    render(<CuadrillasDashboard />);

    expect(screen.getByTestId('process-close-preview-panel')).toBeInTheDocument();
    // soldadura baseXp=130, score=90, alerts=4 → 130*0.9*1.2 = 140 (real engine)
    expect(screen.getByTestId('process-close-preview-pr1')).toBeInTheDocument();
    expect(screen.getByTestId('process-close-final-xp-pr1').textContent).toMatch(/\+140/);
    expect(screen.getByTestId('process-close-preview-pr2')).toBeInTheDocument();
  });

  it('shows an honest empty state when the crew has no closable processes', () => {
    mockSelectedProject = { id: 'p1', name: 'Proyecto Torre' };
    mockCrews = [makeCrew()];
    CuadrillasDashboardTestState.nextSnapshot = mockCrews as unknown as Array<
      { id: string } & Record<string, unknown>
    >;
    // Hook returns a completed process (not closable) → preview panel is empty.
    mockProcesses = [makeProcess({ status: 'completed', endedAt: '2026-05-20T00:00:00Z' })];

    render(<CuadrillasDashboard />);

    expect(screen.getByTestId('process-close-preview-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('process-close-preview-pr1')).not.toBeInTheDocument();
  });
});
