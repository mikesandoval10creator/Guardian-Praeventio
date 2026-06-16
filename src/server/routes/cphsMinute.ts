// Praeventio Guard — F.7 Minuta automática Comité Paritario (CPHS).
//
// Endpoint dedicado para `/api/sprint-k/:projectId/cphs/draft-minute`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// Construye el "borrador estructurado mensual" que el CPHS revisa antes
// de firmar el acta definitiva. Cruza:
//   - Incidentes del último mes (en /incidents + /nodes type='Incidente')
//   - Acciones correctivas (todos los status: open/in_progress/closed/
//     verified/verified_effective/reopened) vía CorrectiveActionsAdapter
//   - Capacitaciones impartidas en el mes
//   - Inspecciones del mes (/audits + /nodes type='Auditoría')
//   - Compliance traffic light score (F.2 cache)
//   - Expected attendees (cphs_committees activos)
//
// Servicio puro: `buildMonthlyMinuteDraft` (cphsMinuteAutogenerator).
// Sin LLM — la pasada Gemini opcional para pulir redacción queda fuera
// de scope F.7.
//
// Codex P2 fixes preservados (PR #317 rounds 1-2):
//   - committees source-of-truth vía cphs_committees collection
//   - complianceScore from project doc (no más hardcoded 0)
//   - incidents leídos desde /incidents (canonical) + /nodes type=Incidente
//   - trainings filtrados por completedAt + ventana mensual
//   - inspections desde /nodes type=Auditoría + /audits con status=completed
//   - orderBy con fallback a query sin orden cuando falta índice
//   - dedupe por id para ambient writers múltiples

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { randomId } from '../../utils/randomId.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { CorrectiveActionsAdapter } from '../../services/correctiveActions/correctiveActionsFirestoreAdapter.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

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

