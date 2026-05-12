import { describe, it, expect } from 'vitest';
import {
  findRootBranches,
  summarizeTree,
  compareTrees,
  detectFailedControlPatterns,
  type RootCauseTree,
} from './researchMode.js';

function node(over: { id: string; parentId?: string; isRoot?: boolean; failedControlId?: string; category?: 'people' | 'process' | 'equipment' | 'environment' | 'management' }) {
  return {
    id: over.id,
    text: `texto ${over.id}`,
    category: over.category ?? 'process',
    isRoot: over.isRoot ?? false,
    parentId: over.parentId,
    failedControlId: over.failedControlId,
    proposedByUid: 'u1',
  } as const;
}

describe('findRootBranches', () => {
  it('reconstruye el camino completo desde raíz', () => {
    const tree: RootCauseTree = {
      incidentId: 'inc1',
      nodes: [
        node({ id: 'L1' }),
        node({ id: 'L2', parentId: 'L1' }),
        node({ id: 'L3', parentId: 'L2', isRoot: true, failedControlId: 'c1' }),
      ],
    };
    const branches = findRootBranches(tree);
    expect(branches).toHaveLength(1);
    expect(branches[0].path.map((n) => n.id)).toEqual(['L1', 'L2', 'L3']);
    expect(branches[0].hasFailedControl).toBe(true);
  });
});

describe('summarizeTree', () => {
  it('cuenta por categoría + raíces + control fallidos', () => {
    const tree: RootCauseTree = {
      incidentId: 'inc1',
      nodes: [
        node({ id: 'a', category: 'people' }),
        node({ id: 'b', category: 'process', isRoot: true, failedControlId: 'c1' }),
        node({ id: 'c', category: 'process', isRoot: true, failedControlId: 'c1' }),
      ],
    };
    const s = summarizeTree(tree);
    expect(s.totalNodes).toBe(3);
    expect(s.rootCount).toBe(2);
    expect(s.byCategory.process).toBe(2);
    expect(s.failedControlsIdentified).toEqual(['c1']);
  });
});

describe('compareTrees', () => {
  it('detecta similitud por categorías y controles compartidos', () => {
    const primary: RootCauseTree = {
      incidentId: 'p',
      nodes: [
        node({ id: 'a', category: 'people', isRoot: true, failedControlId: 'c1' }),
        node({ id: 'b', category: 'process', isRoot: true, failedControlId: 'c2' }),
      ],
    };
    const similar: RootCauseTree = {
      incidentId: 'o',
      nodes: [
        node({ id: 'x', category: 'people', isRoot: true, failedControlId: 'c1' }),
      ],
    };
    const different: RootCauseTree = {
      incidentId: 'd',
      nodes: [node({ id: 'y', category: 'environment', isRoot: true })],
    };
    const r = compareTrees(primary, [similar, different]);
    expect(r[0].otherIncidentId).toBe('o'); // similar primero
    expect(r[0].score).toBeGreaterThan(0);
    expect(r[0].matchingFailedControls).toEqual(['c1']);
  });
});

describe('detectFailedControlPatterns', () => {
  it('agrupa controles fallidos por frecuencia', () => {
    const trees = [
      { incidentId: 'i1', nodes: [node({ id: 'a', failedControlId: 'c1' })] },
      { incidentId: 'i2', nodes: [node({ id: 'b', failedControlId: 'c1' })] },
      { incidentId: 'i3', nodes: [node({ id: 'c', failedControlId: 'c2' })] },
    ];
    const r = detectFailedControlPatterns(trees);
    expect(r[0].controlId).toBe('c1');
    expect(r[0].failureCount).toBe(2);
    expect(r[0].frequencyPercent).toBe(67);
    expect(r[0].severity).toBe('critical');
  });
});
