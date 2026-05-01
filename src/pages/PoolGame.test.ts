// Round 15 / I4 — Evacuation drill geometry helper.

import { describe, expect, it } from 'vitest';
import { segmentIntersectsObstacles } from './PoolGame';

describe('segmentIntersectsObstacles', () => {
  const wall = { x: 100, y: 100, w: 50, h: 50 };

  it('returns false for a clear segment', () => {
    expect(segmentIntersectsObstacles({ x: 0, y: 0 }, { x: 50, y: 50 }, [wall])).toBe(false);
  });

  it('returns true when a segment crosses the obstacle', () => {
    expect(segmentIntersectsObstacles({ x: 0, y: 125 }, { x: 200, y: 125 }, [wall])).toBe(true);
  });

  it('returns true when an endpoint lies inside the obstacle', () => {
    expect(segmentIntersectsObstacles({ x: 0, y: 0 }, { x: 110, y: 110 }, [wall])).toBe(true);
  });

  it('returns false when the segment skirts the obstacle', () => {
    // strictly above
    expect(segmentIntersectsObstacles({ x: 0, y: 99 }, { x: 200, y: 99 }, [wall])).toBe(false);
  });

  it('handles an empty obstacle list', () => {
    expect(segmentIntersectsObstacles({ x: 0, y: 0 }, { x: 100, y: 100 }, [])).toBe(false);
  });

  it('intersects against any of multiple obstacles', () => {
    const a = { x: 100, y: 100, w: 20, h: 20 };
    const b = { x: 300, y: 300, w: 20, h: 20 };
    expect(segmentIntersectsObstacles({ x: 305, y: 0 }, { x: 305, y: 400 }, [a, b])).toBe(true);
  });
});
