// Praeventio Guard — consultativeSale router contract tests.

import { describe, it, expect } from 'vitest';
import consultativeSaleRouter from './consultativeSale';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (consultativeSaleRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('consultativeSaleRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(consultativeSaleRouter).toBeDefined();
    expect(typeof consultativeSaleRouter).toBe('function');
  });

  it('registers POST /:projectId/sales/build-playbook', () => {
    expect(hasPost('/:projectId/sales/build-playbook')).toBe(true);
  });
});
