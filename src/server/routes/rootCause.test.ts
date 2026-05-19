// Praeventio Guard — rootCause router contract tests.

import { describe, it, expect } from 'vitest';
import rootCauseRouter from './rootCause';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (rootCauseRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('rootCauseRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(rootCauseRouter).toBeDefined();
    expect(typeof rootCauseRouter).toBe('function');
  });

  const paths = [
    '/:projectId/root-cause/build-analysis',
    '/:projectId/root-cause/compute-stats',
    '/:projectId/root-cause/analyze-punitive-language',
    '/:projectId/root-cause/get-investigation-questions',
    '/:projectId/root-cause/get-starter-questionnaire',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
