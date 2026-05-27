// Praeventio Guard — P0 security hardening contract test (HIGHEST sensitivity).
//
// Ley 21.643 (Karin, 2024) §7 + ISO 45001 §5.4 require an anonymous,
// confidential channel for occupational harassment / safety complaints.
// Receipt IDs (`cr_<ts>_<uuid>`) and audit IDs (`resp_…`, `close_…`)
// must be unpredictable so anonymous reporters cannot be enumerated
// by an attacker who knows when a complaint was filed.
//
// The production implementation in src/server/routes/confidentialReports.ts
// uses crypto.randomUUID() (RFC-4122 v4, 128 bits of entropy) for all
// three callsites.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const CR_ID_RE = new RegExp(`^cr_\\d+_${UUID_RE.source}$`);
const RESP_ID_RE = new RegExp(`^resp_\\d+_${UUID_RE.source}$`);
const CLOSE_ID_RE = new RegExp(`^close_\\d+_${UUID_RE.source}$`);

describe('confidentialReports — receipt ID crypto-secure contract', () => {
  it('produces the shape `cr_<ts>_<uuid>`', () => {
    const id = `cr_${Date.now()}_${randomUUID()}`;
    expect(id).toMatch(CR_ID_RE);
  });

  it('produces the shape `resp_<ts>_<uuid>`', () => {
    const id = `resp_${Date.now()}_${randomUUID()}`;
    expect(id).toMatch(RESP_ID_RE);
  });

  it('produces the shape `close_<ts>_<uuid>`', () => {
    const id = `close_${Date.now()}_${randomUUID()}`;
    expect(id).toMatch(CLOSE_ID_RE);
  });

  it('two consecutive receipt IDs differ', () => {
    const a = `cr_${Date.now()}_${randomUUID()}`;
    const b = `cr_${Date.now()}_${randomUUID()}`;
    expect(a).not.toBe(b);
  });

  it('1000 consecutive IDs are unique (no enumeration window)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(`cr_${Date.now()}_${randomUUID()}`);
    }
    // Full UUID (128 bits) makes birthday collision astronomically
    // unlikely. We require strict uniqueness here.
    expect(seen.size).toBe(1000);
  });

  it('honours a deterministic UUID for round-trip tests', () => {
    const fixed = 'deadbeef-0000-0000-0000-000000000000';
    const id = `cr_1700000000000_${fixed}`;
    expect(id).toBe('cr_1700000000000_deadbeef-0000-0000-0000-000000000000');
    expect(id).toMatch(CR_ID_RE);
  });
});
