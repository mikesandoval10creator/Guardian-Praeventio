// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket UU — RLHF feedback loop API.
//
// POST /api/ai/feedback
//   Persists a thumbs up/down vote (+ optional rationale) from AsesorChat
//   into Firestore at `ai_feedback/{tenantId}/items/{messageId}` with
//   `status: 'pending_review'` and a 7-day TTL.
//
//   Privacy guarantee: the response text is run through `redactPII()` and
//   the original is dropped if any PII (Chilean RUT, email, phone) is
//   detected; the redacted version is stored instead. This keeps the
//   training set free of identifiable signal without losing the qualitative
//   shape that makes the rationale useful.
//
// GET /api/ai/feedback/summary?tenantId=â€¦
//   Returns the most recent weekly summary written by the
//   `aggregateAiFeedback` cron (see `src/server/jobs/aggregateAiFeedback.ts`).
//   Admin-gated via `verifyAuth` + req.user.admin custom claim.
//
// Tests live next to this file (ai.feedback.test.ts) and exercise the
// pure functions (`redactPII`, `containsPII`) plus the route end-to-end
// via supertest with a mocked Firestore.

import { Router } from 'express';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { aiFeedbackLimiter } from '../middleware/limiters.js';
import { logger } from '../../utils/logger.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { tracedAsync } from '../../services/observability/tracing.js';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PII redaction (pure, exported for tests).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Chilean RUT: 7-8 digits, optional dot separators, dash, verifier digit.
// Matches `12.345.678-9`, `12345678-9`, `1.234.567-K`, `1234567-k`.
const RUT_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;
// Email — RFC-lite. Good enough for opportunistic redaction.
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
// Chilean phone — `+56 9 1234 5678`, `+56912345678`, `9 1234 5678`,
// `912345678`. Also matches a bare 8-digit fixed line. Conservative: we
// require at least 8 digits to avoid eating arbitrary numbers.
const PHONE_RE = /(\+?56[\s-]?)?(9[\s-]?)?\d{4}[\s-]?\d{4}\b/g;

export interface RedactionResult {
  text: string;
  hadPII: boolean;
  hits: { rut: number; email: number; phone: number };
}

export function redactPII(input: string): RedactionResult {
  let rut = 0;
  let email = 0;
  let phone = 0;
  const text = input
    .replace(RUT_RE, () => {
      rut += 1;
      return '[RUT]';
    })
    .replace(EMAIL_RE, () => {
      email += 1;
      return '[EMAIL]';
    })
    .replace(PHONE_RE, () => {
      phone += 1;
      return '[TEL]';
    });
  return { text, hadPII: rut + email + phone > 0, hits: { rut, email, phone } };
}

