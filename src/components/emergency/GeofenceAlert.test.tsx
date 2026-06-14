// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 GeofenceAlert real-zone wiring test.
//
// Verifies the activation fix: GeofenceAlert fetches the project's REAL zones
// from the audited /api/zones/by-site route and feeds the MAPPED GeofenceZones
// — plus the correct escalation context (projectId/workerId) and entry handler —
// to useGeofenceWithEvents (which drives the geofence→SOS escalation). Also
// covers the fail-loud degraded path on fetch failure. Before this PR, prod had
// no real zone source and the escalation was inert.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { GeofenceZone } from '../../hooks/useGeofence';
import type { RestrictedZone } from '../../services/zones/restrictedZonesEngine';

interface GeofenceCall {
  zones: GeofenceZone[];
  opts: { tenantId: string; projectId: string; workerId: string };
  onZoneEntry: ((zones: GeofenceZone[]) => void) | undefined;
}

const H = vi.hoisted(() => ({
  geofenceCalls: [] as GeofenceCall[],
  listRestrictedZonesBySite: vi.fn(),
  addNotification: vi.fn(),
}));

// Capture the FULL hook call: zones (arg1) + escalation opts (arg2) + the entry
// handler (arg3). A regression that wires an empty projectId/workerId or drops
// the handler would otherwise ship green.
vi.mock('../../hooks/useGeofenceWithEvents', () => ({
  useGeofenceWithEvents: (
    zones: GeofenceZone[],
    opts: GeofenceCall['opts'],
    onZoneEntry: GeofenceCall['onZoneEntry'],
  ) => {
    H.geofenceCalls.push({ zones, opts, onZoneEntry });
    return { activeZones: [], permissionState: 'granted' as const };
  },
}));

vi.mock('../../hooks/useRestrictedZones', () => ({
  listRestrictedZonesBySite: (...a: unknown[]) => H.listRestrictedZonesBySite(...a),
}));

let mockSelectedProject: { id: string; settings?: unknown } | null = null;
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'w-1', displayName: 'Worker' } }),
}));
vi.mock('../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ addNotification: H.addNotification }),
}));
vi.mock('../../services/firebase', () => ({
  db: {},
  serverTimestamp: () => 'ts',
  auth: { currentUser: { tenantId: 'tenant-1' } },
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  addDoc: vi.fn().mockResolvedValue({ id: 'x' }),
}));
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// Minimal framer-motion stub: render children, drop animation props.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children }: { children?: React.ReactNode }) =>
          children ?? null,
    },
  ),
}));

import { GeofenceAlert } from './GeofenceAlert';

function rzone(over: Partial<RestrictedZone> = {}): RestrictedZone {
  return {
    id: 'zone-real',
    kind: 'atex',
    name: 'Estanque ATEX',
    perimeter: [
      [-70.65, -33.45],
      [-70.64, -33.45],
      [-70.64, -33.46],
    ],
    rules: { requiredEpp: [], requiredTrainings: [], responsibleUid: 'sup' },
    activeFrom: '2020-01-01T00:00:00Z',
    ...over,
  };
}

const lastCall = () => H.geofenceCalls[H.geofenceCalls.length - 1];

beforeEach(() => {
  vi.clearAllMocks();
  H.geofenceCalls.length = 0;
  mockSelectedProject = { id: 'proj-1' };
});

describe('<GeofenceAlert /> real-zone wiring', () => {
  it('feeds the MAPPED real zone AND the correct escalation context to the engine', async () => {
    H.listRestrictedZonesBySite.mockResolvedValueOnce({ zones: [rzone()] });
    render(<GeofenceAlert />);
    expect(H.listRestrictedZonesBySite).toHaveBeenCalledWith('proj-1');
    await waitFor(() => {
      expect(lastCall().zones.some((z) => z.id === 'zone-real')).toBe(true);
    });
    const mapped = lastCall().zones.find((z) => z.id === 'zone-real')!;
    expect(mapped.type).toBe('HAZMAT'); // atex → HAZMAT
    expect(mapped.coordinates[0][0]).toEqual(
      mapped.coordinates[0][mapped.coordinates[0].length - 1],
    );
    // Escalation context must carry real identity (geofence→SOS routes by these).
    expect(lastCall().opts.projectId).toBe('proj-1');
    expect(lastCall().opts.workerId).toBe('w-1');
    expect(lastCall().opts.tenantId).toBe('tenant-1');
    expect(typeof lastCall().onZoneEntry).toBe('function');
  });

  it('drops expired zones — no phantom geofence', async () => {
    H.listRestrictedZonesBySite.mockResolvedValueOnce({
      zones: [rzone({ id: 'expired', activeUntil: '2021-01-01T00:00:00Z' })],
    });
    render(<GeofenceAlert />);
    await waitFor(() => expect(H.listRestrictedZonesBySite).toHaveBeenCalled());
    await Promise.resolve();
    expect(lastCall().zones.some((z) => z.id === 'expired')).toBe(false);
  });

  it('fetch FAILURE → worker is told (degraded banner) and the real zone is NOT silently present', async () => {
    H.listRestrictedZonesBySite.mockRejectedValueOnce(new Error('http_403'));
    render(<GeofenceAlert />);
    await waitFor(() =>
      expect(H.addNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      ),
    );
    // The error notification is the zone-load one (not the permission one).
    const calledWithZoneError = H.addNotification.mock.calls.some(
      (c) => typeof c[0]?.title === 'string' && /zonas restringidas/i.test(c[0].title),
    );
    expect(calledWithZoneError).toBe(true);
    // The real zone never loaded → not handed to the engine.
    expect(lastCall().zones.some((z) => z.id === 'zone-real')).toBe(false);
  });

  it('null-guard: server returns no zones field → no crash, no real zones', async () => {
    H.listRestrictedZonesBySite.mockResolvedValueOnce({});
    render(<GeofenceAlert />);
    await waitFor(() => expect(H.listRestrictedZonesBySite).toHaveBeenCalled());
    await Promise.resolve();
    expect(lastCall().zones.some((z) => z.id === 'zone-real')).toBe(false);
    expect(H.addNotification).not.toHaveBeenCalled(); // empty != error
  });

  it('no project → no fetch', async () => {
    mockSelectedProject = null;
    render(<GeofenceAlert />);
    expect(H.listRestrictedZonesBySite).not.toHaveBeenCalled();
  });
});
