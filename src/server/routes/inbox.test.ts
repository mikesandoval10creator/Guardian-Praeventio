// Praeventio Guard — F.8 Inbox del Prevencionista router contract tests.

import { describe, it, expect } from 'vitest';
import inboxRouter from './inbox';

describe('inboxRouter (F.8 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(inboxRouter).toBeDefined();
    expect(typeof inboxRouter).toBe('function');
  });

  it('registers GET /:projectId/inbox', () => {
    const layers = (inboxRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/inbox' && l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });
});
