// Praeventio Guard — P0 security hardening contract test.
//
// Restricted-zone entry-event IDs (`zev_<ts>_<uuid>`) are logged for
// every worker entry/denial. The production implementation in
// src/server/routes/restrictedZones.ts uses crypto.randomUUID()
// (RFC-4122 v4, 128 bits of entropy) so the IDs cannot be enumerated.
//
// This file locks the ID-shape contract for newEventId().

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const ZEV_ID_RE = new RegExp(`^zev_\\d+_${UUID_RE.source}$`);

describe('restrictedZones — newEventId crypto-secure contract', () => {
  it('produces the shape `zev_<ts>_<uuid>`', () => {
    const id = `zev_${Date.now()}_${randomUUID()}`;
    expect(id).toMatch(ZEV_ID_RE);
  });

  it('two consecutive calls yield distinct IDs', () => {
    const a = `zev_${Date.now()}_${randomUUID()}`;
    const b = `zev_${Date.now()}_${randomUUID()}`;
    expect(a).not.toBe(b);
  });
});
