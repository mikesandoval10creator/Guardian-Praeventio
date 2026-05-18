// Praeventio Guard — AI Toggle router contract tests.

import { describe, it, expect } from 'vitest';
import aiToggleRouter from './aiToggle';

describe('aiToggleRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(aiToggleRouter).toBeDefined();
    expect(typeof aiToggleRouter).toBe('function');
  });

  it('registers POST /:projectId/ai-mode/decide', () => {
    const layers = (aiToggleRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/ai-mode/decide' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/ai-mode/rules-only-check', () => {
    const layers = (aiToggleRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/ai-mode/rules-only-check' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/ai-mode/rule-drift', () => {
    const layers = (aiToggleRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/ai-mode/rule-drift' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });
});
