// Praeventio Guard — Plan 3.12 (wire huérfanos): dedicated HTTP surface for
// `src/services/riskRanking/riskRankingEngine.ts`.
//
// ADR 0019 — Google ecosystem (Firestore via firebase-admin) is the read
// substrate; the engine itself is a pure deterministic ranker. This router
// applies the canonical mirror pattern from `routes/readReceipts.ts`:
//   • verifyAuth + assertProjectMember on every endpoint
//   • Zod query validation
//   • captureRouteError + logger.warn on every reject
//
// DS 44/2024 (Chile) — IPER (Identificación Peligros y Evaluación Riesgos).
// Surfacing top risks + weak controls is a Day-1 obligation for the
// prevencionista; this router is what the dashboard widgets call to render
// the daily IPER picture.
//
// Endpoints (4):
//   GET  /api/risk-ranking/:projectId/top?n=10                          — top N risks
//   GET  /api/risk-ranking/:projectId/weak-controls?n=10                — weakest controls
//   GET  /api/risk-ranking/:projectId/timeseries?days=30                — daily critical-risk count over window
//   POST /api/risk-ranking/:projectId/recompute                         — admin re-trigger (drops cache)
//
// 100% read-only on Firestore. The `recompute` POST clears the per-process
// memory cache so the next GET will re-fetch. There is no Firestore write.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  rankRisks,
  rankWeakControls,
  type RiskRecord,
  type ControlRecord,
  type RiskSeverity,
} from '../../services/riskRanking/riskRankingEngine.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────
// Guard
// ────────────────────────────────────────────────────────────────────────

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
    return true;
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return false;
    }
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────
// In-memory cache (per-process). Dashboard is read-heavy; the engine is
// deterministic, so a 60s TTL is safe. `recompute` busts the bucket.
// ────────────────────────────────────────────────────────────────────────

interface CacheBucket<T> {
  value: T;
  expiresAt: number;
}
const TTL_MS = 60_000;
const cache = new Map<string, CacheBucket<unknown>>();

function cacheGet<T>(key: string): T | null {
  const b = cache.get(key);
  if (!b) return null;
  if (Date.now() > b.expiresAt) {
    cache.delete(key);
    return null;
  }
  return b.value as T;
}
function cacheSet<T>(key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}
function cacheDropProject(projectId: string): number {
  let dropped = 0;
  for (const k of cache.keys()) {
    if (k.startsWith(`${projectId}:`)) {
      cache.delete(k);
      dropped += 1;
    }
  }
  return dropped;
}

// ────────────────────────────────────────────────────────────────────────
// Firestore readers — normalize raw docs into engine shapes.
// ────────────────────────────────────────────────────────────────────────

const SEVERITY_SET: ReadonlySet<RiskSeverity> = new Set([
  'low',
  'medium',
  'high',
  'critical',
]);

function normalizeSeverity(raw: unknown): RiskSeverity {
  if (typeof raw !== 'string') return 'medium';
  const k = raw.trim().toLowerCase();
  if (SEVERITY_SET.has(k as RiskSeverity)) return k as RiskSeverity;
  // Spanish aliases used elsewhere in the codebase.
  if (k === 'baja' || k === 'leve') return 'low';
  if (k === 'media' || k === 'moderada' || k === 'moderado') return 'medium';
  if (k === 'alta' || k === 'grave') return 'high';
  if (k === 'critica' || k === 'crítica' || k === 'fatal') return 'critical';
  return 'medium';
}

function toRiskRecord(id: string, data: Record<string, unknown>, projectId: string): RiskRecord {
  return {
    id,
    projectId,
    category: typeof data.category === 'string' ? data.category : 'other',
    severity: normalizeSeverity(data.severity),
    exposedWorkerCount:
      typeof data.exposedWorkerCount === 'number' ? data.exposedWorkerCount : 0,
    recentFindingCount:
      typeof data.recentFindingCount === 'number' ? data.recentFindingCount : 0,
    linkedIncidentCount:
      typeof data.linkedIncidentCount === 'number' ? data.linkedIncidentCount : 0,
    overdueActionCount:
      typeof data.overdueActionCount === 'number' ? data.overdueActionCount : 0,
  };
}

function toControlRecord(id: string, data: Record<string, unknown>, projectId: string): ControlRecord {
  const lastVerifiedAt =
    typeof data.lastVerifiedAt === 'string' ? data.lastVerifiedAt : undefined;
  let daysSinceLastVerification: number;
  if (typeof data.daysSinceLastVerification === 'number') {
    daysSinceLastVerification = data.daysSinceLastVerification;
  } else if (lastVerifiedAt) {
    const ms = Date.parse(lastVerifiedAt);
    daysSinceLastVerification = Number.isFinite(ms)
      ? Math.floor((Date.now() - ms) / 86_400_000)
      : 365;
  } else {
    daysSinceLastVerification = 365;
  }
  return {
    id,
    projectId,
    label: typeof data.label === 'string' ? data.label : id,
    verificationCount:
      typeof data.verificationCount === 'number' ? data.verificationCount : 0,
    failureCount: typeof data.failureCount === 'number' ? data.failureCount : 0,
    lastVerifiedAt,
    daysSinceLastVerification,
  };
}

async function loadRisks(projectId: string): Promise<RiskRecord[]> {
  const db = admin.firestore();
  const snap = await db
    .collection('risks')
    .where('projectId', '==', projectId)
    .limit(500)
    .get();
  return snap.docs.map((d) => toRiskRecord(d.id, d.data() as Record<string, unknown>, projectId));
}

