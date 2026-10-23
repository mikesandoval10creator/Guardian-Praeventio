import { describe, expect, it } from 'vitest';
import { NodeType } from '../../types';
import { buildProjectEdges, filterProjectNodes } from './knowledgeBoundary';

const node = (id: string, projectId: string, connections: string[] = []) => ({
  id,
  projectId,
  type: NodeType.RISK,
  title: id,
  description: '',
  tags: [],
  metadata: {},
  connections,
  createdAt: '',
  updatedAt: '',
});

describe('knowledge graph project boundary', () => {
  it('drops stale or foreign-project documents even when a snapshot contains them', () => {
    const nodes = [node('a', 'project-a'), node('b', 'project-b')];
    expect(filterProjectNodes(nodes, 'project-a').map(({ id }) => id)).toEqual(['a']);
  });

  it('does not expose edges to a foreign or unreadable node', () => {
    const nodes = [node('a', 'project-a', ['b', 'foreign'])];
    expect(buildProjectEdges(nodes)).toEqual([]);
  });

  it('keeps reciprocal in-project edges canonical and deduplicated', () => {
    const nodes = [node('a', 'project-a', ['b']), node('b', 'project-a', ['a'])];
    expect(buildProjectEdges(nodes)).toEqual([{ from: 'a', to: 'b' }]);
  });
});
