// Praeventio Guard — Bloque 4.1: horometro router contract tests.
//
// Mirror del patron en equipmentQr.test.ts: validamos la forma del
// router (paths + métodos + middleware order) sin levantar firebase-admin.
// Los tests de comportamiento del engine viven en
// `src/services/zettelkasten/flows/horometroMaintenanceFlow.test.ts`,
// `src/services/horometro/horometroService.test.ts` y
// `src/services/maintenance/maintenanceScheduler.test.ts`.

import { describe, it, expect } from 'vitest';
import horometroRouter from './horometro';

describe('horometroRouter (Bloque 4.1 Flagship contract)', () => {
  it('exports a Router instance', () => {
    expect(horometroRouter).toBeDefined();
    expect(typeof horometroRouter).toBe('function');
  });

  it('registers POST /:projectId/horometro/reading', () => {
    const methodsByPath = collectMethodsByPath(horometroRouter);
    expect(methodsByPath['/:projectId/horometro/reading']?.has('post')).toBe(true);
  });

  it('registers GET /:projectId/horometro/equipment/:eqId/maintenance-tasks', () => {
    const methodsByPath = collectMethodsByPath(horometroRouter);
    expect(
      methodsByPath[
        '/:projectId/horometro/equipment/:eqId/maintenance-tasks'
      ]?.has('get'),
    ).toBe(true);
  });

  it('registers POST /:projectId/horometro/maintenance-task/:taskId/complete', () => {
    const methodsByPath = collectMethodsByPath(horometroRouter);
    expect(
      methodsByPath[
        '/:projectId/horometro/maintenance-task/:taskId/complete'
      ]?.has('post'),
    ).toBe(true);
  });

  it('exports exactly 3 distinct paths (no extra surface area)', () => {
    const methodsByPath = collectMethodsByPath(horometroRouter);
    const paths = Object.keys(methodsByPath).filter((p) =>
      p.startsWith('/:projectId/horometro'),
    );
    expect(new Set(paths).size).toBe(3);
  });

  it('mutating endpoints (reading + complete) are guarded by verifyAuth + idempotencyKey + validate', () => {
    const layers = (horometroRouter as unknown as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack?: Array<unknown>;
        };
      }>;
    }).stack;
    const readingLayer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/horometro/reading' &&
        l.route?.methods.post === true,
    );
    // verifyAuth + idempotencyKey + validate + handler = 4
    expect(readingLayer?.route?.stack?.length ?? 0).toBeGreaterThanOrEqual(4);
    const completeLayer = layers.find(
      (l) =>
        l.route?.path ===
          '/:projectId/horometro/maintenance-task/:taskId/complete' &&
        l.route?.methods.post === true,
    );
    expect(completeLayer?.route?.stack?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('read-only endpoint (list tasks) is guarded by verifyAuth but does NOT require idempotencyKey', () => {
    const layers = (horometroRouter as unknown as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack?: Array<unknown>;
        };
      }>;
    }).stack;
    const listLayer = layers.find(
      (l) =>
        l.route?.path ===
          '/:projectId/horometro/equipment/:eqId/maintenance-tasks' &&
        l.route?.methods.get === true,
    );
    // verifyAuth + handler = 2
    expect(listLayer?.route?.stack?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(listLayer?.route?.stack?.length ?? 0).toBeLessThan(4);
  });

  it('reading endpoint is the only POST under the reading sub-path', () => {
    const methodsByPath = collectMethodsByPath(horometroRouter);
    const readingMethods = methodsByPath['/:projectId/horometro/reading'];
    expect(readingMethods?.size).toBe(1);
    expect(readingMethods?.has('post')).toBe(true);
  });

  it('complete-task endpoint is the only POST under the maintenance-task sub-path', () => {
    const methodsByPath = collectMethodsByPath(horometroRouter);
    const completeMethods =
      methodsByPath['/:projectId/horometro/maintenance-task/:taskId/complete'];
    expect(completeMethods?.size).toBe(1);
    expect(completeMethods?.has('post')).toBe(true);
  });
});

function collectMethodsByPath(
  router: unknown,
): Record<string, Set<string>> {
  const layers = (router as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
  }).stack;
  const methodsByPath: Record<string, Set<string>> = {};
  for (const l of layers) {
    if (!l.route) continue;
    methodsByPath[l.route.path] ??= new Set();
    for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
  }
  return methodsByPath;
}
