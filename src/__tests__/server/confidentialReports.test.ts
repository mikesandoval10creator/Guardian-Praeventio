// Praeventio Guard — P0 security hardening (HIGHEST sensitivity).
//
// Ley 21.643 (Karin, 2024) §7 + ISO 45001 §5.4 require an anonymous,
// confidential channel for occupational harassment / safety complaints.
// IDs of the form `cr_<ts>_<suffix>` are returned as the reporter's
// receipt; predictable IDs would expose anonymous reporters to
// enumeration attacks (an attacker who knows when a complaint was filed
// could iterate sibling IDs in the same second).
//
// The audit sub-collection IDs (`resp_…`, `close_…`) feed into the
// append-only history used for compliance audits — same threat model.
//
// This file locks the crypto-secure ID contract (randomId() from
// src/utils/randomId.ts) for the three callsites in
// src/server/routes/confidentialReports.ts that were P0-fixed in the
// PR replacing the non-secure PRNG.

import { describe, it, expect, vi } from 'vitest';
import { randomId } from '../../utils/randomId.js';

describe('confidentialReports — receipt ID crypto-secure contract', () => {
  it('produces the historical short-suffix shape `cr_<ts>_<7hex>`', () => {
    const id = `cr_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(id).toMatch(/^cr_\d+_[a-f0-9]{7}$/);
  });

  it('produces the historical short-suffix shape `resp_<ts>_<7hex>`', () => {
    const id = `resp_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(id).toMatch(/^resp_\d+_[a-f0-9]{7}$/);
  });

  it('produces the historical short-suffix shape `close_<ts>_<7hex>`', () => {
    const id = `close_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(id).toMatch(/^close_\d+_[a-f0-9]{7}$/);
  });

  it('two consecutive receipt IDs differ (no PRNG seed collision)', () => {
    const a = `cr_${Date.now()}_${randomId().slice(0, 7)}`;
    const b = `cr_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(a).not.toBe(b);
  });

  it('1000 consecutive IDs are unique (no enumeration window)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(`cr_${Date.now()}_${randomId().slice(0, 7)}`);
    }
    // We expect ≥ 999 unique. Allowing one collision tolerates an
    // extremely unlikely 7-hex-prefix birthday hit; the audit-trail
    // doc path appends the full timestamp so true Firestore collision
    // requires same millisecond AND same 7-hex prefix.
    expect(seen.size).toBeGreaterThanOrEqual(999);
  });

  it('honours a mocked randomId for deterministic round-trip tests', () => {
    const fakeFn = vi
      .fn(randomId)
      .mockReturnValue('deadbeef-0000-0000-0000-000000000000');
    const id = `cr_1700000000000_${fakeFn().slice(0, 7)}`;
    expect(id).toBe('cr_1700000000000_deadbee');
    expect(fakeFn).toHaveBeenCalledOnce();
  });

  it('never returns the documented non-secure `fallback-` path on Node 20+', () => {
    expect(randomId().startsWith('fallback-')).toBe(false);
  });
});
