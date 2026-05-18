// Praeventio Guard — F.5 router contract tests.

import { describe, it, expect } from 'vitest';
import qrSignatureRouter from './qrSignature';

describe('qrSignatureRouter (F.5 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(qrSignatureRouter).toBeDefined();
    expect(typeof qrSignatureRouter).toBe('function');
  });

  it('registers both /challenge and /acknowledge', () => {
    const layers = (qrSignatureRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/qr-signature/challenge']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/qr-signature/acknowledge']?.has('post')).toBe(true);
  });
});
