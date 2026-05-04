// SPDX-License-Identifier: MIT
// Sprint 17a — DXF entity adapter for the MIT-only CAD viewer stack.
//
// Bridges the loose `DxfEntity` shape produced by `dxf-parser` (MIT) into a
// normalized "drawable" shape the `@mlightcad/three-renderer` (MIT, 0
// transitive deps) can ingest. The adapter is intentionally stateless and
// pure so we can unit-test it without instantiating Three.js.
//
// IMPORTANT — legal/licensing posture (see ADR 0002):
//   • Frontend MUST stay MIT/MPL only. Never import @mlightcad/libredwg-web
//     or @mlightcad/libredwg-converter (GPL-3.0 transitively).
//   • DWG → DXF conversion is server-side only (ODA File Converter, Sprint
//     18). The frontend always receives plain text DXF.

export interface DxfEntity {
  type: string;
  layer?: string;
  vertices?: { x: number; y: number }[];
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
  center?: { x: number; y: number };
  radius?: number;
  position?: { x: number; y: number };
  text?: string;
  // dxf-parser sometimes annotates TEXT/MTEXT with a `height` field.
  height?: number;
}

export type DrawableEntityType =
  | 'line'
  | 'polyline'
  | 'circle'
  | 'arc'
  | 'text';

export interface DrawableEntity {
  id: number;
  type: DrawableEntityType;
  layer: string;
  /** Normalized point sequence; for circles/arcs this is `[center]`. */
  points: { x: number; y: number }[];
  radius?: number;
  text?: string;
  textHeight?: number;
  /** ARGB-style hex color from the layer table. */
  color?: string;
}

export interface AdapterBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const SUPPORTED_TYPES: ReadonlyArray<string> = [
  'LINE',
  'LWPOLYLINE',
  'POLYLINE',
  'CIRCLE',
  'ARC',
  'TEXT',
  'MTEXT',
];

const LAYER_COLORS: Record<number, string> = {
  1: '#ef4444',
  2: '#fbbf24',
  3: '#22c55e',
  4: '#06b6d4',
  5: '#3b82f6',
  6: '#a855f7',
  7: '#e5e7eb',
  8: '#94a3b8',
};

export function colorForLayerIndex(idx?: number, fallback = '#4db6ac'): string {
  if (idx == null) return fallback;
  return LAYER_COLORS[idx] ?? fallback;
}

/**
 * Convert a flat list of `dxf-parser` entities into the renderer-ready
 * `DrawableEntity[]` form. Unsupported entity types are silently dropped
 * (mirrors the previous SVG fallback behavior). The adapter NEVER throws.
 */
export function adaptEntities(
  entities: ReadonlyArray<DxfEntity>,
  layerColors: Record<string, number | undefined> = {}
): DrawableEntity[] {
  const out: DrawableEntity[] = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!SUPPORTED_TYPES.includes(e.type)) continue;
    const layer = e.layer ?? '0';
    const color = colorForLayerIndex(layerColors[layer]);

    switch (e.type) {
      case 'LINE': {
        const v = e.vertices;
        if (!v || v.length < 2) continue;
        out.push({ id: i, type: 'line', layer, points: [v[0], v[1]], color });
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        if (!e.vertices || e.vertices.length < 2) continue;
        out.push({
          id: i,
          type: 'polyline',
          layer,
          points: e.vertices.slice(),
          color,
        });
        break;
      }
      case 'CIRCLE': {
        if (!e.center || e.radius == null) continue;
        out.push({
          id: i,
          type: 'circle',
          layer,
          points: [e.center],
          radius: e.radius,
          color,
        });
        break;
      }
      case 'ARC': {
        if (!e.center || e.radius == null) continue;
        out.push({
          id: i,
          type: 'arc',
          layer,
          points: [e.center],
          radius: e.radius,
          color,
        });
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        if (!e.position) continue;
        out.push({
          id: i,
          type: 'text',
          layer,
          points: [e.position],
          text: e.text ?? '',
          textHeight: e.height,
          color,
        });
        break;
      }
    }
  }
  return out;
}

/**
 * Compute bounding box over the adapted (renderer-ready) entities. Pure
 * function so it can be tested without DOM/Three.js.
 */
export function computeAdapterBounds(items: DrawableEntity[]): AdapterBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const consider = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const e of items) {
    if (e.type === 'circle' || e.type === 'arc') {
      const c = e.points[0];
      const r = e.radius ?? 0;
      consider(c.x - r, c.y - r);
      consider(c.x + r, c.y + r);
    } else {
      for (const p of e.points) consider(p.x, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  return { minX, minY, maxX, maxY };
}
