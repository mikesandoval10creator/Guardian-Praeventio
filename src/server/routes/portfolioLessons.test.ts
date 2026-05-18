// Praeventio Guard — portfolioLessons router contract tests.

import { describe, it, expect } from 'vitest';
import portfolioLessonsRouter from './portfolioLessons';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (portfolioLessonsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('portfolioLessonsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(portfolioLessonsRouter).toBeDefined();
    expect(typeof portfolioLessonsRouter).toBe('function');
  });

  it('registers POST /:projectId/portfolio-lessons/recommend', () => {
    expect(hasPost('/:projectId/portfolio-lessons/recommend')).toBe(true);
  });

  it('registers POST /:projectId/portfolio-lessons/summarize', () => {
    expect(hasPost('/:projectId/portfolio-lessons/summarize')).toBe(true);
  });
});
