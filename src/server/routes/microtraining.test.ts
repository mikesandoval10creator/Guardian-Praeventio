// Praeventio Guard — F.22 Microtraining router contract tests.

import { describe, it, expect } from 'vitest';
import microtrainingRouter from './microtraining';

describe('microtrainingRouter (F.22 wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(microtrainingRouter).toBeDefined();
    expect(typeof microtrainingRouter).toBe('function');
  });

  it('registers GET /:projectId/microtraining/catalog', () => {
    const layers = (microtrainingRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/microtraining/catalog' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers GET /:projectId/microtraining/recommend', () => {
    const layers = (microtrainingRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/microtraining/recommend' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/microtraining/session', () => {
    const layers = (microtrainingRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/microtraining/session' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers GET /:projectId/microtraining/certs', () => {
    const layers = (microtrainingRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/microtraining/certs' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });
});
