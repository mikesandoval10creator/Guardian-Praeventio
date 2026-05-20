// Praeventio Guard — Bloque 4.3 incidentFlow router contract tests.
//
// Same shape as other route contract tests in this folder
// (lessonsLearned.test.ts, microtraining.test.ts): we assert the Router
// instance exists and that the canonical route paths/methods are
// registered. We do NOT boot Express + Firestore here — that's the job
// of the e2e suite. The orchestration logic is covered by
// incidentLessonTrainingFlow.test.ts.

import { describe, it, expect } from 'vitest';
import incidentFlowRouter from './incidentFlow';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

function layersOf(router: typeof incidentFlowRouter): RouteLayer[] {
  return (router as unknown as { stack: RouteLayer[] }).stack;
}

function find(
  router: typeof incidentFlowRouter,
  path: string,
  method: 'get' | 'post',
): RouteLayer | undefined {
  return layersOf(router).find(
    (l) => l.route?.path === path && l.route?.methods[method] === true,
  );
}

describe('incidentFlowRouter (Bloque 4.3 contract)', () => {
  it('exports a Router instance', () => {
    expect(incidentFlowRouter).toBeDefined();
    expect(typeof incidentFlowRouter).toBe('function');
  });

  it('registers POST /:projectId/incident-flow/report', () => {
    expect(
      find(incidentFlowRouter, '/:projectId/incident-flow/report', 'post'),
    ).toBeDefined();
  });

  it('registers POST /:projectId/incident-flow/:incidentId/open-investigation', () => {
    expect(
      find(
        incidentFlowRouter,
        '/:projectId/incident-flow/:incidentId/open-investigation',
        'post',
      ),
    ).toBeDefined();
  });

  it('registers POST /:projectId/incident-flow/:incidentId/conclude-investigation', () => {
    expect(
      find(
        incidentFlowRouter,
        '/:projectId/incident-flow/:incidentId/conclude-investigation',
        'post',
      ),
    ).toBeDefined();
  });

  it('registers POST /:projectId/incident-flow/:incidentId/publish-lesson', () => {
    expect(
      find(
        incidentFlowRouter,
        '/:projectId/incident-flow/:incidentId/publish-lesson',
        'post',
      ),
    ).toBeDefined();
  });

  it('registers POST /:projectId/incident-flow/:incidentId/assign-microtraining', () => {
    expect(
      find(
        incidentFlowRouter,
        '/:projectId/incident-flow/:incidentId/assign-microtraining',
        'post',
      ),
    ).toBeDefined();
  });

  it('registers POST /:projectId/incident-flow/training/:assignmentId/complete', () => {
    expect(
      find(
        incidentFlowRouter,
        '/:projectId/incident-flow/training/:assignmentId/complete',
        'post',
      ),
    ).toBeDefined();
  });

  it('registers GET /:projectId/incident-flow/:incidentId/status', () => {
    expect(
      find(
        incidentFlowRouter,
        '/:projectId/incident-flow/:incidentId/status',
        'get',
      ),
    ).toBeDefined();
  });

  it('registers exactly 7 PDCA endpoints (6 POST + 1 GET)', () => {
    const flowPaths = layersOf(incidentFlowRouter)
      .map((l) => l.route?.path)
      .filter((p): p is string => typeof p === 'string' && p.includes('incident-flow'));
    // Each route registers once; we expect 7 unique paths.
    const uniquePaths = new Set(flowPaths);
    expect(uniquePaths.size).toBe(7);
  });

  it('uses verifyAuth on every endpoint (middleware sandwich)', () => {
    // We can't introspect middleware identity directly here, but every
    // route layer must have at least one non-handler middleware (verifyAuth +
    // validate). We assert the stack of each route has ≥2 entries.
    const flowLayers = layersOf(incidentFlowRouter).filter((l) =>
      l.route?.path?.includes('incident-flow'),
    );
    for (const l of flowLayers) {
      const stack = (l.route as unknown as { stack: Array<unknown> })?.stack;
      // verifyAuth + (validate for POSTs, just the handler for GET) + handler.
      // GET status has [verifyAuth, handler]; POSTs have [verifyAuth, validate, handler].
      expect(Array.isArray(stack)).toBe(true);
      expect((stack as Array<unknown>).length).toBeGreaterThanOrEqual(2);
    }
  });
});
