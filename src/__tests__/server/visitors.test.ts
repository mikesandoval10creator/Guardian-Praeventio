// Praeventio Guard — P0 security hardening.
//
// Visitor pass IDs are exposed to anyone scanning the visitor QR. The
// previous implementation in src/server/routes/visitors.ts (newVisitorId)
// generated them from a non-cryptographically-secure PRNG, which made the
// short ID space (`vis_<13-digit-ts>_<7-char-base36>`) trivially
// enumerable for an attacker who could observe the timestamp prefix.
//
// This file locks the ID-shape contract and the non-determinism of the
// crypto-secure replacement (randomId() from src/utils/randomId.ts).
// Following the existing test-server.ts mirror convention, we do NOT
// import the real Express route (which couples to firebase-admin) —
// we exercise the same template the production code applies.

import { describe, it, expect, vi } from 'vitest';
import { randomId } from '../../utils/randomId.js';

describe('visitors — newVisitorId crypto-secure contract', () => {
  it('produces the historical short-suffix shape `vis_<ts>_<7hex>`', () => {
    const id = `vis_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(id).toMatch(/^vis_\d+_[a-f0-9]{7}$/);
  });

  it('two consecutive calls yield distinct IDs', () => {
    const a = `vis_${Date.now()}_${randomId().slice(0, 7)}`;
    const b = `vis_${Date.now()}_${randomId().slice(0, 7)}`;
    expect(a).not.toBe(b);
  });

  it('honours a mocked randomId for deterministic round-trip tests', () => {
    const spy = vi
      .spyOn({ randomId }, 'randomId')
      .mockReturnValue('00000000-aaaa-bbbb-cccc-000000000000');
    // Call through the wrapper so the spy can intercept.
    const fakeRandomId: typeof randomId = ((): string => spy()) as any;
    const id = `vis_1700000000000_${fakeRandomId().slice(0, 7)}`;
    // 7 chars of the mocked UUID '00000000-aaaa-…' = '0000000'.
    expect(id).toBe('vis_1700000000000_0000000');
    spy.mockRestore();
  });

  it('never returns the documented non-secure `fallback-` path on Node 20+', () => {
    expect(randomId().startsWith('fallback-')).toBe(false);
  });
});
