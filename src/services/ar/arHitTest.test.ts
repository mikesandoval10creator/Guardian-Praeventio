import { describe, it, expect } from 'vitest';
import {
  classifySurface,
  updateReticleSnapshot,
  canPlaceAnchor,
  isMarkerKindValidForSurface,
  availableMarkerKinds,
  MIN_STABILITY_FRAMES,
  type Pose,
  type ReticleSnapshot,
} from './arHitTest.js';

// Identity quaternion (no rotation) → up = (0,1,0) → floor
const idQ = { x: 0, y: 0, z: 0, w: 1 };

function pose(x: number, y: number, z: number, q = idQ): Pose {
  return { position: { x, y, z }, orientation: q };
}

// Quaternion para rotar 90° sobre Z → up apunta a +X
// sin(45°) ≈ 0.7071
const rot90Z = { x: 0, y: 0, z: 0.7071, w: 0.7071 };
// Quaternion para flip 180° sobre X → up apunta a -Y (ceiling)
const flip180X = { x: 1, y: 0, z: 0, w: 0 };

describe('classifySurface', () => {
  it('identity (up=+Y): floor', () => {
    expect(classifySurface(pose(0, 0, 0))).toBe('floor');
  });

  it('rotación 90° en Z (up=+X): wall', () => {
    expect(classifySurface(pose(0, 0, 0, rot90Z))).toBe('wall');
  });

  it('flip 180° en X (up=-Y): ceiling', () => {
    expect(classifySurface(pose(0, 0, 0, flip180X))).toBe('ceiling');
  });

  it('inclinación moderada: sloped', () => {
    // 30° de tilt — up.y ≈ 0.5 (entre 0.3 y 0.95)
    const tiltQ = { x: 0.2588, y: 0, z: 0, w: 0.9659 }; // 30° rot X
    expect(classifySurface(pose(0, 0, 0, tiltQ))).toBe('sloped');
  });
});

// ────────────────────────────────────────────────────────────────────────
// updateReticleSnapshot — stability accumulator
// ────────────────────────────────────────────────────────────────────────

describe('updateReticleSnapshot', () => {
  it('primer hit con pose null: stability=0', () => {
    const s = updateReticleSnapshot(null, null, 1000);
    expect(s.pose).toBeNull();
    expect(s.stabilityFrames).toBe(0);
  });

  it('primer hit con pose válida: stability=1', () => {
    const s = updateReticleSnapshot(null, pose(0, 0, -1), 1000);
    expect(s.pose).not.toBeNull();
    expect(s.stabilityFrames).toBe(1);
    expect(s.surfaceKind).toBe('floor');
  });

  it('hits sucesivos cerca: stability incrementa', () => {
    let s: ReticleSnapshot | null = null;
    for (let i = 0; i < 8; i++) {
      // Variaciones de <1cm — bajo el umbral de jitter
      s = updateReticleSnapshot(
        s,
        pose(0.001 * i, 0, -1 + 0.001 * i),
        1000 + i * 16,
      );
    }
    expect(s!.stabilityFrames).toBe(8);
  });

  it('hit que salta >5cm: stability se resetea a 1', () => {
    let s = updateReticleSnapshot(null, pose(0, 0, -1), 1000);
    s = updateReticleSnapshot(s, pose(0.01, 0, -1), 1016);
    expect(s.stabilityFrames).toBe(2);
    // Salto brusco
    s = updateReticleSnapshot(s, pose(1, 0, -1), 1032);
    expect(s.stabilityFrames).toBe(1);
  });

  it('cambio de surfaceKind resetea stability', () => {
    let s = updateReticleSnapshot(null, pose(0, 0, -1), 1000); // floor
    s = updateReticleSnapshot(s, pose(0.01, 0, -1), 1016);
    expect(s.stabilityFrames).toBe(2);
    // Mismo lugar pero ahora orientation = wall
    s = updateReticleSnapshot(s, pose(0.01, 0, -1, rot90Z), 1032);
    expect(s.surfaceKind).toBe('wall');
    expect(s.stabilityFrames).toBe(1);
  });

  it('hit perdido en medio: stability=0 y pose=null', () => {
    let s = updateReticleSnapshot(null, pose(0, 0, -1), 1000);
    s = updateReticleSnapshot(s, pose(0, 0, -1), 1016);
    s = updateReticleSnapshot(s, null, 1032);
    expect(s.pose).toBeNull();
    expect(s.stabilityFrames).toBe(0);
  });

  it('EMA smoothing: pose final es promedio ponderado del último frame', () => {
    let s = updateReticleSnapshot(null, pose(0, 0, 0), 1000);
    // Próximo frame: posición (1,0,0) con alpha=0.7 → 0.3*1 = 0.3
    s = updateReticleSnapshot(s, pose(0.04, 0, 0), 1016); // dentro de jitter
    expect(s.pose!.position.x).toBeCloseTo(0.3 * 0.04, 5);
  });
});

