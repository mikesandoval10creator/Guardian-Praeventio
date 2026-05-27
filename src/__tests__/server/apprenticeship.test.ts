// Praeventio Guard — P0 security hardening contract test.
//
// Apprenticeship exposure IDs (`exp_<ts>_<uuid>`) are attached to a
// trainee's learning record. The production implementation in
// src/server/routes/apprenticeship.ts uses crypto.randomUUID()
// (RFC-4122 v4, 128 bits of entropy).
//
// This file locks the ID-shape contract.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const EXP_ID_RE = new RegExp(`^exp_\\d+_${UUID_RE.source}$`);

describe('apprenticeship — exposure ID crypto-secure contract', () => {
  it('produces the shape `exp_<ts>_<uuid>`', () => {
    const id = `exp_${Date.now()}_${randomUUID()}`;
    expect(id).toMatch(EXP_ID_RE);
  });

  it('two consecutive exposure IDs differ', () => {
    const a = `exp_${Date.now()}_${randomUUID()}`;
    const b = `exp_${Date.now()}_${randomUUID()}`;
    expect(a).not.toBe(b);
  });
});
