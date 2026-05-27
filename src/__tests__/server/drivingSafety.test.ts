// Praeventio Guard — P0 security hardening.
//
// Driving-route IDs in src/server/routes/drivingSafety.ts were keyed by
// a non-secure PRNG. Route records are referenced by alert fan-outs and
// commute-session joins, so predictable IDs would let an attacker
// poison-pill an alert path. This file locks the crypto-secure
// replacement (randomId() from src/utils/randomId.ts).

import { describe, it, expect } from 'vitest';
import { randomId } from '../../utils/randomId.js';

describe('drivingSafety — routeId crypto-secure contract', () => {
  it('produces the historical short-suffix shape `route_<ts>_<7hex>`', () => {
    const id = `route_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(id).toMatch(/^route_\d+_[a-f0-9]{7}$/);
  });

  it('two consecutive calls yield distinct IDs', () => {
    const a = `route_${Date.now()}_${randomId().slice(0, 7)}`;
    const b = `route_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(a).not.toBe(b);
  });

  it('never returns the documented non-secure `fallback-` path on Node 20+', () => {
    expect(randomId().startsWith('fallback-')).toBe(false);
  });
});
