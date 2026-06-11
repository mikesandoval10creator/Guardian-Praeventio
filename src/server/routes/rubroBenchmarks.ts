// Épica Rubros SII — slice 4: anonymous per-rubro benchmarks.
//
// GET /api/sii/:projectId/rubro-benchmarks
//
// "¿Cómo se compara mi proyecto con otros del mismo rubro?" — the server
// (Admin SDK, NEVER the client) samples every `projects` doc that shares the
// caller's SII sector, computes three metrics that already exist as real
// queryable data, and returns ONLY:
//   • the caller's OWN values (their own data — always allowed), and
//   • the anonymous distribution (median / p25 / p75 / count) per metric,
//     gated by the k-anonymity engine in src/services/sii/rubroBenchmarks.ts
//     (k ≥ 5 projects AND ≥ 3 distinct tenants — rationale documented there,
//     mirroring the culture-pulse n≥5 precedent in culturePulse.ts).
//
// Privacy invariants of this endpoint:
//   • No per-project values, project ids/names, or tenant ids of OTHER
//     projects ever appear in the response (pinned by supertest).
//   • Below threshold, the exact sector population (k) is itself withheld —
//     "there are exactly 3 other projects of my rubro" is a fingerprint.
//   • Clients cannot enumerate other projects through this route: the
//     cross-project query runs server-side only and this PR adds ZERO
//     client-readable collections / firestore.rules changes.
//
// READ-ONLY endpoint: it mutates nothing, so per CLAUDE.md rule #3 (audit
// every STATE-CHANGING operation) it intentionally writes no audit_logs row.
//
// Cost note: this computes on request — up to SECTOR_SAMPLE_CAP projects ×
// 4 capped queries each. Acceptable at the current scale; if rubros grow
// past the cap, replace the fan-out with a nightly aggregation job that
// materializes per-sector distributions (see src/server/jobs/* for the
// pattern) and serve the cached doc here instead.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { findByCodigo } from '../../services/sii/rubroSearch.js';
import {
  computeRubroBenchmarks,
  type AnonymousProjectMetrics,
  type RubroMetricId,
} from '../../services/sii/rubroBenchmarks.js';

const router = Router();

const PROJECT_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Cap on how many same-sector projects we sample per request. Keeps the
 * fan-out bounded (cap × 4 queries); above this, the distribution is
 * computed over a deterministic Firestore-ordered sample, which is fine for
 * median/percentiles. Future: nightly aggregation job (see header note).
 */
const SECTOR_SAMPLE_CAP = 40;

/** Per-collection doc cap inside one project (defensive read bound). */
const PER_PROJECT_READ_CAP = 500;

const WINDOW_12M_MS = 365 * 86_400_000;

/** Findings whose lowercase status is here (or that carry closedAt) are closed. */
const CLOSED_FINDING_STATUSES = new Set([
  'cerrado',
  'closed',
  'resuelto',
  'resolved',
  'completado',
  'done',
]);

type Doc = Record<string, unknown>;

/**
 * Timestamp coercion shared with incidentTrends.ts semantics: incidents
 * persist `ts` as ISO string OR `createdAt` as Firestore Timestamp.
 */
function toMs(raw: unknown): number | null {
  if (typeof raw === 'string' && raw) {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms;
  }
  if (raw && typeof raw === 'object') {
    const t = raw as { toDate?: () => Date; toMillis?: () => number; _seconds?: number; seconds?: number };
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.toDate === 'function') {
      const d = t.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime();
    }
    const seconds =
      typeof t._seconds === 'number' ? t._seconds : typeof t.seconds === 'number' ? t.seconds : null;
    if (seconds !== null) return seconds * 1000;
  }
  return null;
}

/** Per-collection failure → null metric, never a failed endpoint. */
async function safeRead(
  label: string,
  projectId: string,
  fn: () => Promise<Doc[]>,
): Promise<Doc[] | null> {
  try {
    return await fn();
  } catch (err) {
    logger.warn?.('rubroBenchmarks.read_failed', { label, projectId, err: (err as Error)?.message });
    return null;
  }
}

