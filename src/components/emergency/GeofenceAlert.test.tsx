// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 GeofenceAlert real-zone wiring test.
//
// Verifies the activation fix: GeofenceAlert fetches the project's REAL zones
// from the audited /api/zones/by-site route and feeds the MAPPED GeofenceZones
// to useGeofenceWithEvents (which drives the geofence→SOS escalation). Before
// this, prod had no real zone source and the escalation was inert.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { GeofenceZone } from '../../hooks/useGeofence';
import type { RestrictedZone } from '../../services/zones/restrictedZonesEngine';

// Capture the zones GeofenceAlert hands to the geofence engine.
const geofenceCalls: GeofenceZone[][] = [];
vi.mock('../../hooks/useGeofenceWithEvents', () => ({
  useGeofenceWithEvents: (zones: GeofenceZone[]) => {
    geofenceCalls.push(zones);
    return { activeZones: [], permissionState: 'granted' as const };
  },
}));

const listRestrictedZonesBySite = vi.fn();
vi.mock('../../hooks/useRestrictedZones', () => ({
  listRestrictedZonesBySite: (...a: unknown[]) => listRestrictedZonesBySite(...a),
}));

let mockSelectedProject: { id: string; settings?: unknown } | null = null;
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'w-1', displayName: 'Worker' } }),
}));
vi.mock('../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ addNotification: vi.fn() }),
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

beforeEach(() => {
  vi.clearAllMocks();
  geofenceCalls.length = 0;
  mockSelectedProject = { id: 'proj-1' };
});

describe('<GeofenceAlert /> real-zone wiring', () => {
  it('fetches the project zones and feeds the MAPPED real zone to the geofence engine', async () => {
    listRestrictedZonesBySite.mockResolvedValueOnce({ zones: [rzone()] });
    render(<GeofenceAlert />);
    expect(listRestrictedZonesBySite).toHaveBeenCalledWith('proj-1');
    await waitFor(() => {
      const last = geofenceCalls[geofenceCalls.length - 1];
      expect(last.some((z) => z.id === 'zone-real')).toBe(true);
    });
    const mapped = geofenceCalls[geofenceCalls.length - 1].find((z) => z.id === 'zone-real')!;
    expect(mapped.type).toBe('HAZMAT'); // atex → HAZMAT
    expect(mapped.coordinates[0][0]).toEqual(mapped.coordinates[0][mapped.coordinates[0].length - 1]);
  });

  it('drops expired zones — no phantom geofence', async () => {
    listRestrictedZonesBySite.mockResolvedValueOnce({
      zones: [rzone({ id: 'expired', activeUntil: '2021-01-01T00:00:00Z' })],
    });
    render(<GeofenceAlert />);
    await waitFor(() => expect(listRestrictedZonesBySite).toHaveBeenCalled());
    // Give the resolved promise a tick to flush.
    await Promise.resolve();
    const last = geofenceCalls[geofenceCalls.length - 1];
    expect(last.some((z) => z.id === 'expired')).toBe(false);
  });

  it('no project → no fetch, geofence gets no real zones', async () => {
    mockSelectedProject = null;
    render(<GeofenceAlert />);
    expect(listRestrictedZonesBySite).not.toHaveBeenCalled();
  });
});
