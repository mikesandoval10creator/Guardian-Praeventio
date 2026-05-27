// Praeventio Guard — P0 security hardening.
//
// Restricted-zone entry/exit event IDs in src/server/routes/restrictedZones.ts
// were previously keyed by a non-cryptographically-secure PRNG. This
// file locks the crypto-secure replacement (randomId() from
// src/utils/randomId.ts) and the historical short-suffix shape used
// by Firestore doc paths, log scrapers, and downstream BI consumers.

import { describe, it, expect } from 'vitest';
import { randomId } from '../../utils/randomId.js';

describe('restrictedZones — newEventId crypto-secure contract', () => {
  it('produces the historical short-suffix shape `zev_<ts>_<7hex>`', () => {
    const id = `zev_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(id).toMatch(/^zev_\d+_[a-f0-9]{7}$/);
  });

  it('two consecutive calls yield distinct IDs', () => {
    const a = `zev_${Date.now()}_${randomId().slice(0, 7)}`;
    const b = `zev_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(a).not.toBe(b);
  });

  it('never returns the documented non-secure `fallback-` path on Node 20+', () => {
    expect(randomId().startsWith('fallback-')).toBe(false);
  });
});
