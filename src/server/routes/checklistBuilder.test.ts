// Praeventio Guard — checklistBuilder router contract tests.

import { describe, it, expect } from 'vitest';
import checklistBuilderRouter from './checklistBuilder';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (checklistBuilderRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('checklistBuilderRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(checklistBuilderRouter).toBeDefined();
    expect(typeof checklistBuilderRouter).toBe('function');
  });

  it('registers POST /:projectId/checklists/validate-response', () => {
    expect(hasPost('/:projectId/checklists/validate-response')).toBe(true);
  });

  it('registers POST /:projectId/checklists/rectify-field', () => {
    expect(hasPost('/:projectId/checklists/rectify-field')).toBe(true);
  });

  it('registers POST /:projectId/checklists/apply-signature', () => {
    expect(hasPost('/:projectId/checklists/apply-signature')).toBe(true);
  });

  it('registers POST /:projectId/checklists/lock-response', () => {
    expect(hasPost('/:projectId/checklists/lock-response')).toBe(true);
  });
});
