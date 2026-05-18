// Praeventio Guard — F.23 Document Versioning router contract tests.

import { describe, it, expect } from 'vitest';
import documentVersioningRouter from './documentVersioning';

describe('documentVersioningRouter (F.23 wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(documentVersioningRouter).toBeDefined();
    expect(typeof documentVersioningRouter).toBe('function');
  });

  it('registers GET /:projectId/documents/:documentId/chain', () => {
    const layers = (documentVersioningRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/documents/:documentId/chain' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers GET /:projectId/documents/:documentId/active', () => {
    const layers = (documentVersioningRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/documents/:documentId/active' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/documents/:documentId/versions', () => {
    const layers = (documentVersioningRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/documents/:documentId/versions' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/documents/:documentId/versions/:versionId/status', () => {
    const layers = (documentVersioningRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path ===
          '/:projectId/documents/:documentId/versions/:versionId/status' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers GET /:projectId/documents/:documentId/changelog', () => {
    const layers = (documentVersioningRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/documents/:documentId/changelog' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });
});
