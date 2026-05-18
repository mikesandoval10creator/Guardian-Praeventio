// Praeventio Guard — formBuilderAdvanced router contract tests.

import { describe, it, expect } from 'vitest';
import formBuilderAdvancedRouter from './formBuilderAdvanced';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (formBuilderAdvancedRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('formBuilderAdvancedRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(formBuilderAdvancedRouter).toBeDefined();
    expect(typeof formBuilderAdvancedRouter).toBe('function');
  });

  it('registers POST /:projectId/forms-advanced/evaluate-computed-field', () => {
    expect(
      hasPost('/:projectId/forms-advanced/evaluate-computed-field'),
    ).toBe(true);
  });

  it('registers POST /:projectId/forms-advanced/validate-cross-field', () => {
    expect(
      hasPost('/:projectId/forms-advanced/validate-cross-field'),
    ).toBe(true);
  });

  it('registers POST /:projectId/forms-advanced/detect-circular-deps', () => {
    expect(
      hasPost('/:projectId/forms-advanced/detect-circular-deps'),
    ).toBe(true);
  });

  it('registers POST /:projectId/forms-advanced/topo-sort', () => {
    expect(hasPost('/:projectId/forms-advanced/topo-sort')).toBe(true);
  });

  it('registers POST /:projectId/forms-advanced/evaluate-all-computed', () => {
    expect(
      hasPost('/:projectId/forms-advanced/evaluate-all-computed'),
    ).toBe(true);
  });
});
