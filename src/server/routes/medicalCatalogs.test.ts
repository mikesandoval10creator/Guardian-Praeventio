// Praeventio Guard — medicalCatalogs router contract tests.

import { describe, it, expect } from 'vitest';
import medicalCatalogsRouter from './medicalCatalogs';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (medicalCatalogsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('medicalCatalogsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(medicalCatalogsRouter).toBeDefined();
    expect(typeof medicalCatalogsRouter).toBe('function');
  });

  it.each([
    '/:projectId/medical-catalogs/diagnoses/search',
    '/:projectId/medical-catalogs/drugs/search',
    '/:projectId/medical-catalogs/anatomy/search',
    '/:projectId/medical-catalogs/diagnoses/by-risk-agent',
    '/:projectId/medical-catalogs/anatomy/by-system',
    '/:projectId/medical-catalogs/list-meta',
  ])('registers POST %s', (path) => {
    expect(hasPost(path)).toBe(true);
  });
});
