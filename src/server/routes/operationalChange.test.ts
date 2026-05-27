// Praeventio Guard — operationalChange router contract tests (Bloque 3.17).
//
// Wire-up only (Express stack layers). Per loneWorker.test.ts mirror.

import { describe, it, expect } from 'vitest';
import operationalChangeRouter from './operationalChange';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (operationalChangeRouter as unknown as { stack: Layer[] }).stack;

function hasMethod(path: string, method: 'get' | 'post'): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods[method] === true,
  );
}

describe('operationalChangeRouter (Bloque 3.17 MOC wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(operationalChangeRouter).toBeDefined();
    expect(typeof operationalChangeRouter).toBe('function');
  });

  it('registers POST /:projectId/moc/declare', () => {
    expect(hasMethod('/:projectId/moc/declare', 'post')).toBe(true);
  });

  it('registers GET /:projectId/moc/pending-acks', () => {
    expect(hasMethod('/:projectId/moc/pending-acks', 'get')).toBe(true);
  });

  it('registers POST /:projectId/moc/:mocId/acknowledge', () => {
    expect(hasMethod('/:projectId/moc/:mocId/acknowledge', 'post')).toBe(true);
  });

  it('registers GET /:projectId/moc/list', () => {
    expect(hasMethod('/:projectId/moc/list', 'get')).toBe(true);
  });

  it('registers POST /:projectId/moc/:mocId/close', () => {
    expect(hasMethod('/:projectId/moc/:mocId/close', 'post')).toBe(true);
  });

  it('registers exactly 5 endpoints', () => {
    const routes = layers.filter((l) => l.route);
    expect(routes.length).toBe(5);
  });

  it('all routes are nested under /:projectId/moc/', () => {
    const routePaths = layers
      .filter((l) => l.route)
      .map((l) => l.route!.path);
    for (const p of routePaths) {
      expect(p.startsWith('/:projectId/moc/')).toBe(true);
    }
  });

  it('does NOT mount changeMgmt-prefixed paths (separation of concerns)', () => {
    const routePaths = layers
      .filter((l) => l.route)
      .map((l) => l.route!.path);
    for (const p of routePaths) {
      expect(p.includes('/change-mgmt/')).toBe(false);
    }
  });
});
