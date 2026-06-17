// SPDX-License-Identifier: MIT
//
// Sprint 29 Bucket DD F-D — daysWithoutIncident service tests.
// In-memory Firestore fake con soporte para `where + orderBy + limit`.

import { describe, it, expect } from 'vitest';
import {
  computeDaysWithoutIncident,
  awardDaysMilestones,
  type MinimalDb,
} from './daysWithoutIncident.js';

interface FakeDoc {
  id: string;
  type?: string;
  projectId?: string;
  timestamp?: number | string;
  [k: string]: unknown;
}

function makeDb(): { db: MinimalDb; stores: Record<string, Map<string, FakeDoc>> } {
  const stores: Record<string, Map<string, FakeDoc>> = {
    reports: new Map(),
    gamification_scores: new Map(),
  };

  function buildQuery(name: string) {
    const filters: Array<[string, unknown]> = [];
    let order: { field: string; dir: 'asc' | 'desc' } | null = null;
    let lim: number | null = null;

    const q: any = {
      where(field: string, op: string, value: unknown) {
        if (op !== '==') throw new Error('only == supported');
        filters.push([field, value]);
        return q;
      },
      orderBy(field: string, dir: 'asc' | 'desc') {
        order = { field, dir };
        return q;
      },
      limit(n: number) {
        lim = n;
        return q;
      },
      async get() {
        let docs = Array.from(stores[name].values()).filter((d) =>
          filters.every(([f, v]) => (d as any)[f] === v),
        );
        if (order) {
          const { field, dir } = order;
          docs.sort((a, b) => {
            const av = (a as any)[field];
            const bv = (b as any)[field];
            if (av === bv) return 0;
            return dir === 'desc' ? (av < bv ? 1 : -1) : av < bv ? -1 : 1;
          });
        }
        if (lim != null) docs = docs.slice(0, lim);
        return {
          empty: docs.length === 0,
          docs: docs.map((d) => ({ id: d.id, data: () => d })),
        };
      },
      doc(id: string) {
        return {
          async get() {
            const d = stores[name].get(id);
            return { exists: d != null, data: () => d };
          },
          async set(data: any) {
            stores[name].set(id, { ...data, id });
          },
        };
      },
    };
    return q;
  }

  return {
    db: {
      collection(name: string) {
        if (!stores[name]) stores[name] = new Map();
        return buildQuery(name);
      },
    } as MinimalDb,
    stores,
  };
}

describe('computeDaysWithoutIncident', () => {
  it('returns 0 when no incidents and no sinceMs (project just created)', async () => {
    const { db } = makeDb();
    const days = await computeDaysWithoutIncident('p1', db, { nowMs: 1000 });
    expect(days).toBe(0);
  });

  it('counts days since the most recent incident', async () => {
    const { db, stores } = makeDb();
    const now = Date.parse('2026-05-05T00:00:00Z');
    const lastIncident = now - 30 * 24 * 3600 * 1000;
    stores.reports.set('r1', { id: 'r1', type: 'Incidente', projectId: 'p1', timestamp: lastIncident });
    const days = await computeDaysWithoutIncident('p1', db, { nowMs: now });
    expect(days).toBe(30);
  });

  it('ignores incidents from other projects', async () => {
    const { db, stores } = makeDb();
    const now = Date.parse('2026-05-05T00:00:00Z');
    stores.reports.set('r1', {
      id: 'r1',
      type: 'Incidente',
      projectId: 'p_other',
      timestamp: now - 5 * 24 * 3600 * 1000,
    });
    const sinceMs = now - 50 * 24 * 3600 * 1000;
    const days = await computeDaysWithoutIncident('p1', db, { nowMs: now, sinceMs });
    expect(days).toBe(50);
  });

  it('falls back to sinceMs when project has no incidents', async () => {
    const { db } = makeDb();
    const now = Date.parse('2026-05-05T00:00:00Z');
    const sinceMs = now - 12 * 24 * 3600 * 1000;
    const days = await computeDaysWithoutIncident('p1', db, { nowMs: now, sinceMs });
    expect(days).toBe(12);
  });
});

