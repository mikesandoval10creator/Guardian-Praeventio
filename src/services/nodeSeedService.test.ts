import { beforeEach, describe, expect, it, vi } from 'vitest';
import { risks } from '../data/risks';

const H = vi.hoisted(() => ({
  createGraphNode: vi.fn(async (_node: Record<string, any>, _projectId: string) => 'queued-node'),
  addDoc: vi.fn(async () => ({ id: 'legacy-node' })),
}));

vi.mock('./zettelkasten/graphMutations', () => ({
  createGraphNode: H.createGraphNode,
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  addDoc: H.addDoc,
  serverTimestamp: vi.fn(),
}));
vi.mock('./firebase', () => ({ db: {} }));

import { SEED_COUNT, seedProjectNodes } from './nodeSeedService';

beforeEach(() => {
  H.createGraphNode.mockReset().mockResolvedValue('queued-node');
  H.addDoc.mockReset().mockResolvedValue({ id: 'legacy-node' });
});

describe('seedProjectNodes', () => {
  it('preserves generic risks and Blocks I-VIII by queuing every seed through the tenant-scoped server writer', async () => {
    const seeded = await seedProjectNodes('project-1', 'user-1');

    expect(seeded).toBe(SEED_COUNT);
    expect(SEED_COUNT).toBeGreaterThan(risks.length);
    expect(H.createGraphNode).toHaveBeenCalledTimes(SEED_COUNT);
    expect(H.addDoc).not.toHaveBeenCalled();
    for (const [node, projectId] of H.createGraphNode.mock.calls) {
      expect(projectId).toBe('project-1');
      expect(node.projectId).toBe('project-1');
      expect(node.metadata.createdBy).toBe('user-1');
      expect(node.createdAt).toEqual(expect.any(String));
      expect(node.updatedAt).toEqual(expect.any(String));
    }
  });
});
