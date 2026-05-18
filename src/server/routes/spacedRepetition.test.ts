// Praeventio Guard — spacedRepetition router contract tests.

import { describe, it, expect } from 'vitest';
import spacedRepetitionRouter from './spacedRepetition';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (spacedRepetitionRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('spacedRepetitionRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(spacedRepetitionRouter).toBeDefined();
    expect(typeof spacedRepetitionRouter).toBe('function');
  });

  it('registers POST /:projectId/spaced-repetition/create-card', () => {
    expect(hasPost('/:projectId/spaced-repetition/create-card')).toBe(true);
  });

  it('registers POST /:projectId/spaced-repetition/review-card', () => {
    expect(hasPost('/:projectId/spaced-repetition/review-card')).toBe(true);
  });

  it('registers POST /:projectId/spaced-repetition/select-due-cards', () => {
    expect(hasPost('/:projectId/spaced-repetition/select-due-cards')).toBe(true);
  });

  it('registers POST /:projectId/spaced-repetition/build-retention-report', () => {
    expect(hasPost('/:projectId/spaced-repetition/build-retention-report')).toBe(true);
  });
});
