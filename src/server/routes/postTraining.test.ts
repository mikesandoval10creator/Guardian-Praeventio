// Praeventio Guard — postTraining router contract tests.

import { describe, it, expect } from 'vitest';
import postTrainingRouter from './postTraining';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (postTrainingRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('postTrainingRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(postTrainingRouter).toBeDefined();
    expect(typeof postTrainingRouter).toBe('function');
  });

  it('registers POST /:projectId/post-training/score-assessment', () => {
    expect(hasPost('/:projectId/post-training/score-assessment')).toBe(true);
  });

  it('registers POST /:projectId/post-training/next-review-delay', () => {
    expect(hasPost('/:projectId/post-training/next-review-delay')).toBe(true);
  });

  it('registers POST /:projectId/post-training/schedule-next-reviews', () => {
    expect(hasPost('/:projectId/post-training/schedule-next-reviews')).toBe(
      true,
    );
  });

  it('registers POST /:projectId/post-training/find-case-studies', () => {
    expect(hasPost('/:projectId/post-training/find-case-studies')).toBe(true);
  });
});
