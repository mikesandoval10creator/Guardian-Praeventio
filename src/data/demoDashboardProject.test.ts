import { describe, it, expect } from 'vitest';
import { DEMO_DASHBOARD_PROJECT, DEMO_PROJECT_ID, DEMO_WORKERS } from './demoProject';

describe('DEMO_DASHBOARD_PROJECT (embudo PLG — proyecto demo del invitado)', () => {
  it('usa el id canónico del demo', () => {
    expect(DEMO_DASHBOARD_PROJECT.id).toBe(DEMO_PROJECT_ID);
  });
  it('está activo y marcado como demo read-only', () => {
    expect(DEMO_DASHBOARD_PROJECT.status).toBe('active');
    expect(DEMO_DASHBOARD_PROJECT.__demo__).toBe(true);
  });
  it('refleja la dotación demo (5 trabajadores sintéticos)', () => {
    expect(DEMO_DASHBOARD_PROJECT.workersCount).toBe(DEMO_WORKERS.length);
    expect(DEMO_WORKERS.length).toBeGreaterThanOrEqual(3);
  });
  it('tiene los campos requeridos por el tipo Project', () => {
    for (const k of ['id','name','description','location','industry','status','startDate','riskLevel']) {
      expect((DEMO_DASHBOARD_PROJECT as Record<string, unknown>)[k]).toBeTruthy();
    }
  });
});
