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

/** Pull the inlined `resolveNotificationDeepLinkPath` out of the SW file and
 *  build a callable from it (the SW's top-level `importScripts` can't run in
 *  Node, so we can't just require the whole file). */
function loadSwResolver(): (data: unknown) => string {
  const src = readFileSync(swPath, 'utf8');
  const match = src.match(
    /function resolveNotificationDeepLinkPath\(data\) \{[\s\S]*?\n\}/,
  );
  if (!match) {
    throw new Error('resolveNotificationDeepLinkPath not found in service worker');
  }
  const factory = new Function(`${match[0]}\nreturn resolveNotificationDeepLinkPath;`);
  return factory() as (data: unknown) => string;
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
  const swResolve = loadSwResolver();

  it.each(CASES)('SW path matches TS contract for %o', (data) => {
    expect(swResolve(data)).toBe(resolveNotificationDeepLink(data).url);
  });
});
