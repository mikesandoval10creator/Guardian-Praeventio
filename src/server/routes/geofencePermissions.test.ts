// Praeventio Guard — geofencePermissions router contract tests.

import { describe, it, expect } from 'vitest';
import geofencePermissionsRouter from './geofencePermissions';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (geofencePermissionsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('geofencePermissionsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(geofencePermissionsRouter).toBeDefined();
    expect(typeof geofencePermissionsRouter).toBe('function');
  });

  it('registers POST /:projectId/geofence-permissions/decide-ux', () => {
    expect(hasPost('/:projectId/geofence-permissions/decide-ux')).toBe(true);
  });
});
