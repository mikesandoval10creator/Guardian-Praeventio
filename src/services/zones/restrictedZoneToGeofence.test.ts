import { describe, it, expect } from 'vitest';
import {
  restrictedZoneToGeofenceZone,
  isZoneActiveNow,
  mapActiveRestrictedZones,
} from './restrictedZoneToGeofence.js';
import type { RestrictedZone } from './restrictedZonesEngine.js';

const NOW = new Date('2026-06-14T12:00:00Z');

function zone(over: Partial<RestrictedZone> = {}): RestrictedZone {
  return {
    id: 'z1',
    kind: 'atex',
    name: 'Zona ATEX',
    perimeter: [
      [-70.65, -33.45],
      [-70.64, -33.45],
      [-70.64, -33.46],
    ],
    rules: { requiredEpp: [], requiredTrainings: [], responsibleUid: 'sup-1' },
    activeFrom: '2026-06-01T00:00:00Z',
    ...over,
  };
}

describe('restrictedZoneToGeofenceZone', () => {
  it('maps id/name and closes the perimeter ring into GeoJSON coordinates', () => {
    const g = restrictedZoneToGeofenceZone(zone());
    expect(g).not.toBeNull();
    expect(g!.id).toBe('z1');
    expect(g!.name).toBe('Zona ATEX');
    expect(g!.type).toBe('HAZMAT');
    // Single outer ring, closed (first === last appended).
    expect(g!.coordinates).toHaveLength(1);
    const ring = g!.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring).toHaveLength(4); // 3 points + closing point
  });

  it('does not double-close an already-closed ring', () => {
    const g = restrictedZoneToGeofenceZone(
      zone({
        perimeter: [
          [-70.65, -33.45],
          [-70.64, -33.45],
          [-70.64, -33.46],
          [-70.65, -33.45],
        ],
      }),
    );
    expect(g!.coordinates[0]).toHaveLength(4);
  });

  it('maps every ZoneKind to a valid geofence severity', () => {
    const expected: Record<string, string> = {
      atex: 'HAZMAT',
      biohazard: 'HAZMAT',
      hot: 'DANGER',
      high_voltage: 'DANGER',
      lifting: 'DANGER',
      heavy_traffic: 'DANGER',
      confined: 'RESTRICTED',
      exclusion: 'RESTRICTED',
    };
    for (const [kind, type] of Object.entries(expected)) {
      const g = restrictedZoneToGeofenceZone(zone({ kind: kind as RestrictedZone['kind'] }));
      expect(g!.type).toBe(type);
    }
  });

  it('returns null when there is no usable perimeter (cannot geofence)', () => {
    expect(restrictedZoneToGeofenceZone(zone({ perimeter: undefined }))).toBeNull();
    expect(restrictedZoneToGeofenceZone(zone({ perimeter: [[-70.65, -33.45]] }))).toBeNull();
  });

  it('returns null for a degenerate already-closed 3-point ring (turf would throw)', () => {
    // first === last → only 2 distinct vertices → closeRing keeps length 3 → < 4
    // positions → cannot form a polygon. The server schema (min(3)) accepts this,
    // so the adapter must reject it rather than feed turf a throwing input that
    // useGeofence silently swallows (zone dropped, no alert).
    expect(
      restrictedZoneToGeofenceZone(
        zone({
          perimeter: [
            [-70.65, -33.45],
            [-70.64, -33.45],
            [-70.65, -33.45],
          ],
        }),
      ),
    ).toBeNull();
    // all-identical points too
    expect(
      restrictedZoneToGeofenceZone(
        zone({
          perimeter: [
            [-70.65, -33.45],
            [-70.65, -33.45],
            [-70.65, -33.45],
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe('isZoneActiveNow', () => {
  it('active within the window', () => {
    expect(isZoneActiveNow(zone(), NOW)).toBe(true);
  });
  it('not-yet-active (activeFrom in the future)', () => {
    expect(isZoneActiveNow(zone({ activeFrom: '2026-07-01T00:00:00Z' }), NOW)).toBe(false);
  });
  it('expired (activeUntil in the past)', () => {
    expect(isZoneActiveNow(zone({ activeUntil: '2026-06-10T00:00:00Z' }), NOW)).toBe(false);
  });
  it('within an explicit window', () => {
    expect(
      isZoneActiveNow(
        zone({ activeFrom: '2026-06-01T00:00:00Z', activeUntil: '2026-06-30T00:00:00Z' }),
        NOW,
      ),
    ).toBe(true);
  });

  // Malformed-date defensive branches (server schema enforces only string
  // length, not date validity). These pin the deliberate fail directions.
  it('fail-CLOSED on an unparseable activeFrom (corrupt start → treated inactive)', () => {
    expect(isZoneActiveNow(zone({ activeFrom: 'not-a-date' }), NOW)).toBe(false);
  });
  it('ignores an unparseable activeUntil (corrupt end → stays active)', () => {
    expect(isZoneActiveNow(zone({ activeFrom: '2020-01-01T00:00:00Z', activeUntil: 'garbage' }), NOW)).toBe(true);
  });
  it('boundary: activeFrom exactly === now is active (>, not >=)', () => {
    expect(isZoneActiveNow(zone({ activeFrom: NOW.toISOString() }), NOW)).toBe(true);
  });
});

describe('mapActiveRestrictedZones', () => {
  it('keeps only active, geofence-able zones', () => {
    const result = mapActiveRestrictedZones(
      [
        zone({ id: 'active-ok' }),
        zone({ id: 'expired', activeUntil: '2026-06-10T00:00:00Z' }),
        zone({ id: 'no-perimeter', perimeter: undefined }),
        zone({ id: 'future', activeFrom: '2026-12-01T00:00:00Z' }),
      ],
      NOW,
    );
    expect(result.map((z) => z.id)).toEqual(['active-ok']);
  });

  it('returns [] for an empty list', () => {
    expect(mapActiveRestrictedZones([], NOW)).toEqual([]);
  });
});
