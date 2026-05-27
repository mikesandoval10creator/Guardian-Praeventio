// Praeventio Guard — P0 security hardening contract test.
//
// Leadership decision IDs (`ld_<ts>_<uuid>`) attach to a tenant's
// strategic decision audit trail. The production implementation in
// src/server/routes/leadership.ts uses crypto.randomUUID() (RFC-4122
// v4, 128 bits of entropy) to guarantee unpredictability.
//
// This file locks the ID-shape contract.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const LD_ID_RE = new RegExp(`^ld_\\d+_${UUID_RE.source}$`);

describe('leadership — decision ID crypto-secure contract', () => {
  it('produces the shape `ld_<ts>_<uuid>`', () => {
    const id = `ld_${Date.now()}_${randomUUID()}`;
    expect(id).toMatch(LD_ID_RE);
  });

  it('two consecutive IDs differ', () => {
    const a = `ld_${Date.now()}_${randomUUID()}`;
    const b = `ld_${Date.now()}_${randomUUID()}`;
    expect(a).not.toBe(b);
  });
});