export function containsPII(input: string): boolean {
  return redactPII(input).hadPII;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Aggregation helper (pure, exported for tests + cron consumer).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface FeedbackItem {
  messageId: string;
  vote: 'up' | 'down';
  rationale?: string | null;
  domain?: string | null;
  createdAtMs: number;
  sessionLengthMs?: number;
}

export interface FeedbackSummary {
  week: string; // ISO `YYYY-Www`
  tenantId: string;
  total: number;
  upPct: number;
  downPct: number;
  topRationales: Array<{ rationale: string; count: number }>;
  byDomain: Record<string, { up: number; down: number }>;
  avgSessionLengthMs: number;
}

export function isoWeek(date: Date): string {
  // ISO 8601 week: Thursday-of-week trick.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function aggregateFeedbackItems(
  items: FeedbackItem[],
  opts: { tenantId: string; week: string },
): FeedbackSummary {
  const total = items.length;
  if (total === 0) {
    return {
      week: opts.week,
      tenantId: opts.tenantId,
      total: 0,
      upPct: 0,
      downPct: 0,
      topRationales: [],
      byDomain: {},
      avgSessionLengthMs: 0,
    };
  }
  let up = 0;
  let down = 0;
  const rationaleCounts = new Map<string, number>();
  const byDomain: Record<string, { up: number; down: number }> = {};
  let totalSession = 0;
  let sessionSamples = 0;
  for (const it of items) {
    if (it.vote === 'up') up += 1;
    else if (it.vote === 'down') down += 1;
    if (it.rationale && it.rationale.trim().length > 0) {
      const key = it.rationale.trim().toLowerCase();
      rationaleCounts.set(key, (rationaleCounts.get(key) ?? 0) + 1);
    }
    const domain = it.domain ?? 'general';
    byDomain[domain] = byDomain[domain] ?? { up: 0, down: 0 };
    if (it.vote === 'up') byDomain[domain].up += 1;
    else byDomain[domain].down += 1;
    if (typeof it.sessionLengthMs === 'number' && it.sessionLengthMs > 0) {
      totalSession += it.sessionLengthMs;
      sessionSamples += 1;
    }
  }
  const topRationales = [...rationaleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rationale, count]) => ({ rationale, count }));
  return {
    week: opts.week,
    tenantId: opts.tenantId,
    total,
    upPct: up / total,
    downPct: down / total,
    topRationales,
    byDomain,
    avgSessionLengthMs: sessionSamples > 0 ? totalSession / sessionSamples : 0,
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Express router.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const feedbackBodySchema = z.object({
  messageId: z.string().min(1).max(128),
  vote: z.enum(['up', 'down']),
  rationale: z.string().max(2000).optional(),
  response: z.string().max(8000),
  domain: z.string().max(64).optional(),
  sessionLengthMs: z.number().int().nonnegative().optional(),
});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const router = Router();

router.post(
  '/feedback',
  verifyAuth,
  aiFeedbackLimiter,
  validate(feedbackBodySchema),
  async (req, res) => {
    const body = req.validated as z.infer<typeof feedbackBodySchema>;
    const tenantId: string = req.user?.uid ?? 'unknown';
    const callerEmail: string | null = req.user?.email ?? null;
    // Sprint 33 — replay-attack guard. Without `force`, a duplicate POST on
    // the same (tenantId, messageId) tuple is rejected with 409. Why: the
    // pre-Sprint-33 handler used `set({ merge: true })` which silently
    // overwrites `vote`. An attacker holding a valid Bearer could flip a
    // genuine 'down' to 'up' (RLHF dataset poisoning) without ever needing
    // high QPS — the rate limiter alone wouldn't catch it. The transaction
    // makes the read-then-write atomic so two concurrent first votes can't
    // race past the existence check.
    const force = String(req.query.force ?? '') === 'true';
    try {
      const { getFirestore } = await import('firebase-admin/firestore');
      const admin = (await import('firebase-admin')).default;
      const db = getFirestore();
      const redaction = redactPII(body.response);
      const rationaleRedaction = body.rationale ? redactPII(body.rationale) : null;
      const now = Date.now();
      const ttlAt = now + SEVEN_DAYS_MS;

      const docRef = db
        .collection('ai_feedback')
        .doc(tenantId)
        .collection('items')
        .doc(body.messageId);

      type TxOutcome =
        | { kind: 'conflict'; existingVote: 'up' | 'down' }
        | { kind: 'written'; override: boolean; previousVote: 'up' | 'down' | null };

      const outcome: TxOutcome = await tracedAsync(
        'ai.feedback.persist',
        { 'praeventio.uid': tenantId, vote: body.vote, domain: body.domain ?? null, force },
        () => db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        const existing = snap.exists ? (snap.data() as { vote?: 'up' | 'down' } | undefined) : null;
        const previousVote = existing?.vote ?? null;
        if (previousVote && !force) {
          // Idempotency rationale: callers retrying the SAME vote (network
          // hiccup) get a 409, not a silent merge. Clients should not
          // pretend the second call succeeded — they should drop it.
          return { kind: 'conflict', existingVote: previousVote };
        }
        const doc = {
          messageId: body.messageId,
          vote: body.vote,
          // If PII was found, we keep ONLY the redacted version. The flag
          // lets downstream auditors see "this row was sanitized" without
          // exposing what was redacted.
          response: redaction.text,
          responseHadPII: redaction.hadPII,
          rationale: rationaleRedaction?.text ?? null,
          rationaleHadPII: rationaleRedaction?.hadPII ?? false,
          domain: body.domain ?? null,
          sessionLengthMs: body.sessionLengthMs ?? null,
          status: 'pending_review',
          createdAt: previousVote ? (existing as any)?.createdAt ?? now : now,
          updatedAt: now,
          ttlAt,
          tenantId,
        };
        // merge:true preserves any auxiliary fields downstream cron jobs
        // may have stamped (review notes, training-set inclusion flags),
        // while the transaction guarantees vote-flip atomicity.
        tx.set(docRef, doc, { merge: true });
        return { kind: 'written', override: Boolean(previousVote), previousVote };
        }),
      );

      if (outcome.kind === 'conflict') {
        return res.status(409).json({
          error: 'already_voted',
          existing: outcome.existingVote,
        });
      }

      // Audit row — every successful write (including overrides) gets one
      // so RLHF dataset auditors can reconstruct vote-flip history. We do
      // this OUTSIDE the transaction because audit_logs is append-only and
      // a failed audit append must not roll back a legitimate vote.
      try {
        await db.collection('audit_logs').add({
          action: 'ai_feedback.voted',
          module: 'ai_feedback',
          details: {
            messageId: body.messageId,
            vote: body.vote,
            override: outcome.override,
            previousVote: outcome.previousVote,
            sanitized: redaction.hadPII || (rationaleRedaction?.hadPII ?? false),
          },
          userId: tenantId,
          userEmail: callerEmail,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        });
      } catch (auditErr) {
        logger.warn('ai_feedback_audit_append_failed', { err: String(auditErr) });
      }

      return res.json({
        ok: true,
        messageId: body.messageId,
        sanitized: redaction.hadPII || (rationaleRedaction?.hadPII ?? false),
        override: outcome.override,
      });
    } catch (err) {
      logger.error('ai_feedback_persist_failed', { err: String(err) });
      captureRouteError(err, 'ai.feedback.persist', { tenantId });
      return res.status(500).json({ error: 'feedback_persist_failed' });
    }
  },
);

router.get('/feedback/summary', verifyAuth, async (req, res) => {
  const isAdmin = Boolean(req.user?.admin);
  if (!isAdmin) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const tenantQ = req.query.tenantId;
  const tenantId: string =
    typeof tenantQ === 'string' && tenantQ.length > 0
      ? tenantQ
      : req.user?.uid ?? 'unknown';
  const week = typeof req.query.week === 'string' ? req.query.week : isoWeek(new Date());
  try {
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const snap = await db
      .collection('ai_feedback_summaries')
      .doc(week)
      .collection('tenants')
      .doc(tenantId)
      .get();
    if (!snap.exists) {
      return res.json({ ok: true, summary: null, week, tenantId });
    }
    return res.json({ ok: true, summary: snap.data(), week, tenantId });
  } catch (err) {
    logger.error('ai_feedback_summary_read_failed', { err: String(err) });
    captureRouteError(err, 'ai.feedback.summary_read', { tenantId, week });
    return res.status(500).json({ error: 'summary_read_failed' });
  }
});

export default router;
