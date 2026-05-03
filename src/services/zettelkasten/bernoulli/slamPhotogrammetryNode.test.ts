import { describe, it, expect } from 'vitest';
import { generateSlamMeshNode } from './slamPhotogrammetryNode';

describe('generateSlamMeshNode (placeholder LingBot-Map)', () => {
  it('returns node when keyframes ≥ 30 and coverage ≥ 60%', () => {
    const node = generateSlamMeshNode(
      { id: 'cam-A', keyframeCount: 120, coveragePercent: 85 },
      { id: 'proj-Z' },
    );
    expect(node).not.toBeNull();
    expect(node?.metadata.placeholder).toBe(true);
  });

  it('returns null when capture is too sparse for usable mesh', () => {
    const node = generateSlamMeshNode(
      { id: 'cam-B', keyframeCount: 5, coveragePercent: 90 },
      { id: 'proj-Y' },
    );
    expect(node).toBeNull();
  });
});
