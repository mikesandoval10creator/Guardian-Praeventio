// Praeventio Guard — comms router contract tests.

import { describe, it, expect } from 'vitest';
import commsRouter from './comms';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (commsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('commsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(commsRouter).toBeDefined();
    expect(typeof commsRouter).toBe('function');
  });

  it('registers POST /:projectId/comms/best-channel-for-zone', () => {
    expect(hasPost('/:projectId/comms/best-channel-for-zone')).toBe(true);
  });

  it('registers POST /:projectId/comms/detect-dead-zones', () => {
    expect(hasPost('/:projectId/comms/detect-dead-zones')).toBe(true);
  });

  it('registers POST /:projectId/comms/compute-escalation', () => {
    expect(hasPost('/:projectId/comms/compute-escalation')).toBe(true);
  });

  it('registers POST /:projectId/comms/build-contactability-report', () => {
    expect(hasPost('/:projectId/comms/build-contactability-report')).toBe(true);
  });

  it('registers POST /:projectId/comms/plan-channel-failover', () => {
    expect(hasPost('/:projectId/comms/plan-channel-failover')).toBe(true);
  });
});
