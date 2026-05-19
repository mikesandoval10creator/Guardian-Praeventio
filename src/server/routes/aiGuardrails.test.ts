// Praeventio Guard — aiGuardrails router contract tests.

import { describe, it, expect } from 'vitest';
import aiGuardrailsRouter from './aiGuardrails';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (aiGuardrailsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('aiGuardrailsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(aiGuardrailsRouter).toBeDefined();
    expect(typeof aiGuardrailsRouter).toBe('function');
  });

  const paths = [
    '/:projectId/ai-guardrails/get-prompt',
    '/:projectId/ai-guardrails/get-latest-version',
    '/:projectId/ai-guardrails/list-versions',
    '/:projectId/ai-guardrails/list-prompt-ids',
    '/:projectId/ai-guardrails/get-catalog',
    '/:projectId/ai-guardrails/render-prompt-body',
    '/:projectId/ai-guardrails/find-unresolved-placeholders',
    '/:projectId/ai-guardrails/extract-citations',
    '/:projectId/ai-guardrails/validate-response',
    '/:projectId/ai-guardrails/guard-hallucination',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
