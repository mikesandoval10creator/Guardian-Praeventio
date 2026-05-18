// Praeventio Guard — circadian router contract tests.

import { describe, it, expect } from 'vitest';
import circadianRouter from './circadian';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (circadianRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('circadianRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(circadianRouter).toBeDefined();
    expect(typeof circadianRouter).toBe('function');
  });

  it('registers POST /:projectId/circadian/classify-window', () => {
    expect(hasPost('/:projectId/circadian/classify-window')).toBe(true);
  });

  it('registers POST /:projectId/circadian/assess-alertness', () => {
    expect(hasPost('/:projectId/circadian/assess-alertness')).toBe(true);
  });

  it('registers POST /:projectId/circadian/recommend-shift-rotation', () => {
    expect(hasPost('/:projectId/circadian/recommend-shift-rotation')).toBe(true);
  });
});
