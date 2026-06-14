import { describe, it, expect } from 'vitest';
import {
  buildRestrictedZoneDraft,
  googlePathToPerimeter,
  parseTokenList,
  ZONE_KINDS,
  type ZoneDraftInput,
} from './zoneDraft.js';

const SQUARE = [
  { lat: -33.45, lng: -70.65 },
  { lat: -33.45, lng: -70.64 },
  { lat: -33.46, lng: -70.64 },
  { lat: -33.46, lng: -70.65 },
];

function input(over: Partial<ZoneDraftInput> = {}): ZoneDraftInput {
  return {
    id: 'zone_1',
    name: 'Estanque ATEX',
    kind: 'atex',
    path: SQUARE,
    requiredEpp: ['casco'],
    requiredTrainings: ['atex-101'],
    requiresPermit: true,
    responsibleUid: 'sup-1',
    activeFrom: '2026-06-14T00:00:00Z',
    ...over,
  };
}

describe('googlePathToPerimeter', () => {
  it('converts {lat,lng} to [lng,lat] tuples (engine/GeoJSON order)', () => {
    expect(googlePathToPerimeter([{ lat: -33.45, lng: -70.65 }])).toEqual([[-70.65, -33.45]]);
  });
  it('drops non-finite vertices', () => {
    expect(
      googlePathToPerimeter([
        { lat: -33.45, lng: -70.65 },
        { lat: Number.NaN, lng: -70.64 },
        { lat: -33.46, lng: Number.POSITIVE_INFINITY },
      ]),
    ).toEqual([[-70.65, -33.45]]);
  });
});

describe('parseTokenList', () => {
  it('splits comma/newline lists, trims, drops empties', () => {
    expect(parseTokenList('casco, arnés\nbotas , , ')).toEqual(['casco', 'arnés', 'botas']);
    expect(parseTokenList('   ')).toEqual([]);
  });
});

describe('buildRestrictedZoneDraft', () => {
  it('builds a valid RestrictedZone from a complete form + polygon', () => {
    const r = buildRestrictedZoneDraft(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.zone.id).toBe('zone_1');
    expect(r.zone.kind).toBe('atex');
    expect(r.zone.perimeter).toEqual([
      [-70.65, -33.45],
      [-70.64, -33.45],
      [-70.64, -33.46],
      [-70.65, -33.46],
    ]);
    expect(r.zone.rules).toEqual({
      requiredEpp: ['casco'],
      requiredTrainings: ['atex-101'],
      requiresPermit: true,
      responsibleUid: 'sup-1',
    });
    expect(r.zone.activeFrom).toBe('2026-06-14T00:00:00Z');
    expect(r.zone.activeUntil).toBeUndefined();
  });

  it('omits requiresPermit when false (matches optional schema field)', () => {
    const r = buildRestrictedZoneDraft(input({ requiresPermit: false }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('requiresPermit' in r.zone.rules).toBe(false);
  });

  it('includes a valid activeUntil window', () => {
    const r = buildRestrictedZoneDraft(input({ activeUntil: '2026-06-20T00:00:00Z' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.zone.activeUntil).toBe('2026-06-20T00:00:00Z');
  });

  it('rejects an empty name', () => {
    expect(buildRestrictedZoneDraft(input({ name: '   ' }))).toEqual({
      ok: false,
      error: 'name_required',
    });
  });

  it('rejects a polygon with < 3 vertices (cannot geofence)', () => {
    expect(
      buildRestrictedZoneDraft(input({ path: [{ lat: -33.45, lng: -70.65 }] })),
    ).toEqual({ ok: false, error: 'perimeter_too_small' });
  });

  it('rejects a missing responsible', () => {
    expect(buildRestrictedZoneDraft(input({ responsibleUid: '' }))).toEqual({
      ok: false,
      error: 'responsible_required',
    });
  });

  it('rejects an unparseable activeFrom', () => {
    expect(buildRestrictedZoneDraft(input({ activeFrom: 'nope' }))).toEqual({
      ok: false,
      error: 'active_from_invalid',
    });
  });

  it('rejects activeUntil before/equal activeFrom', () => {
    expect(
      buildRestrictedZoneDraft(
        input({ activeFrom: '2026-06-14T00:00:00Z', activeUntil: '2026-06-10T00:00:00Z' }),
      ),
    ).toEqual({ ok: false, error: 'active_until_before_from' });
  });

  it('ZONE_KINDS covers the 8 engine kinds', () => {
    expect(ZONE_KINDS).toHaveLength(8);
    expect(new Set(ZONE_KINDS).size).toBe(8);
  });
});
