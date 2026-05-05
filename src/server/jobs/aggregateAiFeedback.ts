// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket UU — Weekly RLHF feedback aggregation cron.
//
// Reads `ai_feedback/{tenantId}/items` for the last 7 days, groups votes
// by tenant + domain, and writes a per-tenant summary at
// `ai_feedback_summaries/{week}/tenants/{tenantId}`.
//
// Designed to run from Cloud Scheduler weekly (Sunday 03:00 UTC) and is
// idempotent: re-running for the same week overwrites the same summary
// with the same counts modulo new items that arrived since the last run.
//
// The pure aggregation kernel lives in `routes/aiFeedback.ts`
// (`aggregateFeedbackItems`) so this job and the route share the same
// shape contract.

import type { Firestore } from 'firebase-admin/firestore';
import {
  aggregateFeedbackItems,
  isoWeek,
  type FeedbackItem,
  type FeedbackSummary,
} from '../routes/aiFeedback.js';

type FirestoreFactory = () => Firestore;

export interface AggregateOptions {
  getDb?: FirestoreFactory;
  /** Override of "now" for tests / replays. Default `new Date()`. */
  now?: () => Date;
  /** Look-back window in days. Default 7. */
  lookbackDays?: number;
}

export interface AggregateResult {
  tenantsProcessed: number;
  summariesWritten: number;
  totalItems: number;
  week: string;
  summaries: FeedbackSummary[];
}

/**
 * Walk every `ai_feedback/{tenantId}` doc, gather items in the rolling
 * window, compute the per-tenant summary, and persist it. Returns the
 * summary set for observability + the cron's HTTP wrapper.
 */
export async function aggregateAiFeedback(
  opts: AggregateOptions = {},
): Promise<AggregateResult> {
  const db = opts.getDb
    ? opts.getDb()
    : (await import('firebase-admin')).default.firestore();
  const now = (opts.now ?? (() => new Date()))();
  const lookbackDays = opts.lookbackDays ?? 7;
  const cutoffMs = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  const week = isoWeek(now);

  // Get tenants. We list the parent collection's docs; each tenant doc is
  // empty by design — items live in the `items` sub-collection. Firestore
  // returns the parent doc IDs even when the parent doc is empty as long
  // as the sub-collection has at least one doc.
  const tenantsSnap = await db.collection('ai_feedback').listDocuments();

  let summariesWritten = 0;
  let totalItems = 0;
  const summaries: FeedbackSummary[] = [];

  for (const tenantRef of tenantsSnap) {
    const tenantId = tenantRef.id;
    const itemsSnap = await db
      .collection('ai_feedback')
      .doc(tenantId)
      .collection('items')
      .where('createdAt', '>=', cutoffMs)
      .get();

    const items: FeedbackItem[] = itemsSnap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        messageId: String(data.messageId ?? d.id),
        vote: (data.vote === 'up' || data.vote === 'down' ? data.vote : 'up') as 'up' | 'down',
        rationale: typeof data.rationale === 'string' ? data.rationale : null,
        domain: typeof data.domain === 'string' ? data.domain : null,
        createdAtMs: typeof data.createdAt === 'number' ? data.createdAt : 0,
        sessionLengthMs:
          typeof data.sessionLengthMs === 'number' ? data.sessionLengthMs : undefined,
      };
    });

    if (items.length === 0) continue;
    totalItems += items.length;

    const summary = aggregateFeedbackItems(items, { tenantId, week });
    summaries.push(summary);

    await db
      .collection('ai_feedback_summaries')
      .doc(week)
      .collection('tenants')
      .doc(tenantId)
      .set({ ...summary, generatedAt: now.toISOString() }, { merge: true });
    summariesWritten += 1;
  }

  return {
    tenantsProcessed: tenantsSnap.length,
    summariesWritten,
    totalItems,
    week,
    summaries,
  };
}
