import { describe, it, expect } from 'vitest';
import { ADMIN_ROLES, SUPERVISOR_ROLES, ALL_ROLES } from './types/roles';

describe('smoke', () => {
  it('role constants are populated', () => {
    expect(ADMIN_ROLES.length).toBeGreaterThan(0);
    expect(SUPERVISOR_ROLES.length).toBeGreaterThan(0);
    expect(ALL_ROLES.length).toBeGreaterThan(0);
  });

  it('environment is available', () => {
    expect(typeof process.env).toBe('object');
  });
});
