// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  adaptEntities,
  computeAdapterBounds,
  colorForLayerIndex,
} from './dxfAdapter';

describe('dxfAdapter.adaptEntities', () => {
  it('passes through LINE/CIRCLE/ARC/TEXT and drops unsupported types', () => {
    const out = adaptEntities([
      { type: 'LINE', layer: 'A', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { type: 'CIRCLE', center: { x: 5, y: 5 }, radius: 2, layer: 'B' },
      { type: 'ARC', center: { x: 0, y: 0 }, radius: 1 },
      { type: 'TEXT', position: { x: 1, y: 2 }, text: 'Hi' },
      { type: 'SPLINE' as any },
    ]);
    expect(out.map((e) => e.type)).toEqual(['line', 'circle', 'arc', 'text']);
    expect(out[0].layer).toBe('A');
    expect(out[1].radius).toBe(2);
  });

  it('skips malformed LINE/POLYLINE entities silently', () => {
    const out = adaptEntities([
      { type: 'LINE', vertices: [{ x: 0, y: 0 }] }, // < 2 vertices
      { type: 'LWPOLYLINE' }, // no vertices at all
      { type: 'CIRCLE', center: { x: 0, y: 0 } }, // missing radius
    ]);
    expect(out).toHaveLength(0);
  });

  it('applies layer colors via the index map', () => {
    const out = adaptEntities(
      [{ type: 'LINE', layer: 'X', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
      { X: 1 } // red
    );
    expect(out[0].color).toBe('#ef4444');
  });
});

describe('dxfAdapter.computeAdapterBounds', () => {
  it('handles circles by inflating by radius', () => {
    const b = computeAdapterBounds([
      {
        id: 0,
        type: 'circle',
        layer: '0',
        points: [{ x: 10, y: 10 }],
        radius: 5,
      },
    ]);
    expect(b).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 15 });
  });

  it('returns sane defaults for an empty list', () => {
    expect(computeAdapterBounds([])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });
  });
});

describe('dxfAdapter.colorForLayerIndex', () => {
  it('returns fallback when index is undefined', () => {
    expect(colorForLayerIndex()).toBe('#4db6ac');
  });
  it('returns mapped color for known indices', () => {
    expect(colorForLayerIndex(3)).toBe('#22c55e');
  });
});
