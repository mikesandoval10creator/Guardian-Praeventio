// Praeventio Guard — aiQuality router contract tests.

import { describe, it, expect } from 'vitest';
import aiQualityRouter from './aiQuality';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (aiQualityRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('aiQualityRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(aiQualityRouter).toBeDefined();
    expect(typeof aiQualityRouter).toBe('function');
  });

  it('registers POST /:projectId/ai-quality/log-response', () => {
    expect(hasPost('/:projectId/ai-quality/log-response')).toBe(true);
  });

  it('registers POST /:projectId/ai-quality/assert-human-gated', () => {
    expect(hasPost('/:projectId/ai-quality/assert-human-gated')).toBe(true);
  });

  it('registers POST /:projectId/ai-quality/record-human-decision', () => {
    expect(hasPost('/:projectId/ai-quality/record-human-decision')).toBe(true);
  });

  it('registers POST /:projectId/ai-quality/record-override', () => {
    expect(hasPost('/:projectId/ai-quality/record-override')).toBe(true);
  });

  it('registers POST /:projectId/ai-quality/rate-entry', () => {
    expect(hasPost('/:projectId/ai-quality/rate-entry')).toBe(true);
  });

  it('registers POST /:projectId/ai-quality/summarize', () => {
    expect(hasPost('/:projectId/ai-quality/summarize')).toBe(true);
  });
});
