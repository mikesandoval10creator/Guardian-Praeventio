// Unit tests for the central tier-gating policy table + ADR-0021 invariant.

import { describe, it, expect, afterEach } from 'vitest';
import {
  TIER_ROUTE_TABLE,
  isLifeSafetyMount,
  assertNoLifeSafetyInTable,
  tierGateEnforced,
} from '../../server/middleware/tierRouteTable.js';
import { PLAN_RANK } from '../../services/pricing/subscriptionPlan.js';

describe('tierRouteTable — ADR 0021 invariant', () => {
  it('the live table never gates a life-safety feature (does not throw)', () => {
    expect(() => assertNoLifeSafetyInTable()).not.toThrow();
  });

  it('every gated entry resolves to a known, paid plan rank under /api', () => {
    for (const entry of TIER_ROUTE_TABLE) {
      expect(PLAN_RANK[entry.minPlan]).toBeGreaterThan(0); // never `free`
      expect(entry.mount.startsWith('/api/')).toBe(true);
      expect(entry.feature.length).toBeGreaterThan(0);
    }
  });

  it('no table entry names a life-safety keyword', () => {
    for (const entry of TIER_ROUTE_TABLE) {
      expect(isLifeSafetyMount(entry.mount), `${entry.mount} must not be life-safety`).toBe(false);
    }
  });
});

describe('tierRouteTable — isLifeSafetyMount semantics', () => {
  it('flags life-safety mounts regardless of prefix DEPTH (the review gap)', () => {
    // Top-level AND nested-under-sprint-k life routes must both be caught — a
    // keyword match doesn't depend on the (drift-prone) exact mount prefix.
    expect(isLifeSafetyMount('/api/emergency')).toBe(true);
    expect(isLifeSafetyMount('/api/incidents')).toBe(true);
    expect(isLifeSafetyMount('/api/sprint-k/*/emergency-brigade')).toBe(true);
    expect(isLifeSafetyMount('/api/sprint-k/*/evacuation-headcount')).toBe(true);
    expect(isLifeSafetyMount('/api/sprint-k/*/workers/*/portable-history')).toBe(true);
    expect(isLifeSafetyMount('/api/sprint-k/*/lone-worker')).toBe(true);
  });

  it('does NOT flag the gated analytics/portfolio mounts', () => {
    expect(isLifeSafetyMount('/api/insights')).toBe(false);
    expect(isLifeSafetyMount('/api/sprint-k/*/multi-project')).toBe(false);
    expect(isLifeSafetyMount('/api/sprint-k/*/maturity-index')).toBe(false);
    expect(isLifeSafetyMount('/api/sprint-k/*/role-summary')).toBe(false);
    expect(isLifeSafetyMount('/api/drive')).toBe(false);
  });
});

describe('tierRouteTable — rollout flag', () => {
  const original = process.env.TIER_GATE_ENFORCE;
  afterEach(() => {
    if (original === undefined) delete process.env.TIER_GATE_ENFORCE;
    else process.env.TIER_GATE_ENFORCE = original;
  });

  it('defaults to report-only', () => {
    delete process.env.TIER_GATE_ENFORCE;
    expect(tierGateEnforced()).toBe(false);
  });

  it('enforces only on the exact string "true"', () => {
    process.env.TIER_GATE_ENFORCE = 'true';
    expect(tierGateEnforced()).toBe(true);
    process.env.TIER_GATE_ENFORCE = '1';
    expect(tierGateEnforced()).toBe(false);
  });
});
