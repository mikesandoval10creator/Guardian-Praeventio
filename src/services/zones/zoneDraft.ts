// Praeventio Guard — OLA 1: restricted-zone draft builder (pure).
//
// Bridges the map-draw editor (`pages/RestrictedZonesEditor.tsx`) and the
// audited `/api/zones/define` route. Converts a drawn Google Maps polygon path
// + form fields into a validated `RestrictedZone` (the exact shape
// `restrictedZoneSchema` accepts), or an error code the UI can localize.
//
// Deterministic, no I/O, no map/React deps — unit-testable in isolation. The
// caller generates the `id` (so this stays pure) and posts the result.

import type { RestrictedZone, ZoneKind } from './restrictedZonesEngine';

/** All zone kinds the engine understands (mirror of ZoneKind). */
export const ZONE_KINDS: ZoneKind[] = [
  'hot',
  'confined',
  'atex',
  'lifting',
  'heavy_traffic',
  'exclusion',
  'high_voltage',
  'biohazard',
];

export interface ZoneDraftInput {
  id: string;
  name: string;
  kind: ZoneKind;
  /** Polygon vertices as drawn on the map ({lat,lng}). */
  path: Array<{ lat: number; lng: number }>;
  /** EPP labels required to enter (free strings). */
  requiredEpp: string[];
  /** Training codes required to enter. */
  requiredTrainings: string[];
  requiresPermit: boolean;
  responsibleUid: string;
  /** ISO 8601. */
  activeFrom: string;
  /** ISO 8601 (optional). */
  activeUntil?: string;
}

export type ZoneDraftError =
  | 'name_required'
  | 'kind_invalid'
  | 'perimeter_too_small'
  | 'responsible_required'
  | 'active_from_invalid'
  | 'active_until_invalid'
  | 'active_until_before_from';

export type ZoneDraftResult =
  | { ok: true; zone: RestrictedZone }
  | { ok: false; error: ZoneDraftError };

/**
 * Converts a drawn Google Maps polygon path ({lat,lng}) into the engine's
 * perimeter shape ([lng, lat] tuples — matches RestrictedZone.perimeter and the
 * GeoJSON order the geofence layer expects). Drops any non-finite vertex.
 */
export function googlePathToPerimeter(
  path: Array<{ lat: number; lng: number }>,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const p of path) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    out.push([p.lng, p.lat]);
  }
  return out;
}

/** Splits a free-text comma/newline list into trimmed, non-empty tokens. */
export function parseTokenList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Validates the form + drawn polygon and builds a `RestrictedZone` ready to POST
 * to `/api/zones/define`. Returns a localizable error code on the first failure.
 * Mirrors the server `restrictedZoneSchema` constraints so the client fails fast
 * with a clear message instead of relying on a 400.
 */
export function buildRestrictedZoneDraft(input: ZoneDraftInput): ZoneDraftResult {
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, error: 'name_required' };
  if (!ZONE_KINDS.includes(input.kind)) return { ok: false, error: 'kind_invalid' };

  const perimeter = googlePathToPerimeter(input.path);
  if (perimeter.length < 3) return { ok: false, error: 'perimeter_too_small' };

  const responsibleUid = input.responsibleUid.trim();
  if (responsibleUid.length === 0) return { ok: false, error: 'responsible_required' };

  const fromMs = Date.parse(input.activeFrom);
  if (Number.isNaN(fromMs)) return { ok: false, error: 'active_from_invalid' };

  if (input.activeUntil !== undefined && input.activeUntil.trim().length > 0) {
    const untilMs = Date.parse(input.activeUntil);
    if (Number.isNaN(untilMs)) return { ok: false, error: 'active_until_invalid' };
    if (untilMs <= fromMs) return { ok: false, error: 'active_until_before_from' };
  }

  const zone: RestrictedZone = {
    id: input.id,
    kind: input.kind,
    name,
    perimeter,
    rules: {
      requiredEpp: input.requiredEpp.map((s) => s.trim()).filter((s) => s.length > 0),
      requiredTrainings: input.requiredTrainings.map((s) => s.trim()).filter((s) => s.length > 0),
      ...(input.requiresPermit ? { requiresPermit: true } : {}),
      responsibleUid,
    },
    activeFrom: input.activeFrom,
    ...(input.activeUntil && input.activeUntil.trim().length > 0
      ? { activeUntil: input.activeUntil }
      : {}),
  };
  return { ok: true, zone };
}
