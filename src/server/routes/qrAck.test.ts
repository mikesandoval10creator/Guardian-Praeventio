// Praeventio Guard — qrAck router contract tests.

import { describe, it, expect } from 'vitest';
import qrAckRouter from './qrAck';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (qrAckRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('qrAckRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(qrAckRouter).toBeDefined();
    expect(typeof qrAckRouter).toBe('function');
  });

  it('registers POST /:projectId/qr-ack/create-session', () => {
    expect(hasPost('/:projectId/qr-ack/create-session')).toBe(true);
  });

  it('registers POST /:projectId/qr-ack/validate-scan', () => {
    expect(hasPost('/:projectId/qr-ack/validate-scan')).toBe(true);
  });
});
