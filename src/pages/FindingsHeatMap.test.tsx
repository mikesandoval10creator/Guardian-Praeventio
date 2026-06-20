// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.14 page wrapper smoke test.
//
// La página deriva los findings de las INSPECCIONES REALES del proyecto
// (`useInspections` → GET /api/sprint-k/:projectId/inspections). Cada
// observación con `locationLatLng` es un hallazgo georreferenciado. El test
// mockea el hook en la frontera de red (sin fetch/Firestore) y verifica:
//   1. Empty cuando no hay proyecto seleccionado.
//   2. Loading mientras el hook trae datos.
//   3. Error del hook con su mensaje.
//   4. Empty-state honesto cuando el proyecto no tiene observaciones geo.
//   5. Render del canvas (<FindingsHeatmapPreview/> montado) + hotspots
//      cuando hay observaciones georreferenciadas REALES.
//   6. La prop `findings` (override de test) sigue funcionando.
//   7. Offline chip.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FindingsHeatMap } from './FindingsHeatMap';
import type { FindingPoint } from '../services/heatmap/findingsHeatmapBuilder';
import type {
  InspectionRecord,
  InspectionsResponse,
} from '../hooks/useOfflineInspections';

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

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockResp: {
  data: InspectionsResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
let lastHookProjectId: string | null = null;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useOfflineInspections', () => ({
  useInspections: (pid: string | null) => {
    lastHookProjectId = pid;
    return mockResp;
  },
}));

// `recent` se ancla al reloj REAL (Date.now): el componente filtra con
// `new Date()` y ventana de 30 días, así que un fixture con fecha fija
// envejecería fuera de la ventana.
const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

function inspection(over: Partial<InspectionRecord> = {}): InspectionRecord {
  return {
    id: 'insp_1',
    templateId: 'tpl_altura_v1',
    responsibleUid: 'u1',
    status: 'completed',
    startedAt: recent,
    startedBy: 'u1',
    observations: [],
    ...over,
  };
}

function loadedState(inspections: InspectionRecord[]) {
  return {
    data: { inspections },
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockResp = loadedState([]);
  lastHookProjectId = null;
});

describe('<FindingsHeatMap /> (Fase F.14)', () => {
  it('renderiza empty cuando no hay proyecto seleccionado', () => {
    render(<FindingsHeatMap />);
    expect(screen.getByTestId('findings-heatmap-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/Selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = { data: null, loading: true, error: null, refetch: vi.fn() };
    render(<FindingsHeatMap />);
    expect(screen.getByTestId('findings-heatmap-loading')).toBeInTheDocument();
  });

  it('muestra el error del hook con su mensaje', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: vi.fn(),
    };
    render(<FindingsHeatMap />);
    expect(screen.getByTestId('findings-heatmap-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('empty-state honesto cuando el proyecto no tiene observaciones georreferenciadas', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    // Inspección real, pero su observación NO tiene locationLatLng → no es
    // mapeable → empty honesto (no se fabrican puntos).
    mockResp = loadedState([
      inspection({
        observations: [
          { observationId: 'o1', recordedAt: recent, recordedBy: 'u1', notes: 'sin geo' },
        ],
      }),
    ]);
    render(<FindingsHeatMap />);
    expect(screen.getByTestId('findings-heatmap-page')).toBeInTheDocument();
    expect(screen.getByTestId('findings-heatmap-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('findings-heatmap-canvas')).toBeNull();
    // El hook se invocó con el projectId real.
    expect(lastHookProjectId).toBe('p-1');
  });

  it('deriva findings REALES de observaciones georreferenciadas y monta el canvas + hotspots', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = loadedState([
      inspection({
        id: 'insp_geo',
        observations: [
          {
            observationId: 'o1',
            recordedAt: recent,
            recordedBy: 'u1',
            locationLatLng: { lat: -33.45, lng: -70.66 },
          },
          {
            observationId: 'o2',
            recordedAt: recent,
            recordedBy: 'u1',
            locationLatLng: { lat: -33.4500001, lng: -70.6600001 },
          },
          {
            observationId: 'o3',
            recordedAt: recent,
            recordedBy: 'u1',
            locationLatLng: { lat: -33.47, lng: -70.68 },
          },
        ],
      }),
    ]);
    render(<FindingsHeatMap />);
    expect(screen.getByTestId('findings-heatmap-canvas')).toBeInTheDocument();
    // El componente <FindingsHeatmapPreview/> montado renderiza su SVG real.
    expect(screen.getByTestId('findings-heatmap-preview')).toBeInTheDocument();
    expect(screen.getByTestId('heatmap-svg')).toBeInTheDocument();
    // Hotspots de la página (lista propia, con weight).
    expect(screen.getByTestId('findings-heatmap-hotspots')).toBeInTheDocument();
    expect(screen.getByTestId('findings-heatmap-hotspot-0')).toBeInTheDocument();
  });

  it('la prop findings (override de test) cortocircuita el fetch', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const findings: FindingPoint[] = [
      { id: 'a', lat: -33.45, lng: -70.66, severity: 'high', occurredAt: recent, category: 'fall' },
      { id: 'b', lat: -33.46, lng: -70.67, severity: 'low', occurredAt: recent, category: 'order' },
    ];
    render(<FindingsHeatMap findings={findings} />);
    expect(screen.getByTestId('findings-heatmap-canvas')).toBeInTheDocument();
    // Override path: el hook NO recibe el projectId (path null).
    expect(lastHookProjectId).toBeNull();
  });

  it('muestra chip offline', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsOnline = false;
    render(<FindingsHeatMap />);
    expect(screen.getByTestId('findings-heatmap-offline-chip')).toBeInTheDocument();
  });
});