// ────────────────────────────────────────────────────────────────────────
// canPlaceAnchor
// ────────────────────────────────────────────────────────────────────────

describe('canPlaceAnchor', () => {
  it('null snapshot: false', () => {
    expect(canPlaceAnchor(null)).toBe(false);
  });

  it('snapshot con stability < MIN: false', () => {
    let s = updateReticleSnapshot(null, pose(0, 0, -1), 1000);
    for (let i = 0; i < MIN_STABILITY_FRAMES - 2; i++) {
      s = updateReticleSnapshot(s, pose(0, 0, -1), 1016 + i * 16);
    }
    expect(canPlaceAnchor(s)).toBe(false);
  });

  it('snapshot con stability >= MIN: true', () => {
    let s = updateReticleSnapshot(null, pose(0, 0, -1), 1000);
    for (let i = 0; i < MIN_STABILITY_FRAMES + 2; i++) {
      s = updateReticleSnapshot(s, pose(0, 0, -1), 1016 + i * 16);
    }
    expect(canPlaceAnchor(s)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// isMarkerKindValidForSurface
// ────────────────────────────────────────────────────────────────────────

describe('isMarkerKindValidForSurface', () => {
  it('evacuation_route solo en floor/sloped', () => {
    expect(isMarkerKindValidForSurface('evacuation_route', 'floor')).toBe(true);
    expect(isMarkerKindValidForSurface('evacuation_route', 'sloped')).toBe(true);
    expect(isMarkerKindValidForSurface('evacuation_route', 'wall')).toBe(false);
    expect(isMarkerKindValidForSurface('evacuation_route', 'ceiling')).toBe(false);
  });

  it('extinguisher solo en wall', () => {
    expect(isMarkerKindValidForSurface('extinguisher', 'wall')).toBe(true);
    expect(isMarkerKindValidForSurface('extinguisher', 'floor')).toBe(false);
  });

  it('hazard_label permitido en floor/wall/sloped, no ceiling', () => {
    expect(isMarkerKindValidForSurface('hazard_label', 'floor')).toBe(true);
    expect(isMarkerKindValidForSurface('hazard_label', 'wall')).toBe(true);
    expect(isMarkerKindValidForSurface('hazard_label', 'sloped')).toBe(true);
    expect(isMarkerKindValidForSurface('hazard_label', 'ceiling')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// availableMarkerKinds
// ────────────────────────────────────────────────────────────────────────

describe('availableMarkerKinds', () => {
  it('reticle inestable: lista vacía (menu deshabilitado)', () => {
    const s = updateReticleSnapshot(null, pose(0, 0, -1), 1000);
    expect(availableMarkerKinds(s)).toEqual([]);
  });

  it('reticle estable sobre floor: incluye evacuation_route, excluye extinguisher', () => {
    let s = updateReticleSnapshot(null, pose(0, 0, -1), 1000);
    for (let i = 0; i < MIN_STABILITY_FRAMES + 1; i++) {
      s = updateReticleSnapshot(s, pose(0, 0, -1), 1016 + i * 16);
    }
    const kinds = availableMarkerKinds(s);
    expect(kinds).toContain('evacuation_route');
    expect(kinds).toContain('assembly_point');
    expect(kinds).not.toContain('extinguisher');
  });

  it('reticle estable sobre wall: incluye extinguisher, excluye evacuation_route', () => {
    let s = updateReticleSnapshot(null, pose(0, 0, -1, rot90Z), 1000);
    for (let i = 0; i < MIN_STABILITY_FRAMES + 1; i++) {
      s = updateReticleSnapshot(s, pose(0, 0, -1, rot90Z), 1016 + i * 16);
    }
    const kinds = availableMarkerKinds(s);
    expect(kinds).toContain('extinguisher');
    expect(kinds).toContain('first_aid');
    expect(kinds).not.toContain('evacuation_route');
  });
});
