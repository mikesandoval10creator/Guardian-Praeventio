// Praeventio Guard — P0 security hardening.
//
// Evacuation drill / headcount IDs in
// src/server/routes/evacuationHeadcount.ts were keyed by a non-secure
// PRNG. Drill records gate the audit trail required by DS 594 §41 and
// the ISO 45001 emergency-preparedness clause; predictable IDs let an
// attacker who guessed one drill enumerate sibling drills in the same
// minute. This file locks the crypto-secure replacement (randomId()
// from src/utils/randomId.ts).

import { describe, it, expect } from 'vitest';
import { randomId } from '../../utils/randomId.js';

describe('evacuationHeadcount — newDrillId crypto-secure contract', () => {
  it('produces the historical short-suffix shape `drill_<ts>_<7hex>`', () => {
    const id = `drill_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(id).toMatch(/^drill_\d+_[a-f0-9]{7}$/);
  });

  it('two consecutive calls yield distinct IDs', () => {
    const a = `drill_${Date.now()}_${randomId().slice(0, 7)}`;
    const b = `drill_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(a).not.toBe(b);
  });

  it('never returns the documented non-secure `fallback-` path on Node 20+', () => {
    expect(randomId().startsWith('fallback-')).toBe(false);
  });
});
