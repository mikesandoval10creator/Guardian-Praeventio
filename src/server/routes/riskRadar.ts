// Praeventio Guard — F.13 Radar de Riesgos Repetidos.
//
// Endpoint dedicado para `/api/sprint-k/:projectId/repeating-risks`.
// Migrado del monolito `sprintK.ts` (2026-05-18) por la directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// Lee los `incidents` recientes del proyecto (top-level collection,
// usada por backgroundTriggers) y los normaliza al shape `IncidentSample`
// que consume el servicio determinístico `buildRepeatingRiskRadar`.
// El resultado (`RadarReport`) viaja crudo al frontend para que
// `<RepeatingRiskRadarCard>` lo renderice.
//
// 100% determinístico, sin ML — agregaciones simples sobre los nodos
// por zona/tipo/tiempo. Si la lectura de incidents falla, devolvemos un
// reporte vacío en lugar de 500 para no bloquear el dashboard.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

const router = Router();

// ── Guard helpers ─────────────────────────────────────────────────────

async function resolveTenantId(
  callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  const members = await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .where('uid', '==', callerUid)
    .limit(1)
    .get();
  if (!members.empty) {
    const tid = members.docs[0]?.data()?.tenantId;
    if (typeof tid === 'string') return tid;
  }
  return null;
}

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<{ tenantId: string } | null> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return null;
    }
    throw err;
  }
  const tenantId = await resolveTenantId(
    callerUid,
    projectId,
    admin.firestore(),
  );
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// ── Severity normalization ────────────────────────────────────────────

type Severity = 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_ALIASES: Record<string, Severity> = {
  low: 'low',
  medium: 'medium',
  med: 'medium',
  high: 'high',
  critical: 'critical',
  fatality: 'critical',
  sif: 'critical',
  baja: 'low',
  media: 'medium',
  alta: 'high',
  critica: 'critical',
  'crítica': 'critical',
  leve: 'low',
  moderado: 'medium',
  moderada: 'medium',
  grave: 'high',
  fatal: 'critical',
};

function normalizeRadarSeverity(raw: unknown): Severity | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim().toLowerCase();
  return SEVERITY_ALIASES[key];
}

// ── Timestamp normalization ───────────────────────────────────────────

type MaybeTimestamp = { toDate?: () => Date; toMillis?: () => number };

function toDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date)
    return Number.isFinite(raw.getTime()) ? raw : null;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? new Date(raw) : null;
  }
  if (typeof raw === 'object') {
    const ts = raw as MaybeTimestamp;
    if (typeof ts.toMillis === 'function') {
      const ms = ts.toMillis();
      return Number.isFinite(ms) ? new Date(ms) : null;
    }
    if (typeof ts.toDate === 'function') {
      const d = ts.toDate();
      return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
    }
  }
  return null;
}

function tsOf(raw: unknown): number {
  const d = toDate(raw);
  return d ? d.getTime() : -Infinity;
}

// ── GET /:projectId/repeating-risks ───────────────────────────────────

router.get('/:projectId/repeating-risks', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { buildRepeatingRiskRadar } = await import(
      '../../services/riskRadar/repeatingRiskRadar.js'
    );
    const db = admin.firestore();

    // Ventana: últimos 90 días.
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

    type IncidentDoc = Record<string, unknown> & { id: string };
    const fetchOrdered = async (
      field: 'reportedAt' | 'occurredAt',
    ): Promise<IncidentDoc[]> => {
      try {
        const snap = await db
          .collection('incidents')
          .where('projectId', '==', projectId)
          .orderBy(field, 'desc')
          .limit(500)
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (err) {
        const code = (err as { code?: string | number } | null)?.code;
        const isMissingIndex =
          code === 9 ||
          code === 'failed-precondition' ||
          /index/i.test(String((err as Error | null)?.message ?? ''));
        if (!isMissingIndex) throw err;
        logger.warn?.('riskRadar.incidents.missing_index_fallback', {
          field,
          err,
        });
        try {
          const snap = await db
            .collection('incidents')
            .where('projectId', '==', projectId)
            .get();
          const docs: IncidentDoc[] = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          docs.sort((a, b) => tsOf(b[field]) - tsOf(a[field]));
          return docs.slice(0, 500);
        } catch (fallbackErr) {
          logger.warn?.('riskRadar.incidents.fallback_failed', fallbackErr);
          return [];
        }
      }
    };

    let rawIncidents: IncidentDoc[];
    try {
      const [byReported, byOccurred] = await Promise.all([
        fetchOrdered('reportedAt'),
        fetchOrdered('occurredAt'),
      ]);
      const seen = new Map<string, IncidentDoc>();
      for (const d of byReported) seen.set(d.id, d);
      for (const d of byOccurred) if (!seen.has(d.id)) seen.set(d.id, d);
      rawIncidents = Array.from(seen.values());
    } catch (err) {
      logger.warn?.('riskRadar.incidents.fetch_failed', err);
      rawIncidents = [];
    }

    const cutoffMs = Date.now() - NINETY_DAYS_MS;
    type Shift = 'day' | 'evening' | 'night';
    const VALID_SHIFTS: ReadonlySet<Shift> = new Set([
      'day',
      'evening',
      'night',
    ]);

    const samples = rawIncidents
      .map((d) => {
        const occurredAtDate = toDate(d.occurredAt);
        if (!occurredAtDate) return null;
        if (occurredAtDate.getTime() < cutoffMs) return null;
        const kind =
          (typeof d.kind === 'string' && d.kind) ||
          (typeof d.type === 'string' && (d.type as string)) ||
          (typeof d.category === 'string' && (d.category as string)) ||
          '';
        const zoneId =
          (typeof d.zoneId === 'string' && d.zoneId) ||
          (typeof d.zone === 'string' && (d.zone as string)) ||
          (typeof d.location === 'string' && (d.location as string)) ||
          (typeof d.area === 'string' && (d.area as string)) ||
          '';
        const taskId =
          (typeof d.taskId === 'string' && d.taskId) ||
          (typeof d.task === 'string' && (d.task as string)) ||
          undefined;
        const workerUid =
          typeof d.workerUid === 'string' ? (d.workerUid as string) : undefined;
        const rawShift =
          typeof d.shift === 'string' ? (d.shift as string) : '';
        const shift = VALID_SHIFTS.has(rawShift as Shift)
          ? (rawShift as Shift)
          : undefined;
        const severity = normalizeRadarSeverity(d.severity);
        return {
          id: d.id,
          occurredAt: occurredAtDate.toISOString(),
          kind,
          zoneId,
          taskId,
          workerUid,
          shift,
          severity,
        };
      })
      .filter(
        (s): s is NonNullable<typeof s> =>
          s !== null &&
          (s.kind.length > 0 ||
            s.zoneId.length > 0 ||
            (typeof s.workerUid === 'string' && s.workerUid.length > 0) ||
            (typeof s.taskId === 'string' && s.taskId.length > 0) ||
            typeof s.shift === 'string'),
      );

    const report = buildRepeatingRiskRadar(samples, {
      minOccurrences: 3,
      windowDays: 90,
    });

    return res.json({ report });
  } catch (err) {
    logger.error?.('riskRadar.error', err);
    captureRouteError(err, 'riskRadar');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
