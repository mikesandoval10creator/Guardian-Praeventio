// SPDX-License-Identifier: MIT
//
// Contract test for server.ts route mount ordering.
//
// B1 audit (2026-05-19): the SPA catch-all `app.get('*', ...)` for index.html
// fallback used to be registered BEFORE the billing/subscription/webpay/dte
// routers. Express matches handlers in registration order, so a real-browser
// request to `/billing/webpay/return` would hit the catch-all first and get
// SPA HTML back instead of the Webpay handler — Transbank can never complete
// the payment.
//
// This test pins the contract so a future refactor doesn't silently
// re-introduce the bug. It reads server.ts as text (not as an executable
// module — server.ts boots Express at import time) and asserts the literal
// line ordering of the key mounts vs the catch-all.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('server.ts route mount ordering (B1 contract)', () => {
  const source = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
  const lines = source.split('\n');

  function findLine(predicate: (line: string) => boolean): number {
    return lines.findIndex(predicate);
  }

  it('mounts /billing (webpay return) BEFORE the SPA catch-all', () => {
    const webpayMount = findLine(
      (l) => /app\.use\(\s*['"`]\/billing['"`]\s*,\s*billingWebpayRouter/.test(l),
    );
    const spaCatchAll = findLine(
      (l) => /^\s*app\.get\(\s*['"`]\*['"`]/.test(l),
    );

    expect(webpayMount).toBeGreaterThanOrEqual(0);
    expect(spaCatchAll).toBeGreaterThanOrEqual(0);
    expect(webpayMount).toBeLessThan(spaCatchAll);
  });

  it('mounts /api/billing BEFORE the SPA catch-all', () => {
    const billingApiMount = findLine(
      (l) => /app\.use\(\s*['"`]\/api\/billing['"`]\s*,\s*billingApiRouter/.test(l),
    );
    const spaCatchAll = findLine(
      (l) => /^\s*app\.get\(\s*['"`]\*['"`]/.test(l),
    );

    expect(billingApiMount).toBeGreaterThanOrEqual(0);
    expect(spaCatchAll).toBeGreaterThanOrEqual(0);
    expect(billingApiMount).toBeLessThan(spaCatchAll);
  });

  it('mounts /api/subscription BEFORE the SPA catch-all', () => {
    const subMount = findLine(
      (l) => /app\.use\(\s*['"`]\/api\/subscription['"`]/.test(l),
    );
    const spaCatchAll = findLine(
      (l) => /^\s*app\.get\(\s*['"`]\*['"`]/.test(l),
    );

    expect(subMount).toBeGreaterThanOrEqual(0);
    expect(spaCatchAll).toBeGreaterThanOrEqual(0);
    expect(subMount).toBeLessThan(spaCatchAll);
  });

  it('mounts /api/dte BEFORE the SPA catch-all', () => {
    const dteMount = findLine(
      (l) => /app\.use\(\s*['"`]\/api\/dte['"`]/.test(l),
    );
    const spaCatchAll = findLine(
      (l) => /^\s*app\.get\(\s*['"`]\*['"`]/.test(l),
    );

    expect(dteMount).toBeGreaterThanOrEqual(0);
    expect(spaCatchAll).toBeGreaterThanOrEqual(0);
    expect(dteMount).toBeLessThan(spaCatchAll);
  });

  it('only declares the SPA catch-all once', () => {
    const matches = lines.filter((l) => /^\s*app\.get\(\s*['"`]\*['"`]/.test(l));
    expect(matches.length).toBe(1);
  });
});
