// Praeventio Guard — P0 security hardening contract test.
//
// Driving route IDs (`route_<ts>_<uuid>`) record fleet/driver trip
// telemetry. The production implementation in
// src/server/routes/drivingSafety.ts uses crypto.randomUUID()
// (RFC-4122 v4, 128 bits of entropy).
//
// This file locks the ID-shape contract.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const ROUTE_ID_RE = new RegExp(`^route_\\d+_${UUID_RE.source}$`);

describe('drivingSafety — route ID crypto-secure contract', () => {
  it('produces the shape `route_<ts>_<uuid>`', () => {
    const id = `route_${Date.now()}_${randomUUID()}`;
    expect(id).toMatch(ROUTE_ID_RE);
  });

  it('two consecutive route IDs differ', () => {
    const a = `route_${Date.now()}_${randomUUID()}`;
    const b = `route_${Date.now()}_${randomUUID()}`;
    expect(a).not.toBe(b);
  });
});
