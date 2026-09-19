// Praeventio Guard — Pilot Entitlement Resolver tests.
//
// Covers the pure helpers and the server-side resolver. The resolver
// tests use an injected `firestore` stub to avoid touching real Firestore
// (consistent with the rest of the codebase's resolver tests).

import { describe, it, expect } from 'vitest';
import {
  choosePlanByPrecedence,
  coercePilotDoc,
  isPilotActiveAt,
  pickBestPilot,
  resolveEffectivePlan,
  type PilotEntitlementDoc,
  type ResolveEffectivePlanResult,
} from './pilotEntitlementResolver.js';
import { PLAN_RANK } from '../../services/pricing/subscriptionPlan.js';

// ── Helpers ────────────────────────────────────────────────────────────

function buildDoc(overrides: Partial<PilotEntitlementDoc> = {}): PilotEntitlementDoc {
  return {
    pilotId: overrides.pilotId ?? 'pilot_001',
    organizationId: overrides.organizationId ?? 'org_001',
    grantedTierId: overrides.grantedTierId ?? 'plata',
    startsAt: overrides.startsAt ?? '2026-09-01T00:00:00Z',
    endsAt: overrides.endsAt ?? '2026-12-01T00:00:00Z',
    campaign: overrides.campaign ?? 'pilot-2026-q4',
    cohort: overrides.cohort ?? 'cohort-A',
    origin: overrides.origin ?? 'manual_admin',
    grantedBy: overrides.grantedBy ?? { uid: 'admin_001', email: 'admin@example.com' },
    grantedAt: overrides.grantedAt ?? '2026-08-30T00:00:00Z',
    status: overrides.status ?? 'active',
    ...overrides,
  };
}

// ── isPilotActiveAt ─────────────────────────────────────────────────────

describe('isPilotActiveAt', () => {
  it('returns true when now is inside the window', () => {
    expect(
      isPilotActiveAt('2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z', new Date('2026-10-15T12:00:00Z')),
    ).toBe(true);
  });

  it('returns true at the exact start instant (inclusive lower bound)', () => {
    expect(
      isPilotActiveAt('2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z', new Date('2026-09-01T00:00:00Z')),
    ).toBe(true);
  });

  it('returns true at the exact end instant (inclusive upper bound — protects against off-by-one downgrade)', () => {
    expect(
      isPilotActiveAt('2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z', new Date('2026-12-01T00:00:00Z')),
    ).toBe(true);
  });

  it('returns false before the start instant', () => {
    expect(
      isPilotActiveAt('2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z', new Date('2026-08-31T23:59:59Z')),
    ).toBe(false);
  });

  it('returns false after the end instant', () => {
    expect(
      isPilotActiveAt('2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z', new Date('2026-12-01T00:00:01Z')),
    ).toBe(false);
  });

  it('returns false when start or end are unparseable', () => {
    expect(isPilotActiveAt('garbage', '2026-12-01T00:00:00Z', new Date('2026-10-15T12:00:00Z'))).toBe(false);
    expect(isPilotActiveAt('2026-09-01T00:00:00Z', 'garbage', new Date('2026-10-15T12:00:00Z'))).toBe(false);
  });
});

// ── pickBestPilot ───────────────────────────────────────────────────────

