// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 restricted-zone editor tests.
//
// Verifies the creation half of the geofence chain: an admin/supervisor draws a
// polygon and the editor POSTs a valid RestrictedZone to the audited
// /api/zones/define route (perimeter in [lng,lat] order, rules wired). Also:
// role-gated UI hint, no-project state, and the "draw first" validation.
//
// The Google Maps components are mocked; the DrawingManager mock exposes a
// button that fires onPolygonComplete with a fake polygon.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RestrictedZonesEditor } from './RestrictedZonesEditor';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        if (opts) {
          let out = fallback;
          for (const [k, v] of Object.entries(opts)) out = out.replace(`{{${k}}}`, String(v));
          return out;
        }
        return fallback;
      }
      return _k;
    },
  }),
}));

const SQUARE = [
  { lat: -33.45, lng: -70.65 },
  { lat: -33.45, lng: -70.64 },
  { lat: -33.46, lng: -70.64 },
  { lat: -33.46, lng: -70.65 },
];

function fakePolygon() {
  return {
    getPath: () => ({
      getLength: () => SQUARE.length,
      getAt: (i: number) => ({ lat: () => SQUARE[i].lat, lng: () => SQUARE[i].lng }),
    }),
    setMap: () => {},
  };
}

vi.mock('@react-google-maps/api', () => ({
  useJsApiLoader: () => ({ isLoaded: true }),
  GoogleMap: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
  Polygon: () => null,
  DrawingManager: ({ onPolygonComplete }: { onPolygonComplete: (p: unknown) => void }) => (
    <button type="button" data-testid="mock-draw" onClick={() => onPolygonComplete(fakePolygon())} />
  ),
}));

vi.mock('../components/maps/mapConfig', () => ({ getMapLoaderConfig: () => ({ id: 'test', googleMapsApiKey: 'k' }) }));

let mockSelectedProject: { id: string } | null = null;
let mockIsAdmin = true;
let mockUserRole = 'admin';
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: mockSelectedProject }) }));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'sup-1' }, isAdmin: mockIsAdmin, userRole: mockUserRole }),
}));

const listRestrictedZonesBySite = vi.fn();
const defineRestrictedZone = vi.fn();
vi.mock('../hooks/useRestrictedZones', () => ({
  listRestrictedZonesBySite: (...a: unknown[]) => listRestrictedZonesBySite(...a),
  defineRestrictedZone: (...a: unknown[]) => defineRestrictedZone(...a),
}));

vi.mock('../utils/randomId', () => ({ randomId: () => 'fixed123' }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectedProject = { id: 'proj-1' };
  mockIsAdmin = true;
  mockUserRole = 'admin';
  listRestrictedZonesBySite.mockResolvedValue({ zones: [] });
  defineRestrictedZone.mockResolvedValue({ success: true, zoneId: 'rz_fixed123' });
});

describe('<RestrictedZonesEditor />', () => {
  it('no project → no-project notice, no map', () => {
    mockSelectedProject = null;
    render(<RestrictedZonesEditor />);
    expect(screen.getByTestId('zoneEditor.noProject')).toBeTruthy();
    expect(screen.queryByTestId('map')).toBeNull();
  });

  it('non-write role → role notice, no editor (server is the canonical gate)', () => {
    mockIsAdmin = false;
    mockUserRole = 'operario';
    render(<RestrictedZonesEditor />);
    expect(screen.getByTestId('zoneEditor.noRole')).toBeTruthy();
    expect(screen.queryByTestId('zoneEditor.save')).toBeNull();
  });

  it('draw polygon + fill name + save → POSTs a valid zone to /api/zones/define', async () => {
    render(<RestrictedZonesEditor />);
    fireEvent.click(screen.getByTestId('mock-draw')); // simulate polygon completion
    fireEvent.change(screen.getByTestId('zoneEditor.name'), { target: { value: 'Estanque ATEX' } });
    fireEvent.change(screen.getByTestId('zoneEditor.kind'), { target: { value: 'atex' } });
    fireEvent.change(screen.getByTestId('zoneEditor.epp'), { target: { value: 'casco, arnés' } });
    fireEvent.click(screen.getByTestId('zoneEditor.save'));

    await waitFor(() => expect(defineRestrictedZone).toHaveBeenCalledOnce());
    const [input, idk] = defineRestrictedZone.mock.calls[0];
    expect(input.projectId).toBe('proj-1');
    expect(input.zone.id).toBe('rz_fixed123');
    expect(idk).toBe('rz_fixed123');
    expect(input.zone.kind).toBe('atex');
    expect(input.zone.name).toBe('Estanque ATEX');
    // perimeter is [lng, lat] in draw order.
    expect(input.zone.perimeter).toEqual([
      [-70.65, -33.45],
      [-70.64, -33.45],
      [-70.64, -33.46],
      [-70.65, -33.46],
    ]);
    expect(input.zone.rules.requiredEpp).toEqual(['casco', 'arnés']);
    expect(input.zone.rules.responsibleUid).toBe('sup-1'); // seeded from current user
    // Success feedback shown.
    await waitFor(() => expect(screen.getByTestId('zoneEditor.feedback').textContent).toMatch(/guardada/i));
  });

  it('save WITHOUT drawing a polygon → perimeter error, no POST', async () => {
    render(<RestrictedZonesEditor />);
    fireEvent.change(screen.getByTestId('zoneEditor.name'), { target: { value: 'Sin polígono' } });
    fireEvent.click(screen.getByTestId('zoneEditor.save'));
    await waitFor(() =>
      expect(screen.getByTestId('zoneEditor.feedback').textContent).toMatch(/perímetro|mapa/i),
    );
    expect(defineRestrictedZone).not.toHaveBeenCalled();
  });

  it('define failure → error feedback surfaced, no crash', async () => {
    defineRestrictedZone.mockRejectedValueOnce(new Error('forbidden_role'));
    render(<RestrictedZonesEditor />);
    fireEvent.click(screen.getByTestId('mock-draw'));
    fireEvent.change(screen.getByTestId('zoneEditor.name'), { target: { value: 'Zona X' } });
    fireEvent.click(screen.getByTestId('zoneEditor.save'));
    await waitFor(() =>
      expect(screen.getByTestId('zoneEditor.feedback').textContent).toMatch(/forbidden_role/),
    );
  });
});
