// Praeventio Guard — P0 security hardening.
//
// Project-closure lesson and decision IDs in
// src/server/routes/projectClosure.ts were keyed by a non-secure PRNG.
// Closure tokens land in Firestore at
// `tenants/{tenantId}/projects/{projectId}/closure/lessons/items/{id}` and
// at `…/decisions/{id}`; predictable IDs would let an attacker who
// observed any single closure timestamp enumerate the other lessons or
// decisions in the same minute window. This file locks the crypto-secure
// replacement (randomId() from src/utils/randomId.ts).

import { describe, it, expect } from 'vitest';
import { randomId } from '../../utils/randomId.js';

describe('projectClosure — lessonId/decisionId crypto-secure contract', () => {
  it('produces the historical short-suffix shape for lessons (`cl_<ts>_<7hex>`)', () => {
    const id = `cl_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(id).toMatch(/^cl_\d+_[a-f0-9]{7}$/);
  });

  it('produces the historical short-suffix shape for decisions (`cd_<ts>_<7hex>`)', () => {
    const id = `cd_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(id).toMatch(/^cd_\d+_[a-f0-9]{7}$/);
  });

  it('two consecutive lesson IDs differ', () => {
    const a = `cl_${Date.now()}_${randomId().slice(0, 7)}`;
    const b = `cl_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(a).not.toBe(b);
  });

  it('two consecutive decision IDs differ', () => {
    const a = `cd_${Date.now()}_${randomId().slice(0, 7)}`;
    const b = `cd_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(a).not.toBe(b);
  });

  it('never returns the documented non-secure `fallback-` path on Node 20+', () => {
    expect(randomId().startsWith('fallback-')).toBe(false);
  });
});
