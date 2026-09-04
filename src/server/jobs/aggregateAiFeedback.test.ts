// SPDX-License-Identifier: MIT
//
// Job-level contract tests for the weekly RLHF feedback aggregation.
// The route test mocks this job; these tests exercise the real Firestore
// traversal, look-back filter, aggregation and idempotent summary write.

import { describe, expect, it } from 'vitest';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';
import { aggregateAiFeedback } from './aggregateAiFeedback';
import { isoWeek } from '../routes/aiFeedback';
import type { Firestore } from 'firebase-admin/firestore';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

type FakeDb = ReturnType<typeof createFakeFirestore>;

function asDb(db: FakeDb): Firestore {
  return db as unknown as Firestore;
}

function seedTenant(db: FakeDb, tenantId: string): void {
  // The real job discovers parent tenant ids through listDocuments().
  db._seed(`ai_feedback/${tenantId}`, {});
}

describe('aggregateAiFeedback — real job contract', () => {
  it('aggregates only items inside the look-back window and writes one tenant summary', async () => {
    const db = createFakeFirestore();
    seedTenant(db, 'tenant-a');
    db._seed('ai_feedback/tenant-a/items/in-window-up', {
      messageId: 'm-up',
      vote: 'up',
      rationale: 'Useful guidance',
      domain: 'sos',
      createdAt: NOW.getTime() - 2 * DAY,
      sessionLengthMs: 1_000,
    });
    db._seed('ai_feedback/tenant-a/items/in-window-down', {
      messageId: 'm-down',
      vote: 'down',
      rationale: ' useful guidance ',
      domain: 'sos',
      createdAt: NOW.getTime() - 6 * DAY,
      sessionLengthMs: 3_000,
    });
    db._seed('ai_feedback/tenant-a/items/expired', {
      messageId: 'm-old',
      vote: 'down',
      domain: 'general',
      createdAt: NOW.getTime() - 8 * DAY,
    });

    const result = await aggregateAiFeedback({
      getDb: () => asDb(db),
      now: () => NOW,
    });

    expect(result).toMatchObject({
      tenantsProcessed: 1,
      summariesWritten: 1,
      totalItems: 2,
      week: isoWeek(NOW),
    });
    expect(result.summaries[0]).toMatchObject({
      tenantId: 'tenant-a',
      total: 2,
      upPct: 0.5,
      downPct: 0.5,
      byDomain: { sos: { up: 1, down: 1 } },
      avgSessionLengthMs: 2_000,
      topRationales: [{ rationale: 'useful guidance', count: 2 }],
    });

    const persisted = db._store.get(
      `ai_feedback_summaries/${isoWeek(NOW)}/tenants/tenant-a`,
    );
    expect(persisted).toMatchObject({
      tenantId: 'tenant-a',
      total: 2,
      generatedAt: NOW.toISOString(),
    });
  });

  it('counts empty tenants as processed but does not write empty summaries', async () => {
    const db = createFakeFirestore();
    seedTenant(db, 'tenant-empty');

    const result = await aggregateAiFeedback({
      getDb: () => asDb(db),
      now: () => NOW,
    });

    expect(result).toMatchObject({
      tenantsProcessed: 1,
      summariesWritten: 0,
      totalItems: 0,
      summaries: [],
    });
    expect(
      db._store.has(`ai_feedback_summaries/${isoWeek(NOW)}/tenants/tenant-empty`),
    ).toBe(false);
  });

  it('is idempotent for the same week and keeps a single summary document', async () => {
    const db = createFakeFirestore();
    seedTenant(db, 'tenant-a');
    db._seed('ai_feedback/tenant-a/items/item-1', {
      vote: 'up',
      createdAt: NOW.getTime() - DAY,
    });

    const options = { getDb: () => asDb(db), now: () => NOW };
    const first = await aggregateAiFeedback(options);
    const second = await aggregateAiFeedback(options);

    expect(first.summaries).toEqual(second.summaries);
    expect(
      [...db._store.keys()].filter((key) => key.startsWith('ai_feedback_summaries/')),
    ).toEqual([`ai_feedback_summaries/${isoWeek(NOW)}/tenants/tenant-a`]);
  });

  it('propagates Firestore read failures instead of reporting a false successful rollup', async () => {
    const db = createFakeFirestore();
    seedTenant(db, 'tenant-a');
    db._failReads('ai_feedback/tenant-a/items');

    await expect(
      aggregateAiFeedback({ getDb: () => asDb(db), now: () => NOW }),
    ).rejects.toThrow('forced read failure');
  });
});
