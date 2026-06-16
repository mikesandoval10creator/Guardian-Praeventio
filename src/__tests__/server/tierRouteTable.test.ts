// Unit tests for the central tier-gating policy table + ADR-0021 invariant.

import { describe, it, expect, afterEach } from 'vitest';
import {
  TIER_ROUTE_TABLE,
  LIFE_SAFETY_MOUNTS,
  mountsOverlap,
  assertNoLifeSafetyInTable,
  tierGateEnforced,
} from '../../server/middleware/tierRouteTable.js';
import { PLAN_RANK } from '../../services/pricing/subscriptionPlan.js';

describe('tierRouteTable — ADR 0021 invariant', () => {
  it('the live table never gates a life-safety mount (does not throw)', () => {
    expect(() => assertNoLifeSafetyInTable()).not.toThrow();
  });

  it('every gated entry resolves to a known, paid plan rank', () => {
    for (const entry of TIER_ROUTE_TABLE) {
      expect(PLAN_RANK[entry.minPlan]).toBeGreaterThan(0); // never `free`
      expect(entry.mount.startsWith('/api/')).toBe(true);
      expect(entry.feature.length).toBeGreaterThan(0);
    }
  });

  it('no table entry overlaps any life-safety mount', () => {
    for (const entry of TIER_ROUTE_TABLE) {
      for (const life of LIFE_SAFETY_MOUNTS) {
        expect(
          mountsOverlap(entry.mount, life),
          `${entry.mount} must not overlap ${life}`,
        ).toBe(false);
      }
    }
  });
});

describe('tierRouteTable — mountsOverlap semantics', () => {
  it('does NOT collide sibling sub-paths sharing a wildcard prefix', () => {
    // The crux: portable-history (a worker's OWN free record) and multi-project
    // (paid analytics) both live under /api/sprint-k/:projectId — they MUST be
    // treated as distinct so gating one never gates the other.
    expect(
      mountsOverlap('/api/sprint-k/*/multi-project', '/api/sprint-k/*/portable-history'),
    ).toBe(false);
  });

  it('treats `*` as a wildcard segment', () => {
    expect(mountsOverlap('/api/sprint-k/*/multi-project', '/api/sprint-k/p1/multi-project')).toBe(true);
  });

  it('flags a child of a life mount as overlapping', () => {
    expect(mountsOverlap('/api/emergency/declare', '/api/emergency')).toBe(true);
  });

  it('does not flag unrelated mounts', () => {
    expect(mountsOverlap('/api/insights', '/api/emergency')).toBe(false);
  });

  it('a mis-edit that gates an emergency route is rejected by the invariant', () => {
    // Simulate assertNoLifeSafetyInTable over a poisoned entry.
    const poisoned = { mount: '/api/emergency/escalate', minPlan: 'platino' as const, feature: 'x' };
    const overlaps = LIFE_SAFETY_MOUNTS.some((life) => mountsOverlap(poisoned.mount, life));
    expect(overlaps).toBe(true);
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
