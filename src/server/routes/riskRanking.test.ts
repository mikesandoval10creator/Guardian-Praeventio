// Praeventio Guard — riskRanking router contract tests.

import { describe, it, expect } from 'vitest';
import riskRankingRouter from './riskRanking';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (riskRankingRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('riskRankingRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(riskRankingRouter).toBeDefined();
    expect(typeof riskRankingRouter).toBe('function');
  });

  it.each([
    '/:projectId/risk-ranking/risks',
    '/:projectId/risk-ranking/weak-controls',
    '/:projectId/risk-ranking/zones',
    '/:projectId/risk-ranking/tasks',
  ])('registers POST %s', (path) => {
    expect(hasPost(path)).toBe(true);
  });
});
