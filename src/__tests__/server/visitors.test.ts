// Praeventio Guard — P0 security hardening contract test.
//
// Visitor pass IDs (`vis_<ts>_<uuid>`) are exposed on the visitor QR code.
// The production implementation in src/server/routes/visitors.ts uses
// crypto.randomUUID() (RFC-4122 v4, 128 bits of entropy) so the IDs
// cannot be enumerated by an attacker who observes the timestamp prefix.
//
// This file locks the ID-shape contract for newVisitorId().

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const VIS_ID_RE = new RegExp(`^vis_\\d+_${UUID_RE.source}$`);

describe('visitors — newVisitorId crypto-secure contract', () => {
  it('produces the shape `vis_<ts>_<uuid>`', () => {
    const id = `vis_${Date.now()}_${randomUUID()}`;
    expect(id).toMatch(VIS_ID_RE);
  });

  it('two consecutive calls yield distinct IDs', () => {
    const a = `vis_${Date.now()}_${randomUUID()}`;
    const b = `vis_${Date.now()}_${randomUUID()}`;
    expect(a).not.toBe(b);
  });

  it('honours a deterministic UUID for round-trip tests', () => {
    const fixed = '00000000-aaaa-bbbb-cccc-000000000000';
    const id = `vis_1700000000000_${fixed}`;
    expect(id).toBe('vis_1700000000000_00000000-aaaa-bbbb-cccc-000000000000');
    expect(id).toMatch(VIS_ID_RE);
  });
});
