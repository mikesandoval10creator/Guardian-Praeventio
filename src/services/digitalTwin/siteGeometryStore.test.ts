// OLA 1 (VIDA, 2026-06-14) — regression guard for the site_geometry write
// serialization. savePolygon used to write the ring as a [number,number][]
// (directly-nested array), which Firestore REJECTS ("Nested arrays are not
// supported") — so every digital-twin polygon write silently failed and the A*
// evacuation map never had geometry. The ring is now stored as {lng,lat} maps.
// These tests pin (a) the write produces a Firestore-valid (no nested array)
// record and (b) recordToFeature rehydrates both the new map shape and any
// legacy pair shape back into a closed GeoJSON ring.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const setDocMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../firebase', () => ({
  db: {},
  collection: vi.fn(),
  onSnapshot: vi.fn(),
  doc: vi.fn((_db: unknown, path: string) => ({ path })),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  serverTimestamp: () => '__ts__',
}));

import { savePolygon, recordToFeature, type SitePolygonRecord } from './siteGeometryStore';

const ring: [number, number][] = [
  [-70.66, -33.45],
  [-70.65, -33.45],
  [-70.65, -33.44],
];

function hasNestedArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((el) => Array.isArray(el) || (el != null && typeof el === 'object' && Object.values(el).some(Array.isArray)));
}

describe('siteGeometryStore.savePolygon — Firestore-safe serialization', () => {
  beforeEach(() => setDocMock.mockClear());

  it('writes the ring as {lng,lat} MAPS, never a directly-nested array', async () => {
    await savePolygon('t1', 'p1', { id: 'g1', label: 'Bodega 3', type: 'building', heightM: 4 }, ring);
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const written = setDocMock.mock.calls[0]![1] as SitePolygonRecord;
    // Every coordinate is an {lng,lat} object — not a [lng,lat] pair.
    expect(Array.isArray(written.coordinates)).toBe(true);
    for (const c of written.coordinates) {
      expect(typeof (c as { lng: number }).lng).toBe('number');
      expect(typeof (c as { lat: number }).lat).toBe('number');
      expect(Array.isArray(c)).toBe(false);
    }
    // The whole record must be free of directly-nested arrays (Firestore limit).
    expect(hasNestedArray(written.coordinates)).toBe(false);
  });
});

describe('siteGeometryStore.recordToFeature — rehydration', () => {
  const base = { id: 'g1', label: 'Bodega 3', type: 'building' as const, heightM: 4 };

  it('rehydrates the {lng,lat} map shape into a closed GeoJSON ring', () => {
    const rec: SitePolygonRecord = {
      ...base,
      coordinates: ring.map(([lng, lat]) => ({ lng, lat })),
    };
    const feature = recordToFeature(rec);
    const outer = feature.geometry.coordinates[0];
    expect(outer[0]).toEqual([-70.66, -33.45]);
    // buildFeature closes the ring → first === last.
    expect(outer[outer.length - 1]).toEqual(outer[0]);
  });

  it('tolerates a legacy [lng,lat] pair shape (forward-compat)', () => {
    const rec = { ...base, coordinates: ring } as unknown as SitePolygonRecord;
    const feature = recordToFeature(rec);
    expect(feature.geometry.coordinates[0][0]).toEqual([-70.66, -33.45]);
  });
});
