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
  zoneViolationWrites: [] as Array<{ path: string; id: string | null; payload: unknown }>,
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
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('firebase/firestore');
  // The tests pin a deterministic, in-memory record showing the EFFECTIVE
  // state of the `zone_violations` collection after every setDoc call.
  // setDoc with a deterministic id and merge:true is idempotent at the
  // Firestore level — the mock mirrors that so the duplicate-detection
  // probes assert real observable behaviour, not just the write call count.
  return {
    ...actual,
    collection: vi.fn((_db: unknown, path: string) => ({ __path: path })),
    doc: vi.fn((_db: unknown, ...parts: string[]) => ({ __id: parts.join('/') })),
    addDoc: vi.fn(async (_ref: { __path: string }, payload: unknown) => {
      // addDoc is the random-id path — keep a separate audit trail for it.
      const id = `auto-${H.zoneViolationWrites.length + 1}`;
      H.zoneViolationWrites.push({ path: _ref.__path, id, payload });
      return { id };
    }),
    setDoc: vi.fn(async (ref: { __id: string }, payload: unknown) => {
      // Idempotent: replace any existing entry with the same id.
      const existingIdx = H.zoneViolationWrites.findIndex(
        (w) => w.id === ref.__id,
      );
      if (existingIdx >= 0) {
        H.zoneViolationWrites[existingIdx] = {
          path: ref.__id,
          id: ref.__id,
          payload,
        };
      } else {
        H.zoneViolationWrites.push({ path: ref.__id, id: ref.__id, payload });
      }
    }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  };
});
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.geofenceCalls.length = 0;
  H.zoneViolationWrites.length = 0;
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

  it('switching projects ignores a late p1 response while p2 is still loading', async () => {
    const p1 = deferred<{ zones: ReturnType<typeof rzone>[] }>();
    const p2 = deferred<{ zones: ReturnType<typeof rzone>[] }>();
    H.listRestrictedZonesBySite.mockImplementation((projectId: string) =>
      projectId === 'proj-1' ? p1.promise : p2.promise,
    );

    const view = render(<GeofenceAlert />);
    expect(H.listRestrictedZonesBySite).toHaveBeenCalledWith('proj-1');

    mockSelectedProject = { id: 'proj-2' };
    view.rerender(<GeofenceAlert />);
    expect(H.listRestrictedZonesBySite).toHaveBeenCalledWith('proj-2');
    expect(lastCall().zones.some((z) => z.id === 'p1-zone')).toBe(false);

    p1.resolve({ zones: [rzone({ id: 'p1-zone' })] });
    await Promise.resolve();
    expect(lastCall().zones.some((z) => z.id === 'p1-zone')).toBe(false);

    p2.resolve({ zones: [rzone({ id: 'p2-zone' })] });
    await waitFor(() => {
      expect(lastCall().zones.some((z) => z.id === 'p2-zone')).toBe(true);
    });
    expect(lastCall().zones.some((z) => z.id === 'p1-zone')).toBe(false);
  });

  it('project switch with p2 fetch failure never retains p1 zones', async () => {
    H.listRestrictedZonesBySite.mockResolvedValueOnce({
      zones: [rzone({ id: 'p1-zone' })],
    });
    const view = render(<GeofenceAlert />);
    await waitFor(() => {
      expect(lastCall().zones.some((z) => z.id === 'p1-zone')).toBe(true);
    });

    H.listRestrictedZonesBySite.mockRejectedValueOnce(new Error('http_403'));
    mockSelectedProject = { id: 'proj-2' };
    view.rerender(<GeofenceAlert />);

    await waitFor(() =>
      expect(H.addNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      ),
    );
    expect(lastCall().zones.some((z) => z.id === 'p1-zone')).toBe(false);
  });

  it('no project → no fetch', async () => {
    mockSelectedProject = null;
    render(<GeofenceAlert />);
    expect(H.listRestrictedZonesBySite).not.toHaveBeenCalled();
  });

  // [Hy3-audit] Idempotencia de violación Firestore — duplicate-detection
  // probe. GPS fluctuations can trigger `onZoneEntry` multiple times for the
  // same physical crossing (within the same 5-second bucket). Without a
  // deterministic doc id, addDoc() generates a fresh random id per call and
  // the audit log fills with duplicate rows. The fix MUST coalesce calls
  // inside the same bucket into a single setDoc with a stable composite id.
  it('coalesces repeated handleZoneEntry calls within the same 5s bucket into ONE Firestore write', async () => {
    H.listRestrictedZonesBySite.mockResolvedValueOnce({
      zones: [rzone({ id: 'zone-A' })],
    });
    render(<GeofenceAlert />);
    await waitFor(() => expect(typeof lastCall().onZoneEntry).toBe('function'));

    const entered = [
      { id: 'zone-A', name: 'Zone A', type: 'HAZMAT' as const, coordinates: [] },
    ];
    // Same zone, same physical crossing, fired 3× in a row (GPS bounce).
    await lastCall().onZoneEntry!(entered);
    await lastCall().onZoneEntry!(entered);
    await lastCall().onZoneEntry!(entered);
    // Wait for the .catch()-suppressed async writes to settle.
    await new Promise((r) => setTimeout(r, 0));

    const zoneWrites = H.zoneViolationWrites.filter((w) =>
      w.path.includes('zone_violations'),
    );
    if (zoneWrites.length !== 1) {
      throw new Error(
        `Expected exactly 1 zone_violations write for 3 repeated entry events in the same ` +
          `5-second bucket, got ${zoneWrites.length}: ${JSON.stringify(zoneWrites)}. ` +
          `The fix must use a deterministic composite id (workerId:zoneId:floor(ts/5000)) ` +
          `so duplicate physical crossings collapse into a single Firestore row.`,
      );
    }
    expect(zoneWrites).toHaveLength(1);
    expect(zoneWrites[0].id).toMatch(/zone-A/);
  });

  it('emits separate writes when the bucket CHANGES (different physical crossings)', async () => {
    H.listRestrictedZonesBySite.mockResolvedValueOnce({
      zones: [rzone({ id: 'zone-A' })],
    });
    render(<GeofenceAlert />);
    await waitFor(() => expect(typeof lastCall().onZoneEntry).toBe('function'));

    const entered = [
      { id: 'zone-A', name: 'Zone A', type: 'HAZMAT' as const, coordinates: [] },
    ];
    // First crossing
    await lastCall().onZoneEntry!(entered);
    await new Promise((r) => setTimeout(r, 0));
    // Advance the wall clock by 6s so the next call lands in a fresh bucket.
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 6000;
    try {
      await lastCall().onZoneEntry!(entered);
    } finally {
      Date.now = realDateNow;
    }
    await new Promise((r) => setTimeout(r, 0));

    const zoneWrites = H.zoneViolationWrites.filter((w) =>
      w.path.includes('zone_violations'),
    );
    expect(zoneWrites).toHaveLength(2);
  });

  it('coalesces per-zone when multiple zones cross simultaneously', async () => {
    H.listRestrictedZonesBySite.mockResolvedValueOnce({
      zones: [
        rzone({ id: 'zone-A' }),
        rzone({ id: 'zone-B' }),
      ],
    });
    render(<GeofenceAlert />);
    await waitFor(() => expect(typeof lastCall().onZoneEntry).toBe('function'));

    const twoZones = [
      { id: 'zone-A', name: 'A', type: 'HAZMAT' as const, coordinates: [] },
      { id: 'zone-B', name: 'B', type: 'RESTRICTED' as const, coordinates: [] },
    ];
    // Same event twice (simulating a re-emit), should still be 2 docs
    // (one per zone), not 4.
    await lastCall().onZoneEntry!(twoZones);
    await lastCall().onZoneEntry!(twoZones);
    await new Promise((r) => setTimeout(r, 0));

    const zoneWrites = H.zoneViolationWrites.filter((w) =>
      w.path.includes('zone_violations'),
    );
    expect(zoneWrites).toHaveLength(2);
    const ids = zoneWrites.map((w) => w.id).sort();
    expect(ids[0]).toMatch(/zone-A/);
    expect(ids[1]).toMatch(/zone-B/);
  });
});
