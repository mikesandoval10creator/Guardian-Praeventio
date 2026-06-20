// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.27 page wrapper smoke test.
//
// Cubre:
//   1. Empty cuando no hay proyectos elegibles (sin snapshots).
//   2. Selector se renderiza con chips por proyecto.
//   3. Mensaje "need more" cuando selección < 2.
//   4. Tabla + ranking + observations cuando hay 2+ seleccionados.
//   5. Tope MAX_PROJECTS_TO_COMPARE.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectsCompare } from './ProjectsCompare';
import type { ProjectSnapshot } from '../services/projectComparator/projectComparator';

// Mock the READ-side snapshots fetch so we can prove REAL data (server-shaped
// ProjectSnapshot[]) flows from the hook into the comparator when NO prop is
// passed — i.e. the production mount path (App.tsx renders <ProjectsCompare/>
// without props).
const mockFetchProjectSnapshots = vi.fn();
vi.mock('../hooks/useMultiProject', () => ({
  fetchProjectSnapshots: (projectId: string) => mockFetchProjectSnapshots(projectId),
}));
vi.mock('../hooks/useProjectComparator', () => ({
  // Force the local pure-engine report to render (no server round-trip in test).
  compareProjectsApi: () => new Promise(() => {}),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
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
      return k;
    },
  }),
}));

interface MockProject { id: string; name: string }

let mockProjects: MockProject[] = [];
let mockIsOnline = true;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ projects: mockProjects, selectedProject: null }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

function snap(id: string, name: string, over: Partial<ProjectSnapshot['metrics']> = {}): ProjectSnapshot {
  return {
    projectId: id,
    projectName: name,
    snapshotAt: '2026-05-17T12:00:00Z',
    metrics: {
      incidentCount: 5,
      openFindingsCount: 12,
      auditCompliancePct: 80,
      criticalRisksCount: 2,
      workersCount: 40,
      correctiveActionsOnTimePct: 75,
      ...over,
    },
  };
}

beforeEach(() => {
  mockProjects = [];
  mockIsOnline = true;
  mockFetchProjectSnapshots.mockReset();
  // Default: no data returned (so prop-driven tests are unaffected — they pass
  // an explicit `snapshots` prop, which short-circuits the fetch entirely).
  mockFetchProjectSnapshots.mockResolvedValue({ snapshots: [] });
});

