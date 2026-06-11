// Praeventio Guard — protocols router contract tests.

import { describe, it, expect } from 'vitest';
import protocolsRouter from './protocols';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (protocolsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('protocolsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(protocolsRouter).toBeDefined();
    expect(typeof protocolsRouter).toBe('function');
  });

  const paths = [
    '/:projectId/protocols/iper',
    '/:projectId/protocols/prexor',
    '/:projectId/protocols/tmert',
    '/:projectId/protocols/tmert/assessments',
    '/:projectId/protocols/prexor/assessments',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }

  it('registers GET /:projectId/protocols/assessments', () => {
    expect(
      layers.some(
        (l) =>
          l.route?.path === '/:projectId/protocols/assessments' &&
          l.route?.methods.get === true,
      ),
    ).toBe(true);
  });
});
