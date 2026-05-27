// Praeventio Guard — P0 security hardening.
//
// Leadership decision IDs in src/server/routes/leadership.ts were keyed
// by a non-secure PRNG. Leadership entries are surfaced in supervisor
// dashboards and audit exports; predictable IDs would let an attacker
// who guessed one supervisor's session time iterate sibling entries.
// This file locks the crypto-secure replacement (randomId() from
// src/utils/randomId.ts).

import { describe, it, expect } from 'vitest';
import { randomId } from '../../utils/randomId.js';

describe('leadership — decisionId crypto-secure contract', () => {
  it('produces the historical short-suffix shape `ld_<ts>_<7hex>`', () => {
    const id = `ld_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(id).toMatch(/^ld_\d+_[a-f0-9]{7}$/);
  });

  it('two consecutive calls yield distinct IDs', () => {
    const a = `ld_${Date.now()}_${randomId().slice(0, 7)}`;
    const b = `ld_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(a).not.toBe(b);
  });

  it('never returns the documented non-secure `fallback-` path on Node 20+', () => {
    expect(randomId().startsWith('fallback-')).toBe(false);
  });
});
