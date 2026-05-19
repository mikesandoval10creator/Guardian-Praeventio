// Praeventio Guard — workerHistory router contract tests.

import { describe, it, expect } from 'vitest';
import workerHistoryRouter from './workerHistory';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (workerHistoryRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('workerHistoryRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(workerHistoryRouter).toBeDefined();
    expect(typeof workerHistoryRouter).toBe('function');
  });

  const paths = [
    '/:projectId/worker-history/build-portable',
    '/:projectId/worker-history/redact-pii',
    '/:projectId/worker-history/serialize',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
