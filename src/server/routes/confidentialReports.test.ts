import { describe, it, expect } from 'vitest';
import confidentialReportsRouter from './confidentialReports';

describe('confidentialReportsRouter (§211-213 / Ley Karin migration contract)', () => {
  it('exports a Router instance', () => {
    expect(confidentialReportsRouter).toBeDefined();
    expect(typeof confidentialReportsRouter).toBe('function');
  });

  it('registers the 5 confidential-reports routes', () => {
    const layers = (confidentialReportsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;

    const expectRoute = (path: string, method: 'get' | 'post') => {
      const layer = layers.find((l) => l.route?.path === path);
      expect(layer, `missing ${method.toUpperCase()} ${path}`).toBeDefined();
      expect(layer?.route?.methods[method]).toBe(true);
    };

    expectRoute('/:projectId/confidential-reports', 'post');
    expectRoute('/:projectId/confidential-reports', 'get');
    expectRoute('/:projectId/confidential-reports/:id/respond', 'post');
    expectRoute('/:projectId/confidential-reports/:id/close', 'post');
    expectRoute('/:projectId/confidential-reports/retaliation-alerts', 'get');
  });
});
