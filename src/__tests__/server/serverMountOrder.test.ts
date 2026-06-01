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

// B1 emergency-block audit (2026-06-01): loneWorker.ts, refuges.ts and
// restrictedZones.ts were implemented + unit-tested (on standalone express
// apps) but NEVER mounted in server.ts, so the real consumers — useLoneWorker,
// useRefuges, useRestrictedZones and their pages/components — got 404 against
// the live server. The per-router supertest suites mount the router on a fresh
// app, so they passed while production was broken. This contract pins the real
// wiring: each router must be imported AND mounted under its expected prefix,
// before the SPA catch-all (otherwise the catch-all would swallow the request
// and return SPA HTML).
describe('server.ts block-audit router mounts (B1, B2 … contract)', () => {
  const source = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
  const lines = source.split('\n');

  function findLine(predicate: (line: string) => boolean): number {
    return lines.findIndex(predicate);
  }

  const spaCatchAll = findLine((l) => /^\s*app\.get\(\s*['"`]\*['"`]/.test(l));

  const cases: ReadonlyArray<{
    name: string;
    importRe: RegExp;
    mountRe: RegExp;
  }> = [
    {
      name: 'loneWorker (/:projectId/lone-worker/*) under /api/sprint-k',
      importRe: /import\s+loneWorkerRouter\s+from\s+['"`][^'"`]*loneWorker(\.js)?['"`]/,
      mountRe: /app\.use\(\s*['"`]\/api\/sprint-k['"`]\s*,\s*loneWorkerRouter/,
    },
    {
      name: 'refuges (/:projectId/refuges/*) under /api/sprint-k',
      importRe: /import\s+refugesRouter\s+from\s+['"`][^'"`]*refuges(\.js)?['"`]/,
      mountRe: /app\.use\(\s*['"`]\/api\/sprint-k['"`]\s*,\s*refugesRouter/,
    },
    {
      name: 'restrictedZones (/define, /check, …) under /api/zones',
      importRe: /import\s+restrictedZonesRouter\s+from\s+['"`][^'"`]*restrictedZones(\.js)?['"`]/,
      mountRe: /app\.use\(\s*['"`]\/api\/zones['"`]\s*,\s*restrictedZonesRouter/,
    },
    {
      // B1-F2: persistent headcount CRUD surface (useEvacuationHeadcount,
      // EvacuationQRScanner). Distinct from the stateless evacuation.ts router.
      name: 'evacuationHeadcount (/start, /scan-qr, …) under /api/evacuation',
      importRe: /import\s+evacuationHeadcountRouter\s+from\s+['"`][^'"`]*evacuationHeadcount(\.js)?['"`]/,
      mountRe: /app\.use\(\s*['"`]\/api\/evacuation['"`]\s*,\s*evacuationHeadcountRouter/,
    },
    // B2 risk-block audit (2026-06-01): riskRanking.ts (feeds RiskTimeseriesChart,
    // TopRisksDashboardCard, WeakControlsDashboardCard) and shiftRiskPanel.ts were
    // implemented + unit-tested but never mounted → useRiskRanking / useShiftRiskPanel
    // got 404. Same orphan class as B1.
    {
      name: 'riskRanking (/:projectId/risk-ranking/*) under /api/sprint-k',
      importRe: /import\s+riskRankingRouter\s+from\s+['"`][^'"`]*riskRanking(\.js)?['"`]/,
      mountRe: /app\.use\(\s*['"`]\/api\/sprint-k['"`]\s*,\s*riskRankingRouter/,
    },
    {
      name: 'shiftRiskPanel (/:projectId/shift-risk-panel/*) under /api/sprint-k',
      importRe: /import\s+shiftRiskPanelRouter\s+from\s+['"`][^'"`]*shiftRiskPanel(\.js)?['"`]/,
      mountRe: /app\.use\(\s*['"`]\/api\/sprint-k['"`]\s*,\s*shiftRiskPanelRouter/,
    },
    // B4 incident-block audit (2026-06-01): incidentFlow (report→investigation→
    // lesson→microtraining) and stoppage (stateless work-stoppage transitions)
    // were orphaned → useIncidentFlow / useStoppage got 404.
    {
      name: 'incidentFlow (/:projectId/incident-flow/*) under /api/sprint-k',
      importRe: /import\s+incidentFlowRouter\s+from\s+['"`][^'"`]*incidentFlow(\.js)?['"`]/,
      mountRe: /app\.use\(\s*['"`]\/api\/sprint-k['"`]\s*,\s*incidentFlowRouter/,
    },
    {
      name: 'stoppage (/:projectId/stoppage/*) under /api/sprint-k',
      importRe: /import\s+stoppageRouter\s+from\s+['"`][^'"`]*stoppage(\.js)?['"`]/,
      mountRe: /app\.use\(\s*['"`]\/api\/sprint-k['"`]\s*,\s*stoppageRouter/,
    },
  ];

  it('declares the SPA catch-all (sanity)', () => {
    expect(spaCatchAll).toBeGreaterThanOrEqual(0);
  });

  for (const c of cases) {
    it(`imports and mounts ${c.name} before the SPA catch-all`, () => {
      const importLine = findLine((l) => c.importRe.test(l));
      const mountLine = findLine((l) => c.mountRe.test(l));

      expect(importLine, 'router import missing').toBeGreaterThanOrEqual(0);
      expect(mountLine, 'router never mounted (orphan)').toBeGreaterThanOrEqual(0);
      expect(mountLine).toBeLessThan(spaCatchAll);
    });
  }
});
