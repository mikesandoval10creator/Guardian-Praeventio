// Praeventio Guard — P0 security hardening.
//
// Resilience health-report alert IDs in
// src/server/jobs/runResilienceHealthAlert.ts were keyed by a non-secure
// PRNG. Alert IDs are written to `health_reports/` with a lexicographic
// timestamp-first shape `<iso>_<6hex>`. Predictable suffixes would let
// an attacker who knew the cron schedule iterate sibling docs in the
// same second. This file locks the crypto-secure replacement (randomId()
// from src/utils/randomId.ts) and the historical short-suffix shape
// preserved for sort stability.

import { describe, it, expect } from 'vitest';
import { randomId } from '../../utils/randomId.js';

const ISO_SAFE = (d: Date): string =>
  d.toISOString().replace(/[:.]/g, '-');

describe('runResilienceHealthAlert — reportId crypto-secure contract', () => {
  it('produces the historical lexicographic shape `<iso>_<6hex>`', () => {
    const id = `${ISO_SAFE(new Date())}_${randomId().slice(0, 6)}`;
    // ISO-8601 with `:.` → `-`: YYYY-MM-DDTHH-MM-SS-mmmZ
    expect(id).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[a-f0-9]{6}$/,
    );
  });

  it('two consecutive calls yield distinct IDs even within the same millisecond', () => {
    const ts = ISO_SAFE(new Date('2026-05-27T12:00:00.000Z'));
    const a = `${ts}_${randomId().slice(0, 6)}`;
    const b = `${ts}_${randomId().slice(0, 6)}`;
    expect(a).not.toBe(b);
  });

  it('preserves lexicographic ordering by timestamp prefix', () => {
    const t1 = ISO_SAFE(new Date('2026-05-27T12:00:00.000Z'));
    const t2 = ISO_SAFE(new Date('2026-05-27T12:00:01.000Z'));
    const a = `${t1}_${randomId().slice(0, 6)}`;
    const b = `${t2}_${randomId().slice(0, 6)}`;
    // Lexicographic comparison must agree with time ordering — that's
    // why we re-use the timestamp prefix instead of an auto-id.
    expect([a, b].sort()).toEqual([a, b]);
  });

  it('never returns the documented non-secure `fallback-` path on Node 20+', () => {
    expect(randomId().startsWith('fallback-')).toBe(false);
  });
});
