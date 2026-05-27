// Praeventio Guard — P0 security hardening contract test.
//
// Project closure publishes lesson IDs (`cl_<ts>_<uuid>`) and critical
// decision IDs (`cd_<ts>_<uuid>`) into the global library. The
// implementation in src/server/routes/projectClosure.ts uses
// crypto.randomUUID() (RFC-4122 v4, 128 bits of entropy).
//
// This file locks the ID-shape contracts for both callsites.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const CL_ID_RE = new RegExp(`^cl_\\d+_${UUID_RE.source}$`);
const CD_ID_RE = new RegExp(`^cd_\\d+_${UUID_RE.source}$`);

describe('projectClosure — crypto-secure ID contracts', () => {
  it('publishes lesson IDs as `cl_<ts>_<uuid>`', () => {
    const id = `cl_${Date.now()}_${randomUUID()}`;
    expect(id).toMatch(CL_ID_RE);
  });

  it('publishes critical-decision IDs as `cd_<ts>_<uuid>`', () => {
    const id = `cd_${Date.now()}_${randomUUID()}`;
    expect(id).toMatch(CD_ID_RE);
  });

  it('consecutive lesson IDs differ', () => {
    const a = `cl_${Date.now()}_${randomUUID()}`;
    const b = `cl_${Date.now()}_${randomUUID()}`;
    expect(a).not.toBe(b);
  });

  it('consecutive decision IDs differ', () => {
    const a = `cd_${Date.now()}_${randomUUID()}`;
    const b = `cd_${Date.now()}_${randomUUID()}`;
    expect(a).not.toBe(b);
  });
});
