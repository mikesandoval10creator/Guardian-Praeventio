import { describe, it, expect } from 'vitest';
import apprenticeshipRouter from './apprenticeship';

describe('apprenticeshipRouter (§244-250 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(apprenticeshipRouter).toBeDefined();
    expect(typeof apprenticeshipRouter).toBe('function');
  });

  it('registers the 5 apprenticeship routes', () => {
    const layers = (apprenticeshipRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;

    const expectRoute = (path: string, method: 'get' | 'post') => {
      // Express crea una layer separada por (path, method); .find por
      // path solo devuelve la primera. Buscamos por (path, method).
      const layer = layers.find(
        (l) => l.route?.path === path && l.route?.methods[method] === true,
      );
      expect(layer, `missing ${method.toUpperCase()} ${path}`).toBeDefined();
      expect(layer?.route?.methods[method]).toBe(true);
    };

    expectRoute('/:projectId/apprentices', 'get');
    expectRoute('/:projectId/apprentices', 'post');
    expectRoute('/:projectId/apprentices/:uid/authorize', 'post');
    expectRoute('/:projectId/apprentices/:uid/expose', 'post');
    expectRoute('/:projectId/mentors/availability', 'get');
  });
});