describe('awardDaysMilestones', () => {
  // The milestone now credits EACH project member (readable rows carry userId),
  // so the project doc with a `members` uid array must be seeded.
  function seedMembers(
    stores: Record<string, Map<string, FakeDoc>>,
    members: string[],
  ): void {
    if (!stores.projects) stores.projects = new Map();
    stores.projects.set('p1', { id: 'p1', members } as unknown as FakeDoc);
  }

  it('awards the 100-day milestone to EACH project member (rows carry userId)', async () => {
    const { db, stores } = makeDb();
    seedMembers(stores, ['u1', 'u2']);
    const now = Date.parse('2026-05-05T00:00:00Z');
    const sinceMs = now - 105 * 24 * 3600 * 1000;
    const awards = await awardDaysMilestones('p1', db, { nowMs: now, sinceMs });
    expect(awards).toHaveLength(2); // one per member
    expect(awards.every((a) => a.medalId === 'days-100')).toBe(true);
    expect(awards.map((a) => a.userId).sort()).toEqual(['u1', 'u2']);
    // Per-member, readable rows keyed per member, carrying userId + points.
    expect(stores.gamification_scores.has('days_milestone_p1_100_u1')).toBe(true);
    expect(stores.gamification_scores.has('days_milestone_p1_100_u2')).toBe(true);
    expect(stores.gamification_scores.get('days_milestone_p1_100_u1')?.userId).toBe('u1');
    expect(stores.gamification_scores.get('days_milestone_p1_100_u1')?.points).toBe(100);
  });

  it('awards both milestones to each member once when counter >= 365', async () => {
    const { db, stores } = makeDb();
    seedMembers(stores, ['u1', 'u2']);
    const now = Date.parse('2026-05-05T00:00:00Z');
    const sinceMs = now - 400 * 24 * 3600 * 1000;
    const awards = await awardDaysMilestones('p1', db, { nowMs: now, sinceMs });
    // 2 milestones × 2 members = 4 readable rows
    expect(awards).toHaveLength(4);
    expect(stores.gamification_scores.size).toBe(4);
  });

  it('is idempotent — re-running does not double-award', async () => {
    const { db, stores } = makeDb();
    seedMembers(stores, ['u1', 'u2']);
    const now = Date.parse('2026-05-05T00:00:00Z');
    const sinceMs = now - 105 * 24 * 3600 * 1000;
    await awardDaysMilestones('p1', db, { nowMs: now, sinceMs });
    const second = await awardDaysMilestones('p1', db, { nowMs: now, sinceMs });
    expect(second).toEqual([]);
    expect(stores.gamification_scores.size).toBe(2); // 1 milestone × 2 members
  });

  it('awards nothing below the 100-day threshold', async () => {
    const { db, stores } = makeDb();
    seedMembers(stores, ['u1', 'u2']);
    const now = Date.parse('2026-05-05T00:00:00Z');
    const sinceMs = now - 50 * 24 * 3600 * 1000;
    const awards = await awardDaysMilestones('p1', db, { nowMs: now, sinceMs });
    expect(awards).toEqual([]);
    expect(stores.gamification_scores.size).toBe(0);
  });

  it('awards nothing when the project has no members (no one to credit — never an unreadable row)', async () => {
    const { db, stores } = makeDb();
    seedMembers(stores, []); // empty members array
    const now = Date.parse('2026-05-05T00:00:00Z');
    const sinceMs = now - 400 * 24 * 3600 * 1000;
    const awards = await awardDaysMilestones('p1', db, { nowMs: now, sinceMs });
    expect(awards).toEqual([]);
    expect(stores.gamification_scores.size).toBe(0);
  });
});