describe('<ProjectsCompare /> (Fase F.27)', () => {
  it('renderiza empty cuando no hay proyectos elegibles', () => {
    mockProjects = [{ id: 'p1', name: 'Norte' }];
    render(<ProjectsCompare snapshots={{}} />);
    expect(screen.getByTestId('projects-compare-page-empty')).toBeInTheDocument();
  });

  it('renderiza selector con chips por proyecto', () => {
    mockProjects = [
      { id: 'p1', name: 'Norte' },
      { id: 'p2', name: 'Sur' },
    ];
    const snapshots = { p1: snap('p1', 'Norte'), p2: snap('p2', 'Sur') };
    render(<ProjectsCompare snapshots={snapshots} />);
    expect(screen.getByTestId('projects-compare-page')).toBeInTheDocument();
    expect(screen.getByTestId('projects-compare-selector')).toBeInTheDocument();
    expect(screen.getByTestId('projects-compare-toggle-p1')).toBeInTheDocument();
    expect(screen.getByTestId('projects-compare-toggle-p2')).toBeInTheDocument();
    expect(screen.getByTestId('projects-compare-need-more')).toBeInTheDocument();
  });

  it('renderiza tabla + ranking cuando seleccionas 2+ proyectos', () => {
    mockProjects = [
      { id: 'p1', name: 'Norte' },
      { id: 'p2', name: 'Sur' },
    ];
    const snapshots = {
      p1: snap('p1', 'Norte', { incidentCount: 1, auditCompliancePct: 95 }),
      p2: snap('p2', 'Sur', { incidentCount: 10, auditCompliancePct: 40 }),
    };
    render(<ProjectsCompare snapshots={snapshots} />);
    fireEvent.click(screen.getByTestId('projects-compare-toggle-p1'));
    fireEvent.click(screen.getByTestId('projects-compare-toggle-p2'));
    expect(screen.getByTestId('projects-compare-table')).toBeInTheDocument();
    expect(screen.getByTestId('projects-compare-ranking')).toBeInTheDocument();
    expect(screen.getByTestId('projects-compare-observations')).toBeInTheDocument();
    // El ranking debe poner a Norte (mejor en incidents + audit) primero.
    const rank0 = screen.getByTestId('projects-compare-rank-0');
    expect(rank0).toHaveTextContent('Norte');
    // Tabla debe tener una fila por KPI rankeable (5).
    expect(screen.getByTestId('projects-compare-row-incidentCount')).toBeInTheDocument();
    expect(screen.getByTestId('projects-compare-row-auditCompliancePct')).toBeInTheDocument();
    expect(screen.getByTestId('projects-compare-row-correctiveActionsOnTimePct')).toBeInTheDocument();
  });

  it('bloquea selección sobre MAX', () => {
    mockProjects = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Proj ${i}` }));
    const snapshots = mockProjects.reduce<Record<string, ProjectSnapshot>>(
      (acc, p) => ({ ...acc, [p.id]: snap(p.id, p.name) }),
      {},
    );
    render(<ProjectsCompare snapshots={snapshots} />);
    fireEvent.click(screen.getByTestId('projects-compare-toggle-p0'));
    fireEvent.click(screen.getByTestId('projects-compare-toggle-p1'));
    fireEvent.click(screen.getByTestId('projects-compare-toggle-p2'));
    fireEvent.click(screen.getByTestId('projects-compare-toggle-p3'));
    // 4 seleccionados ya — el quinto debe estar deshabilitado.
    const fifth = screen.getByTestId('projects-compare-toggle-p4');
    expect(fifth).toBeDisabled();
  });

  it('toggle deselecciona si se vuelve a clickear', () => {
    mockProjects = [
      { id: 'p1', name: 'Norte' },
      { id: 'p2', name: 'Sur' },
    ];
    const snapshots = { p1: snap('p1', 'Norte'), p2: snap('p2', 'Sur') };
    render(<ProjectsCompare snapshots={snapshots} />);
    const btn = screen.getByTestId('projects-compare-toggle-p1');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('muestra chip offline', () => {
    mockProjects = [{ id: 'p1', name: 'Norte' }];
    const snapshots = { p1: snap('p1', 'Norte') };
    mockIsOnline = false;
    render(<ProjectsCompare snapshots={snapshots} />);
    expect(screen.getByTestId('projects-compare-offline-chip')).toBeInTheDocument();
  });

  // ── REAL data path (no prop): snapshots fetched server-side flow into the
  //    comparator. This is the production mount (App.tsx renders without props)
  //    that DEEP-EX-34 H3 / #1049 fixed — before, the comparator was always
  //    empty because nothing populated `snapshots`.
  it('carga snapshots REALES vía fetchProjectSnapshots cuando no recibe prop', async () => {
    mockProjects = [
      { id: 'p1', name: 'Norte' },
      { id: 'p2', name: 'Sur' },
    ];
    mockFetchProjectSnapshots.mockResolvedValue({
      snapshots: [
        snap('p1', 'Norte', { incidentCount: 1, auditCompliancePct: 95 }),
        snap('p2', 'Sur', { incidentCount: 10, auditCompliancePct: 40 }),
      ],
    });

    render(<ProjectsCompare />); // NO snapshots prop → must fetch

    // The fetch is scoped to the auth "lens" project (first project here).
    await waitFor(() =>
      expect(mockFetchProjectSnapshots).toHaveBeenCalledWith('p1'),
    );

    // Eligible chips appear only once the REAL fetched snapshots arrive.
    await waitFor(() =>
      expect(screen.getByTestId('projects-compare-toggle-p1')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('projects-compare-toggle-p2')).toBeInTheDocument();

    // Select both → the comparator renders over the fetched (real-shaped) data.
    fireEvent.click(screen.getByTestId('projects-compare-toggle-p1'));
    fireEvent.click(screen.getByTestId('projects-compare-toggle-p2'));
    expect(screen.getByTestId('projects-compare-table')).toBeInTheDocument();
    expect(screen.getByTestId('projects-compare-ranking')).toBeInTheDocument();
    // Norte (fewer incidents, higher audit %) must rank first.
    expect(screen.getByTestId('projects-compare-rank-0')).toHaveTextContent('Norte');
  });

  it('no llama fetchProjectSnapshots cuando recibe prop explícito (override)', () => {
    mockProjects = [{ id: 'p1', name: 'Norte' }, { id: 'p2', name: 'Sur' }];
    render(
      <ProjectsCompare snapshots={{ p1: snap('p1', 'Norte'), p2: snap('p2', 'Sur') }} />,
    );
    expect(mockFetchProjectSnapshots).not.toHaveBeenCalled();
  });
});