/**
 * Computes the three benchmark metrics for one project. Same dual incident
 * path as incidentTrends.ts: top-level `incidents` (projectId field) plus
 * `tenants/{tid}/projects/{pid}/incidents`, deduped by doc id.
 */
async function metricsForProject(
  db: admin.firestore.Firestore,
  projectId: string,
  tenantKey: string,
  nowMs: number,
): Promise<Partial<Record<RubroMetricId, number | null>>> {
  const cutoffMs = nowMs - WINDOW_12M_MS;

  const [topLevel, nested, findings, obligations] = await Promise.all([
    safeRead('incidents_top', projectId, async () => {
      const snap = await db
        .collection('incidents')
        .where('projectId', '==', projectId)
        .limit(PER_PROJECT_READ_CAP)
        .get();
      return snap.docs.map((d) => ({ __id: d.id, ...(d.data() as Doc) }));
    }),
    safeRead('incidents_nested', projectId, async () => {
      const snap = await db
        .collection(`tenants/${tenantKey}/projects/${projectId}/incidents`)
        .limit(PER_PROJECT_READ_CAP)
        .get();
      return snap.docs.map((d) => ({ __id: d.id, ...(d.data() as Doc) }));
    }),
    safeRead('findings', projectId, async () => {
      const snap = await db
        .collection('projects')
        .doc(projectId)
        .collection('findings')
        .limit(PER_PROJECT_READ_CAP)
        .get();
      return snap.docs.map((d) => d.data() as Doc);
    }),
    safeRead('obligations', projectId, async () => {
      const snap = await db
        .collection('projects')
        .doc(projectId)
        .collection('legal_obligations')
        .limit(PER_PROJECT_READ_CAP)
        .get();
      return snap.docs.map((d) => d.data() as Doc);
    }),
  ]);

  // incidentes12m — null only when BOTH incident paths failed (0 is a valid
  // and meaningful count for a project with no incidents).
  let incidentes12m: number | null = null;
  if (topLevel !== null || nested !== null) {
    const byId = new Map<string, Doc>();
    for (const rec of [...(topLevel ?? []), ...(nested ?? [])]) {
      const id = String(rec.__id ?? '');
      if (id && !byId.has(id)) byId.set(id, rec);
    }
    let count = 0;
    for (const rec of byId.values()) {
      const ms = toMs(rec.ts) ?? toMs(rec.createdAt) ?? toMs(rec.timestamp);
      if (ms !== null && ms >= cutoffMs && ms <= nowMs) count += 1;
    }
    incidentes12m = count;
  }

  // hallazgosAbiertosPct — share of findings not closed. Projects without
  // findings contribute nothing (null), so empty modules don't skew the
  // rubro distribution toward fake zeros.
  let hallazgosAbiertosPct: number | null = null;
  if (findings !== null && findings.length > 0) {
    const closed = findings.filter((f) => {
      if (f.closedAt != null) return true;
      const status = typeof f.status === 'string' ? f.status.toLowerCase() : '';
      return CLOSED_FINDING_STATUSES.has(status);
    }).length;
    hallazgosAbiertosPct = ((findings.length - closed) / findings.length) * 100;
  }

  // obligacionesAlDiaPct — share of legal obligations whose nextDueAt is in
  // the future (LegalObligation contract from legalObligationsCalendar.ts).
  let obligacionesAlDiaPct: number | null = null;
  if (obligations !== null) {
    const dated = obligations
      .map((o) => toMs(o.nextDueAt))
      .filter((ms): ms is number => ms !== null);
    if (dated.length > 0) {
      const alDia = dated.filter((ms) => ms >= nowMs).length;
      obligacionesAlDiaPct = (alDia / dated.length) * 100;
    }
  }

  return { incidentes12m, hallazgosAbiertosPct, obligacionesAlDiaPct };
}

