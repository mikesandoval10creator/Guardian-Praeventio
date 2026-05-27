// Praeventio Guard — Bloque 3.13 wire huérfanos: industryRules router
// contract tests.
//
// Mirror del patrón en `loneWorker.test.ts` + `equipmentQr.test.ts`: we
// inspect the router's stack (paths + methods + middleware count) without
// booting firebase-admin. Behavioural tests of the preset engine itself
// live in `src/services/industryRules/industryRuleEngine.test.ts` (if any).

import { describe, it, expect } from 'vitest';
import industryRulesRouter from './industryRules';

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack?: Array<unknown>;
  };
};

function collectMethodsByPath(
  router: unknown,
): Record<string, Set<string>> {
  const layers = (router as { stack: Layer[] }).stack;
  const methodsByPath: Record<string, Set<string>> = {};
  for (const l of layers) {
    if (!l.route) continue;
    methodsByPath[l.route.path] ??= new Set();
    for (const m of Object.keys(l.route.methods))
      methodsByPath[l.route.path].add(m);
  }
  return methodsByPath;
}

const layers = (industryRulesRouter as unknown as { stack: Layer[] }).stack;

describe('industryRulesRouter (Bloque 3.13 wire huérfanos contract)', () => {
  it('exports a Router instance', () => {
    expect(industryRulesRouter).toBeDefined();
    expect(typeof industryRulesRouter).toBe('function');
  });

  it('registers GET /:projectId/industry/list', () => {
    const methodsByPath = collectMethodsByPath(industryRulesRouter);
    expect(methodsByPath['/:projectId/industry/list']?.has('get')).toBe(true);
  });

  it('registers POST /:projectId/industry/select', () => {
    const methodsByPath = collectMethodsByPath(industryRulesRouter);
    expect(methodsByPath['/:projectId/industry/select']?.has('post')).toBe(
      true,
    );
  });

  it('registers GET /:projectId/industry/applicable-norms', () => {
    const methodsByPath = collectMethodsByPath(industryRulesRouter);
    expect(
      methodsByPath['/:projectId/industry/applicable-norms']?.has('get'),
    ).toBe(true);
  });

  it('registers GET /:projectId/industry/required-epp', () => {
    const methodsByPath = collectMethodsByPath(industryRulesRouter);
    expect(
      methodsByPath['/:projectId/industry/required-epp']?.has('get'),
    ).toBe(true);
  });

  it('registers GET /:projectId/industry/typical-hazards', () => {
    const methodsByPath = collectMethodsByPath(industryRulesRouter);
    expect(
      methodsByPath['/:projectId/industry/typical-hazards']?.has('get'),
    ).toBe(true);
  });

  it('registers exactly 5 distinct paths (no extra surface area)', () => {
    const methodsByPath = collectMethodsByPath(industryRulesRouter);
    const paths = Object.keys(methodsByPath).filter((p) =>
      p.startsWith('/:projectId/industry/'),
    );
    expect(new Set(paths).size).toBe(5);
  });

  it('all routes are nested under /:projectId/industry/', () => {
    const routePaths = layers
      .filter((l) => l.route)
      .map((l) => l.route!.path);
    expect(routePaths.length).toBeGreaterThan(0);
    for (const p of routePaths) {
      expect(p.startsWith('/:projectId/industry/')).toBe(true);
    }
  });

  it('POST /select is protected by verifyAuth → idempotencyKey → validate → handler (>=4 middleware)', () => {
    // Mutating endpoints must carry the full middleware chain. GET routes
    // only have verifyAuth + handler (>=2), but POST /select also needs
    // idempotencyKey() and validate() between them.
    const selectLayer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/industry/select' &&
        l.route?.methods.post === true,
    );
    expect(selectLayer?.route?.stack?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
