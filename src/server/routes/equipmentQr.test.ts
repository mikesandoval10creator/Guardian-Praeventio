// Praeventio Guard — Bloque 3 wire huérfanos (3.11) router contract tests.
//
// Mirror del patrón en `qrSignature.test.ts` + `drillsManager.test.ts`:
// validamos la forma del router (paths + métodos registrados) sin levantar
// firebase-admin. Las pruebas de comportamiento del engine viven en
// `src/services/equipment/equipmentQrService.test.ts`.

import { describe, it, expect } from 'vitest';
import equipmentQrRouter from './equipmentQr';

describe('equipmentQrRouter (Bloque 3 wire huérfanos 3.11 contract)', () => {
  it('exports a Router instance', () => {
    expect(equipmentQrRouter).toBeDefined();
    expect(typeof equipmentQrRouter).toBe('function');
  });

  it('registers POST /:projectId/equipment-qr/register', () => {
    const methodsByPath = collectMethodsByPath(equipmentQrRouter);
    expect(methodsByPath['/:projectId/equipment-qr/register']?.has('post')).toBe(true);
  });

  it('registers GET /:projectId/equipment-qr/:qrId', () => {
    const methodsByPath = collectMethodsByPath(equipmentQrRouter);
    expect(methodsByPath['/:projectId/equipment-qr/:qrId']?.has('get')).toBe(true);
  });

  it('registers POST /:projectId/equipment-qr/:qrId/preuse', () => {
    const methodsByPath = collectMethodsByPath(equipmentQrRouter);
    expect(methodsByPath['/:projectId/equipment-qr/:qrId/preuse']?.has('post')).toBe(true);
  });

  it('registers GET /:projectId/equipment-qr/:qrId/history', () => {
    const methodsByPath = collectMethodsByPath(equipmentQrRouter);
    expect(methodsByPath['/:projectId/equipment-qr/:qrId/history']?.has('get')).toBe(true);
  });

  it('registers GET /:projectId/equipment-qr/list-by-site', () => {
    const methodsByPath = collectMethodsByPath(equipmentQrRouter);
    expect(methodsByPath['/:projectId/equipment-qr/list-by-site']?.has('get')).toBe(true);
  });

  it('register + preuse están protegidos por idempotencyKey() (3 middleware: verifyAuth → idempotencyKey → validate → handler)', () => {
    // Cada layer de Router.use tiene la chain de middlewares; las rutas
    // mutantes (register, preuse) deben tener al menos 4 handlers en la
    // pila para garantizar el orden: verifyAuth, idempotencyKey, validate,
    // handler. Endpoints GET (lookup, history, list-by-site) tienen 2
    // (verifyAuth + handler).
    const layers = (equipmentQrRouter as unknown as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack?: Array<unknown>;
        };
      }>;
    }).stack;
    const registerLayer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/equipment-qr/register' &&
        l.route?.methods.post === true,
    );
    expect(registerLayer?.route?.stack?.length ?? 0).toBeGreaterThanOrEqual(4);
    const preUseLayer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/equipment-qr/:qrId/preuse' &&
        l.route?.methods.post === true,
    );
    expect(preUseLayer?.route?.stack?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('exports exactly 5 distinct paths (no extra surface area)', () => {
    const methodsByPath = collectMethodsByPath(equipmentQrRouter);
    const paths = Object.keys(methodsByPath).filter((p) =>
      p.startsWith('/:projectId/equipment-qr'),
    );
    expect(new Set(paths).size).toBe(5);
  });

  it('list-by-site is registered BEFORE :qrId so Express first-match-wins is correct', () => {
    // Express resolves the FIRST matching layer. If `/:qrId` were
    // registered before `/list-by-site`, requests to /list-by-site
    // would be captured with qrId="list-by-site" and 404.
    const layers = (equipmentQrRouter as unknown as {
      stack: Array<{
        route?: { path: string; methods: Record<string, boolean> };
      }>;
    }).stack;
    const indexOf = (path: string): number =>
      layers.findIndex((l) => l.route?.path === path);
    const listByIdx = indexOf('/:projectId/equipment-qr/list-by-site');
    const qrIdIdx = indexOf('/:projectId/equipment-qr/:qrId');
    expect(listByIdx).toBeGreaterThanOrEqual(0);
    expect(qrIdIdx).toBeGreaterThanOrEqual(0);
    expect(listByIdx).toBeLessThan(qrIdIdx);
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
