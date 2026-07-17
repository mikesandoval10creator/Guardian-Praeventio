// Praeventio Guard — service-worker deep-link parity (drift guard).
//
// The web service worker (public/firebase-messaging-sw.js) cannot import the
// TS deep-link contract, so it inlines a copy (`resolveNotificationDeepLinkPath`).
// This test extracts that inlined function from the shipped SW file, evaluates
// it, and asserts it produces the SAME in-app path as the TS source of truth
// for every known alert shape. If someone edits one copy and not the other,
// this fails — the two can never silently drift.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveNotificationDeepLink } from './notificationDeepLink';

const swPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/firebase-messaging-sw.js',
);

/** Pull a named top-level `function <name>(...) { ... }` out of the SW file and
 *  build a callable from it (the SW's top-level `importScripts` can't run in
 *  Node, so we can't just require the whole file). */
function loadSwFunction<T>(name: string): T {
  const src = readFileSync(swPath, 'utf8');
  const re = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`);
  const match = src.match(re);
  if (!match) {
    throw new Error(`${name} not found in service worker`);
  }
  const factory = new Function(`${match[0]}\nreturn ${name};`);
  return factory() as T;
}

const CASES: Array<Record<string, string>> = [
  { projectId: 'p1', alertId: 'a1', type: 'sos', uid: 'u1' },
  { projectId: 'p2', emergencyType: 'hazmat_zone', timestamp: 't' },
  { projectId: 'p3', incidentId: 'inc-42' },
  { projectId: 'p4', nodeId: 'n1' },
  { alertId: 'a-only' },
  {},
];

describe('service worker deep-link parity', () => {
  const swResolve = loadSwFunction<(data: unknown) => string>(
    'resolveNotificationDeepLinkPath',
  );

  it.each(CASES)('SW path matches TS contract for %o', (data) => {
    expect(swResolve(data)).toBe(resolveNotificationDeepLink(data).url);
  });
});

describe('service worker unwrapNotificationData', () => {
  const unwrap = loadSwFunction<(raw: unknown) => Record<string, string>>(
    'unwrapNotificationData',
  );
  const swResolve = loadSwFunction<(data: unknown) => string>(
    'resolveNotificationDeepLinkPath',
  );

  it('unwraps Firebase auto-display FCM_MSG so the resolver sees the real data', () => {
    const original = { projectId: 'p1', alertId: 'a1', type: 'sos' };
    const wrapped = { FCM_MSG: { data: original } };
    expect(unwrap(wrapped)).toEqual(original);
    // and the resolved path matches the TS contract for the unwrapped data
    expect(swResolve(unwrap(wrapped))).toBe(resolveNotificationDeepLink(original).url);
  });

  it('passes raw (already-unwrapped) data through untouched', () => {
    const raw = { projectId: 'p2', nodeId: 'n9' };
    expect(unwrap(raw)).toEqual(raw);
  });

  it('returns an empty object for missing/invalid data', () => {
    expect(unwrap(undefined)).toEqual({});
    expect(unwrap(null)).toEqual({});
  });
});