// Lighter guard for the project-scoped acta writes (the collection lives at
// `projects/{projectId}/comite_actas`, not a tenant subcollection — no tenantId
// needed). Membership is the authority; identity is stamped server-side.
async function assertMember(
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

// ── GET /:projectId/cphs/draft-minute ─────────────────────────────────

router.get('/:projectId/cphs/draft-minute', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { buildMonthlyMinuteDraft } = await import(
      '../../services/cphs/cphsMinuteAutogenerator.js'
    );

    const db = admin.firestore();

    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const periodLabel = `${monthStart.getUTCFullYear()}-${String(
      monthStart.getUTCMonth() + 1,
    ).padStart(2, '0')}`;

    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`cphsMinute.${label}.fetch_failed`, err);
        return [];
      }
    };

    let companyName = 'Empresa';
    let expectedAttendees: string[] = [];

    try {
      const committeesSnap = await db
        .collection('cphs_committees')
        .where('projectId', '==', projectId)
        .where('status', '==', 'active')
        .limit(5)
        .get();
      if (!committeesSnap.empty) {
        const seen = new Set<string>();
        const collected: string[] = [];
        for (const doc of committeesSnap.docs) {
          const data = doc.data() as { members?: unknown };
          if (!Array.isArray(data.members)) continue;
          for (const m of data.members) {
            if (!m || typeof m !== 'object') continue;
            const full = (m as { fullName?: unknown }).fullName;
            if (
              typeof full === 'string' &&
              full.length > 0 &&
              !seen.has(full)
            ) {
              seen.add(full);
              collected.push(full);
            }
          }
        }
        if (collected.length > 0) {
          expectedAttendees = collected;
        }
      }
    } catch (err) {
      logger.warn?.('cphsMinute.committees.fetch_failed', err);
    }

    let complianceTrafficLightScore: number | undefined;
    try {
      const projDoc = await db.collection('projects').doc(projectId).get();
      const projData = projDoc.exists ? projDoc.data() : null;
      if (projData) {
        if (
          typeof projData.companyName === 'string' &&
          projData.companyName.length > 0
        ) {
          companyName = projData.companyName;
        } else if (
          typeof projData.name === 'string' &&
          projData.name.length > 0
        ) {
          companyName = projData.name;
        }
        if (expectedAttendees.length === 0) {
          if (Array.isArray(projData.cphsAttendees)) {
            expectedAttendees = projData.cphsAttendees.filter(
              (v: unknown): v is string =>
                typeof v === 'string' && v.length > 0,
            );
          } else if (Array.isArray(projData.cphsMembers)) {
            expectedAttendees = projData.cphsMembers
              .map((m: unknown) => {
                if (!m || typeof m !== 'object') return '';
                const candidate =
                  (m as { fullName?: unknown }).fullName ??
                  (m as { displayName?: unknown }).displayName;
                return typeof candidate === 'string' ? candidate : '';
              })
              .filter((s: string) => s.length > 0);
          }
        }
        const rawScore = projData.complianceScore;
        if (typeof rawScore === 'number' && Number.isFinite(rawScore)) {
          complianceTrafficLightScore = clampScore(rawScore);
        } else if (
          rawScore &&
          typeof rawScore === 'object' &&
          typeof (rawScore as { score?: unknown }).score === 'number'
        ) {
          complianceTrafficLightScore = clampScore(
            (rawScore as { score: number }).score,
          );
        }
      }
    } catch (err) {
      logger.warn?.('cphsMinute.project.fetch_failed', err);
    }

    const incidents = await safeRead<Record<string, unknown>>(
      'incidents',
      async () => {
        const startMs = monthStart.getTime();
        const endMs = monthEnd.getTime();

        const baseIncidentsQuery = db
          .collection('incidents')
          .where('projectId', '==', projectId);
        let incidentsSnap: FirebaseFirestore.QuerySnapshot;
        try {
          const orderedSnap = await baseIncidentsQuery
            .orderBy('occurredAt', 'desc')
            .limit(500)
            .get();
          if (orderedSnap.empty) {
            incidentsSnap = await baseIncidentsQuery.limit(500).get();
          } else {
            incidentsSnap = orderedSnap;
          }
        } catch (orderErr) {
          logger.warn?.(
            'cphsMinute.incidents.orderBy_failed_fallback_unordered',
            orderErr,
          );
          incidentsSnap = await baseIncidentsQuery.limit(500).get();
        }

        let nodeIncidentsSnap: FirebaseFirestore.QuerySnapshot;
        try {
          nodeIncidentsSnap = await db
            .collection('nodes')
            .where('projectId', '==', projectId)
            .where('type', '==', 'Incidente')
            .limit(500)
            .get();
        } catch (nodesErr) {
          logger.warn?.(
            'cphsMinute.incidents.nodes_query_failed',
            nodesErr,
          );
          nodeIncidentsSnap = {
            docs: [],
          } as unknown as FirebaseFirestore.QuerySnapshot;
        }

        const nodeIncidents: Record<string, unknown>[] =
          nodeIncidentsSnap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            const metadata =
              (data.metadata as Record<string, unknown> | undefined) ?? {};
            const criticidad =
              typeof metadata.criticidad === 'string'
                ? metadata.criticidad
                : typeof data.severity === 'string'
                  ? data.severity
                  : undefined;
            return {
              id: d.id,
              ...data,
              severity: criticidad ?? data.severity,
              description:
                typeof data.description === 'string'
                  ? data.description
                  : typeof (metadata.context as unknown) === 'string'
                    ? (metadata.context as string)
                    : typeof data.title === 'string'
                      ? data.title
                      : 'Sin descripción',
            };
          });

        const incidentDocs: Record<string, unknown>[] =
          incidentsSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Record<string, unknown>),
          }));

        const byId = new Map<string, Record<string, unknown>>();
        for (const n of nodeIncidents) byId.set(String(n.id), n);
        for (const i of incidentDocs) byId.set(String(i.id), i);
        const combined = Array.from(byId.values());

        return combined.filter((doc) => {
          const ts =
            (typeof doc.occurredAt === 'string'
              ? doc.occurredAt
              : null) ??
            (typeof doc.createdAt === 'string'
              ? doc.createdAt
              : null);
          if (!ts) return false;
          const t = Date.parse(ts);
          return Number.isFinite(t) && t >= startMs && t < endMs;
        });
      },
    );

    const ACTIONS_PAGE = 1000;
    const correctiveActions = await safeRead<Record<string, unknown>>(
      'correctiveActions',
      async () => {
        const adapter = new CorrectiveActionsAdapter(
          db as any,
          g.tenantId,
          projectId,
        );
        const [
          openA,
          inProgressA,
          closedA,
          verifiedA,
          verifiedEffectiveA,
          reopenedA,
        ] = await Promise.all([
          adapter.listByStatus('open', ACTIONS_PAGE).catch((err) => {
            logger.warn('cphsMinute.read.actionsOpen.failed', err);
            return [];
          }),
          adapter
            .listByStatus('in_progress', ACTIONS_PAGE)
            .catch((err) => {
              logger.warn('cphsMinute.read.actionsInProgress.failed', err);
              return [];
            }),
          adapter.listByStatus('closed', ACTIONS_PAGE).catch((err) => {
            logger.warn('cphsMinute.read.actionsClosed.failed', err);
            return [];
          }),
          adapter.listByStatus('verified', ACTIONS_PAGE).catch((err) => {
            logger.warn('cphsMinute.read.actionsVerified.failed', err);
            return [];
          }),
          adapter
            .listByStatus('verified_effective', ACTIONS_PAGE)
            .catch((err) => {
              logger.warn(
                'cphsMinute.read.actionsVerifiedEffective.failed',
                err,
              );
              return [];
            }),
          adapter.listByStatus('reopened', ACTIONS_PAGE).catch((err) => {
            logger.warn('cphsMinute.read.actionsReopened.failed', err);
            return [];
          }),
        ]);
        return [
          ...openA,
          ...inProgressA,
          ...closedA,
          ...verifiedA,
          ...verifiedEffectiveA,
          ...reopenedA,
        ] as unknown as Record<string, unknown>[];
      },
    );

    const trainings = await safeRead<Record<string, unknown>>(
      'trainings',
      async () => {
        const baseQuery = db
          .collection('training')
          .where('projectId', '==', projectId);
        let snap: FirebaseFirestore.QuerySnapshot;
        try {
          snap = await baseQuery
            .orderBy('date', 'desc')
            .limit(500)
            .get();
        } catch (orderErr) {
          logger.warn?.(
            'cphsMinute.trainings.orderBy_failed_fallback_unordered',
            orderErr,
          );
          snap = await baseQuery.limit(500).get();
        }
        const startMs = monthStart.getTime();
        const endMs = monthEnd.getTime();
        const all: Record<string, unknown>[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, unknown>),
        }));
        return all.filter((doc) => {
          if (doc.status !== 'completed') return false;
          const ts =
            (typeof doc.completedAt === 'string'
              ? doc.completedAt
              : null) ??
            (typeof doc.date === 'string' ? doc.date : null);
          if (!ts) return false;
          const t = Date.parse(ts);
          return Number.isFinite(t) && t >= startMs && t < endMs;
        });
      },
    );

    const inspections = await safeRead<Record<string, unknown>>(
      'inspections',
      async () => {
        const startMs = monthStart.getTime();
        const endMs = monthEnd.getTime();

        let nodesSnap: FirebaseFirestore.QuerySnapshot;
        try {
          nodesSnap = await db
            .collection('nodes')
            .where('projectId', '==', projectId)
            .where('type', '==', 'Auditoría')
            .limit(500)
            .get();
        } catch (nodesErr) {
          logger.warn?.(
            'cphsMinute.inspections.nodes_query_failed',
            nodesErr,
          );
          nodesSnap = {
            docs: [],
          } as unknown as FirebaseFirestore.QuerySnapshot;
        }

        let auditsSnap: FirebaseFirestore.QuerySnapshot;
        try {
          auditsSnap = await db
            .collection('audits')
            .where('projectId', '==', projectId)
            .limit(500)
            .get();
        } catch (auditsErr) {
          logger.warn?.(
            'cphsMinute.inspections.audits_query_failed',
            auditsErr,
          );
          auditsSnap = {
            docs: [],
          } as unknown as FirebaseFirestore.QuerySnapshot;
        }

        const isCompletedStatus = (raw: unknown): boolean => {
          if (typeof raw !== 'string') return false;
          const s = raw.toLowerCase();
          return (
            s === 'completado' ||
            s === 'completada' ||
            s === 'completed' ||
            s === 'ejecutada' ||
            s === 'ejecutado'
          );
        };

        const isInPeriod = (raw: unknown): boolean => {
          if (typeof raw !== 'string') return false;
          const t = Date.parse(raw);
          return Number.isFinite(t) && t >= startMs && t < endMs;
        };

        const fromNodes: Record<string, unknown>[] = nodesSnap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const metadata =
              (data.metadata as Record<string, unknown> | undefined) ?? {};
            const status =
              (metadata.status as unknown) ?? (data.status as unknown);
            const dateField =
              (metadata.date as unknown) ??
              (data.completedAt as unknown) ??
              (data.createdAt as unknown);
            return {
              id: d.id,
              status,
              date: dateField,
              raw: data,
            };
          })
          .filter(
            (doc) =>
              isCompletedStatus(doc.status) && isInPeriod(doc.date),
          );

        const fromAudits: Record<string, unknown>[] = auditsSnap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const status =
              (data.status as unknown) ??
              ((data.metadata as Record<string, unknown> | undefined)
                ?.status as unknown);
            const dateField =
              (data.completedAt as unknown) ??
              (data.date as unknown) ??
              (data.createdAt as unknown) ??
              ((data.metadata as Record<string, unknown> | undefined)
                ?.date as unknown);
            return {
              id: d.id,
              status,
              date: dateField,
              raw: data,
            };
          })
          .filter(
            (doc) =>
              isCompletedStatus(doc.status) && isInPeriod(doc.date),
          );

        const byId = new Map<string, Record<string, unknown>>();
        for (const n of fromNodes) byId.set(String(n.id), n);
        for (const a of fromAudits) byId.set(String(a.id), a);
        return Array.from(byId.values());
      },
    );

    const normSeverity = (
      raw: unknown,
    ): 'low' | 'medium' | 'high' | 'critical' => {
      const s = String(raw ?? '').toLowerCase();
      if (
        s === 'critical' ||
        s === 'critico' ||
        s === 'crítico' ||
        s === '4'
      )
        return 'critical';
      if (s === 'high' || s === 'alta' || s === 'alto' || s === '3')
        return 'high';
      if (s === 'low' || s === 'baja' || s === 'bajo' || s === '1')
        return 'low';
      return 'medium';
    };

    const incidentsInput = incidents.map(
      (i: Record<string, unknown>) => ({
        id: String(i.id ?? 'unknown'),
        severity: normSeverity(i.severity),
        description:
          typeof i.description === 'string' && i.description.length > 0
            ? i.description
            : typeof i.summary === 'string' && i.summary.length > 0
              ? i.summary
              : 'Sin descripción',
        rootCauseKnown:
          i.rootCauseKnown === true ||
          (typeof i.rootCause === 'string' &&
            i.rootCause.length > 0) ||
          (typeof i.rootCause === 'object' && i.rootCause !== null),
      }),
    );

    const correctiveActionsInput = correctiveActions.map(
      (a: Record<string, unknown>) => {
        const rawStatus = String(a.status ?? 'open');
        const status:
          | 'open'
          | 'in_progress'
          | 'closed'
          | 'verified'
          | 'verified_effective' =
          rawStatus === 'closed'
            ? 'closed'
            : rawStatus === 'verified'
              ? 'verified'
              : rawStatus === 'verified_effective'
                ? 'verified_effective'
                : rawStatus === 'in_progress'
                  ? 'in_progress'
                  : 'open';
        return {
          id: String(a.id ?? 'unknown'),
          status,
          dueDate:
            typeof a.dueDate === 'string' ? a.dueDate : undefined,
          label:
            typeof a.description === 'string' &&
            a.description.length > 0
              ? a.description.slice(0, 200)
              : 'Acción sin descripción',
        };
      },
    );

    const trainingsInput = trainings.map(
      (t: Record<string, unknown>) => ({
        title:
          typeof t.title === 'string' && t.title.length > 0
            ? t.title
            : typeof t.name === 'string' && t.name.length > 0
              ? t.name
              : 'Capacitación',
        participantsCount: (() => {
          if (typeof t.participantsCount === 'number')
            return t.participantsCount;
          if (Array.isArray(t.participants))
            return t.participants.length;
          if (Array.isArray(t.attendees)) return t.attendees.length;
          return 0;
        })(),
      }),
    );

    const draft = buildMonthlyMinuteDraft({
      projectId,
      period: periodLabel,
      companyName,
      incidents: incidentsInput,
      correctiveActions: correctiveActionsInput,
      trainingsCompleted: trainingsInput,
      inspectionsCompleted: inspections.length,
      complianceTrafficLightScore,
      legalRecommendations: [],
      expectedAttendees,
    });

    return res.json({ draft });
  } catch (err) {
    logger.error?.('cphsMinute.draftMinute.error', err);
    captureRouteError(err, 'cphsMinute.draftMinute');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── CPHS acta writers (legal minutes → server-only + audited) ──────────
// CLAUDE.md #3: every state change writes audit_logs with SERVER-stamped
// identity. A CPHS acta is a legally-significant document, so create-acta /
// add-acuerdo / change-acuerdo-status move off the client (which wrote
// `comite_actas` directly, UNAUDITED) onto these audited routes. The path
// stays project-scoped `projects/{projectId}/comite_actas` (the page still
// READS it live); the Firestore rule is tightened to server-only writes.

const ACTA_TIPOS = ['Ordinaria', 'Extraordinaria'] as const;
const ACUERDO_ESTADOS = ['Pendiente', 'En Progreso', 'Completado'] as const;

const createActaSchema = z.object({
  fecha: z.string().min(8).max(40),
  tipo: z.enum(ACTA_TIPOS),
  asistentes: z.array(z.string().min(1).max(200)).min(1).max(100),
});

router.post(
  '/:projectId/cphs/actas',
  verifyAuth,
  validate(createActaSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ error: 'invalid_params' });
    const body = req.body as z.infer<typeof createActaSchema>;
    if (!(await assertMember(callerUid, projectId, res))) return undefined;
    try {
      const db = admin.firestore();
      const ref = await db.collection(`projects/${projectId}/comite_actas`).add({
        fecha: body.fecha,
        tipo: body.tipo,
        asistentes: body.asistentes,
        acuerdos: [],
        createdAt: new Date().toISOString(),
        createdByUid: callerUid,
      });
      await auditServerEvent(
        req,
        'cphs.acta.create',
        'cphs',
        { actaId: ref.id, tipo: body.tipo, asistentesCount: body.asistentes.length },
        { projectId },
      );
      return res.status(201).json({ id: ref.id });
    } catch (err) {
      logger.error?.('cphsMinute.acta.create.error', err);
      captureRouteError(err, 'cphsMinute.acta.create', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const addAcuerdoSchema = z.object({
  descripcion: z.string().min(1).max(2000),
  responsable: z.string().min(1).max(200),
  fechaPlazo: z.string().min(8).max(40),
});

router.post(
  '/:projectId/cphs/actas/:actaId/acuerdos',
  verifyAuth,
  validate(addAcuerdoSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, actaId } = req.params;
    if (!projectId || !actaId) return res.status(400).json({ error: 'invalid_params' });
    const body = req.body as z.infer<typeof addAcuerdoSchema>;
    if (!(await assertMember(callerUid, projectId, res))) return undefined;
    try {
      const db = admin.firestore();
      const actaRef = db.collection(`projects/${projectId}/comite_actas`).doc(actaId);
      const snap = await actaRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'acta_not_found' });
      const acuerdo = {
        id: randomId(),
        descripcion: body.descripcion,
        responsable: body.responsable,
        fechaPlazo: body.fechaPlazo,
        estado: 'Pendiente' as const,
      };
      await actaRef.update({
        acuerdos: admin.firestore.FieldValue.arrayUnion(acuerdo),
      });
      await auditServerEvent(
        req,
        'cphs.acuerdo.add',
        'cphs',
        { actaId, acuerdoId: acuerdo.id },
        { projectId },
      );
      return res.status(201).json({ acuerdo });
    } catch (err) {
      logger.error?.('cphsMinute.acuerdo.add.error', err);
      captureRouteError(err, 'cphsMinute.acuerdo.add', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const updateAcuerdoSchema = z.object({
  estado: z.enum(ACUERDO_ESTADOS),
});

router.patch(
  '/:projectId/cphs/actas/:actaId/acuerdos/:acuerdoId',
  verifyAuth,
  validate(updateAcuerdoSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, actaId, acuerdoId } = req.params;
    if (!projectId || !actaId || !acuerdoId) {
      return res.status(400).json({ error: 'invalid_params' });
    }
    const body = req.body as z.infer<typeof updateAcuerdoSchema>;
    if (!(await assertMember(callerUid, projectId, res))) return undefined;
    try {
      const db = admin.firestore();
      const actaRef = db.collection(`projects/${projectId}/comite_actas`).doc(actaId);
      // Read-modify-write on the acuerdos array → transaction (CLAUDE.md #19).
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(actaRef);
        if (!snap.exists) return 'acta_not_found' as const;
        const data = snap.data() ?? {};
        const acuerdos = Array.isArray(data.acuerdos) ? data.acuerdos : [];
        let found = false;
        const updated = acuerdos.map((a: Record<string, unknown>) => {
          if (a && a.id === acuerdoId) {
            found = true;
            return { ...a, estado: body.estado };
          }
          return a;
        });
        if (!found) return 'acuerdo_not_found' as const;
        tx.update(actaRef, { acuerdos: updated });
        return 'ok' as const;
      });
      if (result === 'acta_not_found') return res.status(404).json({ error: 'acta_not_found' });
      if (result === 'acuerdo_not_found') {
        return res.status(404).json({ error: 'acuerdo_not_found' });
      }
      await auditServerEvent(
        req,
        'cphs.acuerdo.updateStatus',
        'cphs',
        { actaId, acuerdoId, estado: body.estado },
        { projectId },
      );
      return res.json({ ok: true });
    } catch (err) {
      logger.error?.('cphsMinute.acuerdo.updateStatus.error', err);
      captureRouteError(err, 'cphsMinute.acuerdo.updateStatus', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
