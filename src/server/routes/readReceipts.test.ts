// Praeventio Guard — readReceipts router contract tests.

import { describe, it, expect } from 'vitest';
import readReceiptsRouter from './readReceipts';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (readReceiptsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('readReceiptsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(readReceiptsRouter).toBeDefined();
    expect(typeof readReceiptsRouter).toBe('function');
  });

  const paths = [
    '/:projectId/read-receipts/resolve-audience',
    '/:projectId/read-receipts/build-initial',
    '/:projectId/read-receipts/compute-deadline',
    '/:projectId/read-receipts/derive-status',
    '/:projectId/read-receipts/acknowledge',
    '/:projectId/read-receipts/summarize',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
