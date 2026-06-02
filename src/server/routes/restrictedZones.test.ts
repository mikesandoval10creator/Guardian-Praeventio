// Praeventio Guard — restrictedZones router contract tests.
//
// Wire-up contract: verify the router exposes the documented endpoints
// at the documented HTTP methods. Behavioural tests for the underlying
// engine live in `src/services/zones/restrictedZonesEngine.test.ts`.

import { describe, it, expect } from 'vitest';
import restrictedZonesRouter from './restrictedZones';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (restrictedZonesRouter as unknown as { stack: Layer[] }).stack;

function hasMethod(
  path: string,
  method: 'get' | 'post' | 'put' | 'delete',
): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods[method] === true,
  );
}

describe('restrictedZonesRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(restrictedZonesRouter).toBeDefined();
    expect(typeof restrictedZonesRouter).toBe('function');
  });

  it('registers POST /define', () => {
    expect(hasMethod('/define', 'post')).toBe(true);
  });

  it('registers GET /by-site/:projectId', () => {
    expect(hasMethod('/by-site/:projectId', 'get')).toBe(true);
  });

  it('registers POST /check', () => {
    expect(hasMethod('/check', 'post')).toBe(true);
  });

  it('registers POST /entry-event', () => {
    expect(hasMethod('/entry-event', 'post')).toBe(true);
  });

  it('registers GET /entry-permissions/:projectId/:workerUid', () => {
    expect(
      hasMethod('/entry-permissions/:projectId/:workerUid', 'get'),
    ).toBe(true);
  });

  it('no route registers a DELETE method (founder directive: never block)', () => {
    // We do not expose a "remove zone" path that could be misused as
    // "block worker by destroying the zone they would otherwise be
    // recommended away from". Zone lifecycle is purely additive +
    // time-bound (activeUntil) per the engine contract.
    const anyDelete = layers.some(
      (l) => l.route?.methods.delete === true,
    );
    expect(anyDelete).toBe(false);
  });

  it('exposes exactly the documented endpoints (no orphans)', () => {
    const routes = layers
      .map((l) => l.route)
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => r.path)
      .sort();
    expect(routes).toEqual(
      [
        '/by-site/:projectId',
        '/check',
        '/define',
        '/entry-event',
        '/entry-permissions/:projectId/:workerUid',
      ].sort(),
    );
  });
});
