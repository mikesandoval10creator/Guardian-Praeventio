import { describe, it, expect } from 'vitest';
import portableHistoryRouter from './portableHistory';

describe('portableHistoryRouter (F.18 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(portableHistoryRouter).toBeDefined();
    expect(typeof portableHistoryRouter).toBe('function');
  });

  it('registers the 3 portable-history routes', () => {
    const layers = (portableHistoryRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;

    const get = layers.find(
      (l) => l.route?.path === '/:projectId/workers/:workerUid/portable-history',
    );
    expect(get?.route?.methods.get).toBe(true);

    const consent = layers.find(
      (l) => l.route?.path === '/:projectId/workers/:workerUid/portable-history/consent',
    );
    expect(consent?.route?.methods.post).toBe(true);

    const exportRoute = layers.find(
      (l) => l.route?.path === '/:projectId/workers/:workerUid/portable-history/export',
    );
    expect(exportRoute?.route?.methods.get).toBe(true);
  });
});
