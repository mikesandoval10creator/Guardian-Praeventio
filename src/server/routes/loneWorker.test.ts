// Praeventio Guard — loneWorker router contract tests.

import { describe, it, expect } from 'vitest';
import loneWorkerRouter from './loneWorker';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (loneWorkerRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('loneWorkerRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(loneWorkerRouter).toBeDefined();
    expect(typeof loneWorkerRouter).toBe('function');
  });

  const paths = [
    '/:projectId/lone-worker/check-in',
    '/:projectId/lone-worker/end-session',
    '/:projectId/lone-worker/derive-status',
    '/:projectId/lone-worker/decide-escalation',
    '/:projectId/lone-worker/admin-overview',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }

  it('registers exactly 5 POST endpoints', () => {
    const postRoutes = layers.filter(
      (l) => l.route?.methods.post === true,
    );
    expect(postRoutes.length).toBe(5);
  });

  it('all routes are nested under /:projectId/lone-worker/', () => {
    const routePaths = layers
      .filter((l) => l.route)
      .map((l) => l.route!.path);
    for (const p of routePaths) {
      expect(p.startsWith('/:projectId/lone-worker/')).toBe(true);
    }
  });
});