async function loadControls(projectId: string): Promise<ControlRecord[]> {
  const db = admin.firestore();
  const snap = await db
    .collection('controls')
    .where('projectId', '==', projectId)
    .limit(500)
    .get();
  return snap.docs.map((d) => toControlRecord(d.id, d.data() as Record<string, unknown>, projectId));
}

// ────────────────────────────────────────────────────────────────────────
// 1. GET /:projectId/top — top-N risks
// ────────────────────────────────────────────────────────────────────────

const topQuerySchema = z.object({
  n: z.coerce.number().int().min(1).max(50).optional(),
});

router.get(
  '/:projectId/top',
  verifyAuth,
  validate(topQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    const { n } = req.validated as z.infer<typeof topQuerySchema>;
    const topN = n ?? 10;
    const key = `${projectId}:top:${topN}`;
    const hit = cacheGet<{ topRisks: Array<RiskRecord & { score: number }> }>(key);
    if (hit) return res.json({ ...hit, cached: true });
    try {
      const records = await loadRisks(projectId);
      const topRisks = rankRisks(records, topN);
      const payload = { topRisks, computedAt: new Date().toISOString() };
      cacheSet(key, payload);
      return res.json(payload);
    } catch (err) {
      logger.error?.('riskRanking.top.error', err);
      captureRouteError(err, 'riskRanking.top');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. GET /:projectId/weak-controls — weakest controls
// ────────────────────────────────────────────────────────────────────────

const weakQuerySchema = z.object({
  n: z.coerce.number().int().min(1).max(50).optional(),
});

router.get(
  '/:projectId/weak-controls',
  verifyAuth,
  validate(weakQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    const { n } = req.validated as z.infer<typeof weakQuerySchema>;
    const topN = n ?? 10;
    const key = `${projectId}:weak:${topN}`;
    const hit = cacheGet<{ weakControls: ReturnType<typeof rankWeakControls> }>(key);
    if (hit) return res.json({ ...hit, cached: true });
    try {
      const records = await loadControls(projectId);
      const weakControls = rankWeakControls(records, topN);
      const payload = { weakControls, computedAt: new Date().toISOString() };
      cacheSet(key, payload);
      return res.json(payload);
    } catch (err) {
      logger.error?.('riskRanking.weakControls.error', err);
      captureRouteError(err, 'riskRanking.weakControls');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. GET /:projectId/timeseries — daily count of critical risks over window
// ────────────────────────────────────────────────────────────────────────
//
// Aggregates `findings` by day for the last `days` days. We use findings as
// the leading indicator (they precede incidents). Output is sorted ascending
// by date so the chart consumer can render directly.

const timeseriesQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).optional(),
});

interface TimeseriesPoint {
  date: string; // YYYY-MM-DD
  count: number;
  critical: number;
}

router.get(
  '/:projectId/timeseries',
  verifyAuth,
  validate(timeseriesQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    const { days } = req.validated as z.infer<typeof timeseriesQuerySchema>;
    const window = days ?? 30;
    const key = `${projectId}:ts:${window}`;
    const hit = cacheGet<{ series: TimeseriesPoint[] }>(key);
    if (hit) return res.json({ ...hit, cached: true });
    try {
      const db = admin.firestore();
      const sinceIso = new Date(Date.now() - window * 86_400_000).toISOString();
      const snap = await db
        .collection('findings')
        .where('projectId', '==', projectId)
        .where('createdAt', '>=', sinceIso)
        .limit(2_000)
        .get();

      // Pre-seed all dates with zero so the chart shows a continuous line.
      const buckets = new Map<string, TimeseriesPoint>();
      for (let i = window - 1; i >= 0; i -= 1) {
        const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        buckets.set(d, { date: d, count: 0, critical: 0 });
      }

      for (const doc of snap.docs) {
        const data = doc.data() as { createdAt?: unknown; severity?: unknown };
        const raw =
          typeof data.createdAt === 'string'
            ? data.createdAt
            : data.createdAt instanceof Date
              ? data.createdAt.toISOString()
              : null;
        if (!raw) continue;
        const d = raw.slice(0, 10);
        const b = buckets.get(d);
        if (!b) continue;
        b.count += 1;
        if (normalizeSeverity(data.severity) === 'critical') b.critical += 1;
      }

      const series = Array.from(buckets.values()).sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
      );
      const payload = { series, computedAt: new Date().toISOString() };
      cacheSet(key, payload);
      return res.json(payload);
    } catch (err) {
      logger.error?.('riskRanking.timeseries.error', err);
      captureRouteError(err, 'riskRanking.timeseries');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/recompute — admin-only cache bust
// ────────────────────────────────────────────────────────────────────────
//
// Admins (req.user.admin === true) can force a recompute by dropping the
// per-project cache. Regular members see 403. The body is intentionally
// empty — this is a fire-and-forget cache eviction.

router.post('/:projectId/recompute', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const isAdmin = Boolean(req.user?.admin);
  if (!isAdmin) {
    return res.status(403).json({ error: 'forbidden', reason: 'admin_required' });
  }
  if (!(await guard(callerUid, projectId, res))) return undefined;
  try {
    const dropped = cacheDropProject(projectId);
    return res.json({ ok: true, dropped, recomputedAt: new Date().toISOString() });
  } catch (err) {
    logger.error?.('riskRanking.recompute.error', err);
    captureRouteError(err, 'riskRanking.recompute');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;

// Test seam — exported only for the contract test to verify cache eviction
// without spinning a Firestore. Production code should never reach for these.
export const __test = {
  cacheSet,
  cacheGet,
  cacheDropProject,
  TTL_MS,
};