describe('pickBestPilot', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('returns null when no pilots exist', () => {
    expect(pickBestPilot([], now)).toBe(null);
  });

  it('returns null when all pilots are outside the window', () => {
    const past = buildDoc({ endsAt: '2026-08-01T00:00:00Z' });
    const future = buildDoc({ pilotId: 'p2', startsAt: '2027-01-01T00:00:00Z' });
    expect(pickBestPilot([past, future], now)).toBe(null);
  });

  it('skips revoked and expired pilots', () => {
    const revoked = buildDoc({ status: 'revoked', pilotId: 'p1' });
    const expired = buildDoc({ status: 'expired', pilotId: 'p2' });
    const active = buildDoc({ status: 'active', pilotId: 'p3' });
    expect(pickBestPilot([revoked, expired, active], now)?.pilotId).toBe('p3');
  });

  it('picks the highest-rank active pilot', () => {
    const cobre = buildDoc({ pilotId: 'p1', grantedTierId: 'cobre' });
    const oro = buildDoc({ pilotId: 'p2', grantedTierId: 'oro' });
    const titanio = buildDoc({ pilotId: 'p3', grantedTierId: 'titanio' });
    expect(pickBestPilot([cobre, oro, titanio], now)?.pilotId).toBe('p3');
  });

  it('breaks rank ties by longest remaining window', () => {
    const shortEnd = buildDoc({
      pilotId: 'p1',
      grantedTierId: 'plata',
      endsAt: '2026-11-01T00:00:00Z',
    });
    const longEnd = buildDoc({
      pilotId: 'p2',
      grantedTierId: 'plata',
      endsAt: '2027-06-01T00:00:00Z',
    });
    expect(pickBestPilot([shortEnd, longEnd], now)?.pilotId).toBe('p2');
  });

  it('skips docs whose tier is not a recognized subscription plan', () => {
    const garbage = buildDoc({ grantedTierId: 'unknown-tier' as PilotEntitlementDoc['grantedTierId'] });
    const good = buildDoc({ pilotId: 'p2' });
    expect(pickBestPilot([garbage, good], now)?.pilotId).toBe('p2');
  });
});

// ── choosePlanByPrecedence ──────────────────────────────────────────────

describe('choosePlanByPrecedence', () => {
  it('returns paid when only paid is set', () => {
    expect(choosePlanByPrecedence('oro', null)).toEqual({
      planId: 'oro',
      reason: 'paid_subscription',
    });
  });

  it('returns pilot when only pilot is set', () => {
    expect(choosePlanByPrecedence(null, 'oro')).toEqual({
      planId: 'oro',
      reason: 'pilot_grant',
    });
  });

  it('returns free when neither is set', () => {
    expect(choosePlanByPrecedence(null, null)).toEqual({
      planId: 'free',
      reason: 'free_fallback',
    });
  });

  it('paid wins when paid rank >= pilot rank', () => {
    expect(choosePlanByPrecedence('oro', 'plata')).toEqual({
      planId: 'oro',
      reason: 'paid_subscription',
    });
    expect(choosePlanByPrecedence('oro', 'oro')).toEqual({
      planId: 'oro',
      reason: 'paid_subscription',
    });
  });

  it('pilot wins when pilot rank > paid rank', () => {
    expect(choosePlanByPrecedence('cobre', 'oro')).toEqual({
      planId: 'oro',
      reason: 'pilot_grant',
    });
    expect(choosePlanByPrecedence('free', 'platino')).toEqual({
      planId: 'platino',
      reason: 'pilot_grant',
    });
  });
});

// ── coercePilotDoc ──────────────────────────────────────────────────────

