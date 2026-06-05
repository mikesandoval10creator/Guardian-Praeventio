// @vitest-environment jsdom
//
// B1 — DynamicEvacuationMap must compute REAL evacuation routes (A* over the
// Digital Twin footprint) and report honestly, replacing the old Gemini
// narrative + hardcoded floor plan. The route here is computed by the REAL
// planEvacuationRoute (not mocked) over concrete geometry, so these assertions
// exercise the actual pathfinding.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { SiteGeometryFeature, SiteGeometryType } from '../../services/digitalTwin/siteGeometry';

const mockNodes = vi.fn<() => unknown[]>(() => []);
const mockSelectedProject = vi.fn<() => { id: string } | null>(() => ({ id: 'p1' }));
const mockLastLocation = vi.fn<() => { lat: number; lng: number } | null>(() => null);
const mockFeatures = vi.fn<() => SiteGeometryFeature[]>(() => []);

vi.mock('../../contexts/UniversalKnowledgeContext', () => ({
  useUniversalKnowledge: () => ({ nodes: mockNodes() }),
}));
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject() }),
}));
vi.mock('../../hooks/useGeolocationTracking', () => ({
  useGeolocationTracking: () => ({ isTracking: true, lastLocation: mockLastLocation() }),
}));
vi.mock('../../services/firebase', () => ({ auth: { currentUser: { tenantId: null } } }));
vi.mock('../../services/digitalTwin/siteGeometryStore', () => ({
  subscribeSiteGeometry: (
    _t: string,
    _p: string,
    onChange: (f: SiteGeometryFeature[]) => void,
  ) => {
    onChange(mockFeatures());
    return () => {};
  },
}));
vi.mock('./VectorialEvacuationMap', () => ({
  VectorialEvacuationMap: () => React.createElement('div', { 'data-testid': 'vectorial-map' }),
}));
vi.mock('./EvacuationGridMap', () => ({
  EvacuationGridMap: (props: { route: unknown; worker: unknown }) =>
    React.createElement('div', {
      'data-testid': 'grid-map',
      'data-has-route': props.route ? '1' : '0',
      'data-has-worker': props.worker ? '1' : '0',
    }),
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: { children?: React.ReactNode }) =>
    React.createElement('div', rest, children);
  return { motion: new Proxy({}, { get: () => Pass }), AnimatePresence: ({ children }: { children?: React.ReactNode }) => children };
});

import { DynamicEvacuationMap } from './DynamicEvacuationMap';

// ── Concrete twin geometry (equator square, ~111 m/axis) ────────────────────
let idSeq = 0;
function feature(type: SiteGeometryType, ring: [number, number][], label = type): SiteGeometryFeature {
  idSeq += 1;
  const id = `f${idSeq}`;
  const closed: [number, number][] =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : [...ring, ring[0]];
  return {
    type: 'Feature',
    id,
    properties: { id, label, type, heightM: 0 },
    geometry: { type: 'Polygon', coordinates: [closed] },
  };
}
const BOUNDARY = feature('boundary', [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]]);
const EXIT = feature('evacuation', [[0.0008, 0.0008], [0.001, 0.0008], [0.001, 0.001], [0.0008, 0.001]]);
const partialWall = feature('hazard', [[0, 0.0003], [0.0007, 0.0003], [0.0007, 0.0007], [0, 0.0007]]);
const fullWall = feature('hazard', [[0, 0.0003], [0.001, 0.0003], [0.001, 0.0007], [0, 0.0007]]);
const WORKER = { lat: 0.0001, lng: 0.0001 };

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockNodes.mockReturnValue([]);
  mockSelectedProject.mockReturnValue({ id: 'p1' });
  mockLastLocation.mockReturnValue(null);
  mockFeatures.mockReturnValue([]);
});
afterEach(cleanup);

describe('DynamicEvacuationMap — real twin→A* routing (B1)', () => {
  it('shows an honest empty state when the twin has no geometry (no fake floor plan)', () => {
    mockFeatures.mockReturnValue([]);
    render(<DynamicEvacuationMap />);
    expect(screen.getByText(/Aún no has construido el gemelo digital/i)).toBeInTheDocument();
    expect(screen.queryByTestId('grid-map')).not.toBeInTheDocument();
  });

  it('computes a REAL reachable route (grid map + "ruta segura") when geometry+GPS+exit exist', () => {
    mockFeatures.mockReturnValue([BOUNDARY, partialWall, EXIT]);
    mockLastLocation.mockReturnValue(WORKER);
    render(<DynamicEvacuationMap />);
    expect(screen.getByTestId('grid-map')).toHaveAttribute('data-has-route', '1');
    expect(screen.getByText(/Ruta segura encontrada/i)).toBeInTheDocument();
  });

  it('waits for GPS honestly when there is geometry but no worker position', () => {
    mockFeatures.mockReturnValue([BOUNDARY, partialWall, EXIT]);
    mockLastLocation.mockReturnValue(null);
    render(<DynamicEvacuationMap />);
    expect(screen.getByText(/Esperando tu ubicación GPS/i)).toBeInTheDocument();
    expect(screen.getByTestId('grid-map')).toHaveAttribute('data-has-route', '0');
  });

  it('asks the user to define an evacuation zone when none exists', () => {
    mockFeatures.mockReturnValue([BOUNDARY, partialWall]); // no evacuation feature
    mockLastLocation.mockReturnValue(WORKER);
    render(<DynamicEvacuationMap />);
    expect(screen.getByText(/Define una zona de evacuación/i)).toBeInTheDocument();
  });

  it('reports HONESTLY when no route is reachable (exit walled off)', () => {
    mockFeatures.mockReturnValue([BOUNDARY, fullWall, EXIT]);
    mockLastLocation.mockReturnValue(WORKER);
    render(<DynamicEvacuationMap />);
    expect(screen.getByText(/No hay ruta segura alcanzable/i)).toBeInTheDocument();
    expect(screen.getByTestId('grid-map')).toHaveAttribute('data-has-route', '0');
  });

  it('exposes a tap-to-report blocked-area affordance when geometry exists', () => {
    mockFeatures.mockReturnValue([BOUNDARY, partialWall, EXIT]);
    mockLastLocation.mockReturnValue(WORKER);
    render(<DynamicEvacuationMap />);
    expect(screen.getByText(/Toca el mapa para reportar un área bloqueada/i)).toBeInTheDocument();
  });

  it('switches to inertial navigation (dead-reckoning) on toggle — no orphaned feature', () => {
    mockFeatures.mockReturnValue([BOUNDARY, partialWall, EXIT]);
    render(<DynamicEvacuationMap />);
    expect(screen.queryByTestId('vectorial-map')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Mapa del Sitio'));
    expect(screen.getByTestId('vectorial-map')).toBeInTheDocument();
  });
});
