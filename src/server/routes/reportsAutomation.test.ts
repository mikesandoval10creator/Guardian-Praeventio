// Praeventio Guard — reportsAutomation router contract tests.

import { describe, it, expect } from 'vitest';
import reportsAutomationRouter from './reportsAutomation';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (reportsAutomationRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('reportsAutomationRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(reportsAutomationRouter).toBeDefined();
    expect(typeof reportsAutomationRouter).toBe('function');
  });

  it('registers POST /:projectId/reports-automation/validate', () => {
    expect(hasPost('/:projectId/reports-automation/validate')).toBe(true);
  });

  it('registers POST /:projectId/reports-automation/render', () => {
    expect(hasPost('/:projectId/reports-automation/render')).toBe(true);
  });

  it('registers POST /:projectId/reports-automation/check-due', () => {
    expect(hasPost('/:projectId/reports-automation/check-due')).toBe(true);
  });
});
