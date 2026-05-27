// Praeventio Guard — pymeWizard router contract tests.

import { describe, it, expect } from 'vitest';
import pymeWizardRouter from './pymeWizard';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (pymeWizardRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('pymeWizardRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(pymeWizardRouter).toBeDefined();
    expect(typeof pymeWizardRouter).toBe('function');
  });

  it('registers POST /:projectId/pyme-wizard/build-plan', () => {
    expect(hasPost('/:projectId/pyme-wizard/build-plan')).toBe(true);
  });
});
