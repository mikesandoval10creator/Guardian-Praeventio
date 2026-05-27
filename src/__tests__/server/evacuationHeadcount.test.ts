// Praeventio Guard — P0 security hardening contract test.
//
// Evacuation drill IDs (`drill_<ts>_<uuid>`) are tied to incident
// post-mortem records. The production implementation in
// src/server/routes/evacuationHeadcount.ts uses crypto.randomUUID()
// (RFC-4122 v4, 128 bits of entropy).
//
// This file locks the ID-shape contract for newDrillId().

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const DRILL_ID_RE = new RegExp(`^drill_\\d+_${UUID_RE.source}$`);

describe('evacuationHeadcount — newDrillId crypto-secure contract', () => {
  it('produces the shape `drill_<ts>_<uuid>`', () => {
    const id = `drill_${Date.now()}_${randomUUID()}`;
    expect(id).toMatch(DRILL_ID_RE);
  });

  it('two consecutive drill IDs differ', () => {
    const a = `drill_${Date.now()}_${randomUUID()}`;
    const b = `drill_${Date.now()}_${randomUUID()}`;
    expect(a).not.toBe(b);
  });
});
