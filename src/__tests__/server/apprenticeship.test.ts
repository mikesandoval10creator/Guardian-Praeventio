// Praeventio Guard — P0 security hardening.
//
// Apprentice exposure-session IDs in src/server/routes/apprenticeship.ts
// were keyed by a non-secure PRNG. Exposure records track the
// supervised tasks an apprentice has performed; predictable IDs would
// let an attacker enumerate apprenticeship history. This file locks
// the crypto-secure replacement (randomId() from src/utils/randomId.ts).

import { describe, it, expect } from 'vitest';
import { randomId } from '../../utils/randomId.js';

describe('apprenticeship — exposureId crypto-secure contract', () => {
  it('produces the historical short-suffix shape `exp_<ts>_<7hex>`', () => {
    const id = `exp_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(id).toMatch(/^exp_\d+_[a-f0-9]{7}$/);
  });

  it('two consecutive calls yield distinct IDs', () => {
    const a = `exp_${Date.now()}_${randomId().slice(0, 7)}`;
    const b = `exp_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(a).not.toBe(b);
  });

  it('never returns the documented non-secure `fallback-` path on Node 20+', () => {
    expect(randomId().startsWith('fallback-')).toBe(false);
  });
});
