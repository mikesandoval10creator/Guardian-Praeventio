// Praeventio Guard — auditChain router contract tests.

import { describe, it, expect } from 'vitest';
import auditChainRouter from './auditChain';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (auditChainRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('auditChainRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(auditChainRouter).toBeDefined();
    expect(typeof auditChainRouter).toBe('function');
  });

  it('registers POST /:projectId/audit-chain/append', () => {
    expect(hasPost('/:projectId/audit-chain/append')).toBe(true);
  });

  it('registers POST /:projectId/audit-chain/verify', () => {
    expect(hasPost('/:projectId/audit-chain/verify')).toBe(true);
  });

  it('registers POST /:projectId/audit-chain/anchor', () => {
    expect(hasPost('/:projectId/audit-chain/anchor')).toBe(true);
  });

  it('registers POST /:projectId/audit-chain/find-gap', () => {
    expect(hasPost('/:projectId/audit-chain/find-gap')).toBe(true);
  });
});