function tenantKeyOf(projectId: string, data: Doc): string {
  // Single-tenant-per-uid data model: tenantId when present, else the
  // creator uid (onboarding writes createdBy = uid = tenantId).
  const tid = data.tenantId;
  if (typeof tid === 'string' && tid.length > 0) return tid;
  const createdBy = data.createdBy;
  if (typeof createdBy === 'string' && createdBy.length > 0) return createdBy;
  return projectId; // degenerate fallback: counts as its own tenant
}

router.get('/:projectId/rubro-benchmarks', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!PROJECT_ID_REGEX.test(projectId)) {
    return res.status(400).json({ error: 'invalid_project_id' });
  }

  const db = admin.firestore();
  try {
    // Membership gate FIRST (rule #6). assertProjectMember throws the same
    // 403 for "not found" and "not a member" — no existence oracle.
    await assertProjectMember(callerUid, projectId, db);
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      return res.status(403).json({ error: 'forbidden' });
    }
    throw err;
  }

  try {
    const ownSnap = await db.collection('projects').doc(projectId).get();
    const own = (ownSnap.data() ?? {}) as Doc;
    const meta = (own.metadata ?? {}) as Doc;

    // Rubro resolution: canonical home is `metadata` (onboarding.ts slice 3);
    // tolerate top-level fields, and derive the sector from the verified
    // catalogue when only the SII code was persisted.
    const rawCode = meta.codigoActividadSii ?? own.codigoActividadSii;
    const siiCode = typeof rawCode === 'number' && Number.isInteger(rawCode) ? rawCode : null;
    const actividad = siiCode != null ? findByCodigo(siiCode) : undefined;
    const rawSector = meta.sectorId ?? own.sectorId;
    const sectorId =
      typeof rawSector === 'string' && rawSector.length > 0
        ? rawSector
        : (actividad?.sectorId ?? null);

    if (sectorId === null) {
      return res.json({ available: false, reason: 'sin_rubro' });
    }

    const nowMs = Date.now();

    // Server-only cross-project sample. Rubro lives in `metadata.sectorId`
    // on the canonical projects doc (onboarding.ts slice 3 writer).
    const sectorSnap = await db
      .collection('projects')
      .where('metadata.sectorId', '==', sectorId)
      .limit(SECTOR_SAMPLE_CAP)
      .get();

    // Own row computed unconditionally (the caller's project might fall
    // outside a capped sample); engine dedupes by projectKey, first wins.
    const ownTenant = tenantKeyOf(projectId, own);
    const mine = await metricsForProject(db, projectId, ownTenant, nowMs);

    const peerRows: AnonymousProjectMetrics[] = await Promise.all(
      sectorSnap.docs
        .filter((d) => d.id !== projectId)
        .map(async (d) => {
          const data = (d.data() ?? {}) as Doc;
          const tenantKey = tenantKeyOf(d.id, data);
          return {
            projectKey: d.id,
            tenantKey,
            metrics: await metricsForProject(db, d.id, tenantKey, nowMs),
          };
        }),
    );

    const report = computeRubroBenchmarks([
      { projectKey: projectId, tenantKey: ownTenant, metrics: mine },
      ...peerRows,
    ]);

    const rubro = {
      siiCode,
      descripcion: actividad?.descripcion ?? null,
      sectorId,
    };

    if (!report.eligible) {
      // Honest below-threshold state. Deliberately WITHOUT k/kTenants —
      // the exact population of a small rubro is itself identifying.
      return res.json({
        available: true,
        eligible: false,
        requiredProjects: report.requiredProjects,
        requiredTenants: report.requiredTenants,
        rubro,
        mine,
      });
    }

    return res.json({
      available: true,
      eligible: true,
      requiredProjects: report.requiredProjects,
      requiredTenants: report.requiredTenants,
      rubro,
      mine,
      k: report.k,
      kTenants: report.kTenants,
      perMetric: report.perMetric,
    });
  } catch (err) {
    logger.error('rubro_benchmarks_failed', err, { projectId, callerUid });
    captureRouteError(err, 'rubroBenchmarks', { projectId, callerUid });
    // Rule #8 — 5xx bodies never leak internals in production.
    return res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : err instanceof Error
            ? err.message
            : String(err),
    });
  }
});

export default router;