describe('coercePilotDoc', () => {
  const baseRaw = {
    pilotId: 'pilot_001',
    organizationId: 'org_001',
    grantedTierId: 'plata',
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-12-01T00:00:00Z',
    campaign: 'pilot-2026-q4',
    cohort: 'cohort-A',
    origin: 'manual_admin',
    grantedBy: { uid: 'admin_001', email: 'admin@example.com' },
    grantedAt: '2026-08-30T00:00:00Z',
    status: 'active',
  };

  it('coerces a well-formed doc', () => {
    expect(coercePilotDoc('pilot_001', baseRaw, 'org_001')?.grantedTierId).toBe('plata');
  });

  it('returns null when grantedTierId is missing', () => {
    const { grantedTierId, ...rest } = baseRaw;
    expect(coercePilotDoc('pilot_001', rest, 'org_001')).toBe(null);
  });

  it('returns null when window fields are missing', () => {
    const { startsAt, ...rest } = baseRaw;
    expect(coercePilotDoc('pilot_001', rest, 'org_001')).toBe(null);
  });

  it('returns null when origin is invalid', () => {
    expect(
      coercePilotDoc('pilot_001', { ...baseRaw, origin: 'sneaky' }, 'org_001'),
    ).toBe(null);
  });

  it('returns null when status is invalid', () => {
    expect(
      coercePilotDoc('pilot_001', { ...baseRaw, status: 'pending' }, 'org_001'),
    ).toBe(null);
  });

  it('falls back to docId when pilotId field is missing', () => {
    const { pilotId, ...rest } = baseRaw;
    expect(coercePilotDoc('fallback_id', rest, 'org_001')?.pilotId).toBe('fallback_id');
  });

  it('falls back to caller-supplied organizationId when field is missing', () => {
    const { organizationId, ...rest } = baseRaw;
    expect(coercePilotDoc('pilot_001', rest, 'org_from_caller')?.organizationId).toBe(
      'org_from_caller',
    );
  });
});

// ── resolveEffectivePlan (with injected firestore stub) ─────────────────

type FakeDoc = {
  id: string;
  data: () => Record<string, unknown>;
};

interface FakeFirestore {
  collection(name: string): {
    doc(id: string): { get(): Promise<{ get(field: string): unknown }> };
    where(field: string, op: string, value: unknown): {
      get(): Promise<{ docs: FakeDoc[] }>;
    };
  };
}

