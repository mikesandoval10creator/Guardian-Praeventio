// Praeventio Guard — bowtie router contract tests.

import { describe, it, expect } from 'vitest';
import bowtieRouter from './bowtie';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (bowtieRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('bowtieRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(bowtieRouter).toBeDefined();
    expect(typeof bowtieRouter).toBe('function');
  });

  it('registers POST /:projectId/bowtie/build', () => {
    expect(hasPost('/:projectId/bowtie/build')).toBe(true);
  });

  it('registers POST /:projectId/bowtie/list-unprotected-threats', () => {
    expect(hasPost('/:projectId/bowtie/list-unprotected-threats')).toBe(true);
  });

  it('registers POST /:projectId/bowtie/recommend-next-barrier', () => {
    expect(hasPost('/:projectId/bowtie/recommend-next-barrier')).toBe(true);
  });
});