function makeFirestore(opts: {
  userDoc?: Record<string, unknown> | null;
  pilotDocs?: Array<Record<string, unknown>>;
}): FakeFirestore {
  return {
    collection(name: string) {
      if (name === 'users') {
        return {
          doc(id: string) {
            return {
              async get() {
                if (opts.userDoc === undefined) throw new Error('users collection unreachable');
                if (opts.userDoc === null) {
                  return { get: () => undefined };
                }
                return {
                  get(field: string) {
                    return opts.userDoc?.[field];
                  },
                };
              },
            };
          },
        };
      }
      if (name === 'organizations') {
        return {
          doc(_id: string) {
            return {
              collection() {
                return {
                  where() {
                    return {
                      async get() {
                        if (opts.pilotDocs === undefined) {
                          throw new Error('pilot collection unreachable');
                        }
                        return {
                          docs: opts.pilotDocs.map((data, idx) => ({
                            id: (data.pilotId as string) ?? `doc_${idx}`,
                            data: () => data,
                          })),
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
}

const NOW = new Date('2026-10-15T12:00:00Z');

describe('resolveEffectivePlan', () => {
  it('returns paid plan when user has active paid subscription and no pilot', async () => {
    const fs = makeFirestore({
      userDoc: {
        subscription: {
          planId: 'oro',
          status: 'active',
          expiryDate: '2027-01-01T00:00:00Z',
        },
      },
      pilotDocs: [],
    });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result).toEqual({
      planId: 'oro',
      reason: 'paid_subscription',
      paidRank: PLAN_RANK.oro,
    });
  });

  it('falls back to free when paid subscription is expired', async () => {
    const fs = makeFirestore({
      userDoc: {
        subscription: {
          planId: 'oro',
          status: 'expired',
          expiryDate: '2026-01-01T00:00:00Z',
        },
      },
      pilotDocs: [],
    });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result.planId).toBe('free');
    expect(result.reason).toBe('free_fallback');
  });

  it('returns pilot plan when user has no paid subscription and pilot is active', async () => {
    const fs = makeFirestore({
      userDoc: null,
      pilotDocs: [
        {
          pilotId: 'pilot_active',
          grantedTierId: 'oro',
          startsAt: '2026-09-01T00:00:00Z',
          endsAt: '2026-12-01T00:00:00Z',
          campaign: 'pilot-2026-q4',
          cohort: 'cohort-A',
          origin: 'manual_admin',
          grantedBy: { uid: 'admin', email: 'admin@example.com' },
          grantedAt: '2026-08-30T00:00:00Z',
          status: 'active',
        },
      ],
    });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result.planId).toBe('oro');
    expect(result.reason).toBe('pilot_grant');
    expect(result.pilotId).toBe('pilot_active');
    expect(result.pilotRank).toBe(PLAN_RANK.oro);
  });

  it('paid wins over pilot when paid rank is higher', async () => {
    const fs = makeFirestore({
      userDoc: {
        subscription: {
          planId: 'platino',
          status: 'active',
          expiryDate: '2027-01-01T00:00:00Z',
        },
      },
      pilotDocs: [
        {
          pilotId: 'pilot_oro',
          grantedTierId: 'oro',
          startsAt: '2026-09-01T00:00:00Z',
          endsAt: '2026-12-01T00:00:00Z',
          campaign: 'pilot-2026-q4',
          cohort: 'cohort-A',
          origin: 'manual_admin',
          grantedBy: { uid: 'admin', email: 'admin@example.com' },
          grantedAt: '2026-08-30T00:00:00Z',
          status: 'active',
        },
      ],
    });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result.planId).toBe('platino');
    expect(result.reason).toBe('paid_subscription');
    expect(result.paidRank).toBe(PLAN_RANK.platino);
  });

  it('pilot wins over paid when pilot rank is higher', async () => {
    const fs = makeFirestore({
      userDoc: {
        subscription: {
          planId: 'cobre',
          status: 'active',
          expiryDate: '2027-01-01T00:00:00Z',
        },
      },
      pilotDocs: [
        {
          pilotId: 'pilot_oro',
          grantedTierId: 'oro',
          startsAt: '2026-09-01T00:00:00Z',
          endsAt: '2026-12-01T00:00:00Z',
          campaign: 'pilot-2026-q4',
          cohort: 'cohort-A',
          origin: 'manual_admin',
          grantedBy: { uid: 'admin', email: 'admin@example.com' },
          grantedAt: '2026-08-30T00:00:00Z',
          status: 'active',
        },
      ],
    });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result.planId).toBe('oro');
    expect(result.reason).toBe('pilot_grant');
    expect(result.pilotId).toBe('pilot_oro');
  });

  it('falls back to free when pilot grant exists but is expired', async () => {
    const fs = makeFirestore({
      userDoc: null,
      pilotDocs: [
        {
          pilotId: 'pilot_old',
          grantedTierId: 'oro',
          startsAt: '2026-01-01T00:00:00Z',
          endsAt: '2026-08-01T00:00:00Z',
          campaign: 'pilot-2026-q2',
          cohort: 'cohort-old',
          origin: 'manual_admin',
          grantedBy: { uid: 'admin', email: 'admin@example.com' },
          grantedAt: '2026-01-01T00:00:00Z',
          status: 'active',
        },
      ],
    });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result.planId).toBe('free');
    expect(result.reason).toBe('free_fallback');
  });

  it('falls back to free when pilot grant is revoked', async () => {
    const fs = makeFirestore({
      userDoc: null,
      pilotDocs: [
        {
          pilotId: 'pilot_revoked',
          grantedTierId: 'oro',
          startsAt: '2026-09-01T00:00:00Z',
          endsAt: '2026-12-01T00:00:00Z',
          campaign: 'pilot-2026-q4',
          cohort: 'cohort-A',
          origin: 'manual_admin',
          grantedBy: { uid: 'admin', email: 'admin@example.com' },
          grantedAt: '2026-08-30T00:00:00Z',
          revokedAt: '2026-10-01T00:00:00Z',
          revokedBy: { uid: 'admin', email: 'admin@example.com' },
          revokeReason: 'user requested end of pilot',
          status: 'revoked',
        },
      ],
    });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result.planId).toBe('free');
    expect(result.reason).toBe('free_fallback');
  });

  it('returns free (never throws) when user doc read fails', async () => {
    const fs = makeFirestore({
      // userDoc undefined → stub throws on get
      pilotDocs: [],
    });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result.planId).toBe('free');
    expect(result.reason).toBe('free_fallback');
  });

  it('returns free (never throws) when pilot collection read fails', async () => {
    const fs = makeFirestore({
      userDoc: null,
      // pilotDocs undefined → stub throws on get
    });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result.planId).toBe('free');
    expect(result.reason).toBe('free_fallback');
  });

  it('selects the highest-rank active pilot when multiple exist for the same org', async () => {
    const fs = makeFirestore({
      userDoc: null,
      pilotDocs: [
        {
          pilotId: 'pilot_plata',
          grantedTierId: 'plata',
          startsAt: '2026-09-01T00:00:00Z',
          endsAt: '2026-12-01T00:00:00Z',
          campaign: 'pilot-2026-q4',
          cohort: 'cohort-A',
          origin: 'manual_admin',
          grantedBy: { uid: 'admin', email: 'admin@example.com' },
          grantedAt: '2026-08-30T00:00:00Z',
          status: 'active',
        },
        {
          pilotId: 'pilot_oro',
          grantedTierId: 'oro',
          startsAt: '2026-09-15T00:00:00Z',
          endsAt: '2026-11-15T00:00:00Z',
          campaign: 'pilot-2026-q4',
          cohort: 'cohort-B',
          origin: 'manual_admin',
          grantedBy: { uid: 'admin', email: 'admin@example.com' },
          grantedAt: '2026-09-01T00:00:00Z',
          status: 'active',
        },
        {
          pilotId: 'pilot_revoked',
          grantedTierId: 'platino',
          startsAt: '2026-09-01T00:00:00Z',
          endsAt: '2026-12-01T00:00:00Z',
          campaign: 'pilot-2026-q4',
          cohort: 'cohort-C',
          origin: 'manual_admin',
          grantedBy: { uid: 'admin', email: 'admin@example.com' },
          grantedAt: '2026-08-30T00:00:00Z',
          status: 'revoked',
        },
      ],
    });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result.planId).toBe('oro');
    expect(result.reason).toBe('pilot_grant');
    expect(result.pilotId).toBe('pilot_oro');
  });

  it('never escalates above the user\'s paid plan — pilot cannot downgrade paid users', async () => {
    const fs = makeFirestore({
      userDoc: {
        subscription: {
          planId: 'oro',
          status: 'active',
          expiryDate: '2027-01-01T00:00:00Z',
        },
      },
      pilotDocs: [
        {
          pilotId: 'pilot_cobre',
          grantedTierId: 'cobre',
          startsAt: '2026-09-01T00:00:00Z',
          endsAt: '2026-12-01T00:00:00Z',
          campaign: 'pilot-2026-q4',
          cohort: 'cohort-A',
          origin: 'manual_admin',
          grantedBy: { uid: 'admin', email: 'admin@example.com' },
          grantedAt: '2026-08-30T00:00:00Z',
          status: 'active',
        },
      ],
    });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result.planId).toBe('oro');
    expect(result.reason).toBe('paid_subscription');
  });
});

// ── Result-shape invariant: every result has planId + reason ────────────

describe('resolveEffectivePlan result shape invariant', () => {
  it('every result includes planId and reason keys (admin tooling depends on it)', async () => {
    const fs = makeFirestore({ userDoc: null, pilotDocs: [] });
    const result = await resolveEffectivePlan(
      { uid: 'u1', organizationId: 'o1', now: NOW },
      { firestore: fs as unknown as Parameters<typeof resolveEffectivePlan>[1]['firestore'] },
    );
    expect(result).toHaveProperty('planId');
    expect(result).toHaveProperty('reason');
    const reasons: ResolveEffectivePlanResult['reason'][] = [
      'paid_subscription',
      'pilot_grant',
      'free_fallback',
      'free_no_org',
    ];
    expect(reasons).toContain(result.reason);
  });
});
