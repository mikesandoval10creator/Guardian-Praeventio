// Praeventio Guard — F.16 Score de Preparación del Trabajador.
//
// Endpoint dedicado para `/api/sprint-k/:projectId/worker-readiness/:workerUid`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// Asistente NO BLOQUEANTE. Cruza múltiples colecciones:
//   - Worker doc (projects/{pid}/workers/{workerUid})
//   - Trainings vigentes desde 5 paths (training_assignments, trainings
//     nested por workerUid/workerId, top-level training por uid +
//     attendees array completed)
//   - EPP entregado desde 4 paths (projects/{pid}/epp_assignments por
//     workerId/workerUid + top-level por workerUid/assignedTo)
//   - Task opcional (top-level tasks/{taskId}) y processDoc parent para
//     extraer requiredTrainings/requiredEpp/taskCategory
//   - Incidentes recientes del trabajador (5 shapes: workerUid,
//     affectedWorkerUid, involvedWorkers, affectedWorkerUids, workers
//     subdoc)
//   - Completed tasks bucketed por process.type para experience count
//
// Llama `computeReadiness(profile, task)` del servicio inmutable y
// devuelve el `ReadinessReport` exacto.
//
// Preserva todos los Codex P1+P2 fixes (rounds 1-2 PR #315):
//   - EPP project-scoped (sin cross-project leak)
//   - 5 incident shapes incluidos
//   - Training status gate: assigned/pending/scheduled/in_progress no
//     cuentan como completados (anti-falso-positivo)
//   - EPP label union: category + type + kind + name + eppItemName + itemLabel
//   - Medical aptitude: 4 sources (medicalAptitudeStatus, medicalStatus,
//     medicalAptitude.lastEvaluation, medicalClearanceDate)
//   - Signed docs union: signedDocuments + acknowledgements + odiSigned
//     + digitalSignatureStatus
//   - Task category resolución vía processDoc.type para organic tasks
//   - Experience count: typed experienceByCategory + completed tasks
//     bucketed por process.type (batched getAll en chunks de 10)
//   - Requirements de 4 capas: task doc + processDoc + processType
//     baseline + fuzzy resolve ONE-WAY (owned contiene req)

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

// ── GET /:projectId/worker-readiness/:workerUid ───────────────────────

router.get(
  '/:projectId/worker-readiness/:workerUid',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, workerUid } = req.params;
    const taskIdParam =
      typeof req.query.taskId === 'string' && req.query.taskId.length > 0
        ? req.query.taskId
        : null;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { computeReadiness } = await import(
        '../../services/workerReadiness/readinessScore.js'
      );
      const db = admin.firestore();

      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T>,
        fallback: T,
      ): Promise<T> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`workerReadiness.read.${label}.failed`, err);
          return fallback;
        }
      };

      const workerDocPromise = safeRead(
        'worker',
        async () => {
          const snap = await db
            .collection('projects')
            .doc(projectId)
            .collection('workers')
            .doc(workerUid)
            .get();
          return snap.exists
            ? (snap.data() as Record<string, unknown>)
            : null;
        },
        null as Record<string, unknown> | null,
      );

      const trainingsPromise = safeRead(
        'trainings',
        async () => {
          const [
            nestedSnap,
            projectTrainingsByUid,
            projectTrainingsByWorkerId,
            topSnap,
            topByAttendees,
          ] = await Promise.all([
            db
              .collection('projects')
              .doc(projectId)
              .collection('training_assignments')
              .where('workerUid', '==', workerUid)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.trainingAssignments.failed',
                  err,
                );
                return null;
              }),
            db
              .collection('projects')
              .doc(projectId)
              .collection('trainings')
              .where('workerUid', '==', workerUid)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.projectTrainingsByUid.failed',
                  err,
                );
                return null;
              }),
            db
              .collection('projects')
              .doc(projectId)
              .collection('trainings')
              .where('workerId', '==', workerUid)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.projectTrainingsByWorkerId.failed',
                  err,
                );
                return null;
              }),
            db
              .collection('training')
              .where('projectId', '==', projectId)
              .where('workerUid', '==', workerUid)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.topTrainingByUid.failed',
                  err,
                );
                return null;
              }),
            db
              .collection('training')
              .where('projectId', '==', projectId)
              .where('status', '==', 'completed')
              .where('attendees', 'array-contains', workerUid)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.topTrainingByAttendees.failed',
                  err,
                );
                return null;
              }),
          ]);
          const all = new Map<string, Record<string, unknown>>();
          if (nestedSnap) {
            for (const d of nestedSnap.docs) {
              all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (projectTrainingsByUid) {
            for (const d of projectTrainingsByUid.docs) {
              if (!all.has(d.id))
                all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (projectTrainingsByWorkerId) {
            for (const d of projectTrainingsByWorkerId.docs) {
              if (!all.has(d.id))
                all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (topSnap) {
            for (const d of topSnap.docs) {
              if (!all.has(d.id))
                all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (topByAttendees) {
            for (const d of topByAttendees.docs) {
              if (!all.has(d.id))
                all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          return Array.from(all.values());
        },
        [] as Array<Record<string, unknown>>,
      );

      const eppPromise = safeRead(
        'epp',
        async () => {
          const [
            nestedByWorkerId,
            nestedByWorkerUid,
            topByUid,
            topByAssignedTo,
          ] = await Promise.all([
            db
              .collection('projects')
              .doc(projectId)
              .collection('epp_assignments')
              .where('workerId', '==', workerUid)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.eppNestedByWorkerId.failed',
                  err,
                );
                return null;
              }),
            db
              .collection('projects')
              .doc(projectId)
              .collection('epp_assignments')
              .where('workerUid', '==', workerUid)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.eppNestedByWorkerUid.failed',
                  err,
                );
                return null;
              }),
            db
              .collection('epp_assignments')
              .where('projectId', '==', projectId)
              .where('workerUid', '==', workerUid)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.eppTopByUid.failed',
                  err,
                );
                return null;
              }),
            db
              .collection('epp_assignments')
              .where('projectId', '==', projectId)
              .where('assignedTo', '==', workerUid)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.eppTopByAssignedTo.failed',
                  err,
                );
                return null;
              }),
          ]);
          const all = new Map<string, Record<string, unknown>>();
          if (nestedByWorkerId) {
            for (const d of nestedByWorkerId.docs) {
              all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (nestedByWorkerUid) {
            for (const d of nestedByWorkerUid.docs) {
              if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (topByUid) {
            for (const d of topByUid.docs) {
              if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (topByAssignedTo) {
            for (const d of topByAssignedTo.docs) {
              if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          return Array.from(all.values());
        },
        [] as Array<Record<string, unknown>>,
      );

      const taskPromise = safeRead(
        'task',
        async () => {
          if (!taskIdParam) return null;
          const snap = await db.collection('tasks').doc(taskIdParam).get();
          if (!snap.exists) return null;
          const data = snap.data() as Record<string, unknown>;
          if (
            typeof data.projectId === 'string' &&
            data.projectId !== projectId
          ) {
            return null;
          }
          return { id: snap.id, ...data };
        },
        null as Record<string, unknown> | null,
      );

      const ninetyDaysAgo = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const incidentsPromise = safeRead(
        'incidents',
        async () => {
          const baseQuery = db
            .collection('incidents')
            .where('projectId', '==', projectId)
            .where('occurredAt', '>=', ninetyDaysAgo);
          const [
            byWorkerUid,
            byAffectedWorkerUid,
            byInvolvedWorkers,
            byAffectedWorkerUids,
          ] = await Promise.all([
            baseQuery
              .where('workerUid', '==', workerUid)
              .limit(50)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.incidentsByWorkerUid.failed',
                  err,
                );
                return null;
              }),
            baseQuery
              .where('affectedWorkerUid', '==', workerUid)
              .limit(50)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.incidentsByAffectedWorkerUid.failed',
                  err,
                );
                return null;
              }),
            baseQuery
              .where('involvedWorkers', 'array-contains', workerUid)
              .limit(50)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.incidentsByInvolvedWorkers.failed',
                  err,
                );
                return null;
              }),
            baseQuery
              .where('affectedWorkerUids', 'array-contains', workerUid)
              .limit(50)
              .get()
              .catch((err) => {
                logger.warn?.(
                  'workerReadiness.read.incidentsByAffectedWorkerUids.failed',
                  err,
                );
                return null;
              }),
          ]);
          const all = new Map<string, Record<string, unknown>>();
          const merge = (snap: FirebaseFirestore.QuerySnapshot | null) => {
            if (!snap) return;
            for (const d of snap.docs) {
              if (!all.has(d.id)) {
                all.set(d.id, d.data() as Record<string, unknown>);
              }
            }
          };
          merge(byWorkerUid);
          merge(byAffectedWorkerUid);
          merge(byInvolvedWorkers);
          merge(byAffectedWorkerUids);
          return Array.from(all.values()).filter((data) => {
            const inv = data.involvedWorkers;
            if (Array.isArray(inv) && inv.includes(workerUid)) return true;
            const invUids = data.affectedWorkerUids;
            if (Array.isArray(invUids) && invUids.includes(workerUid))
              return true;
            if (data.affectedWorkerUid === workerUid) return true;
            if (data.workerUid === workerUid) return true;
            const workers = data.workers;
            if (Array.isArray(workers)) {
              for (const w of workers) {
                if (
                  w &&
                  typeof w === 'object' &&
                  (w as { uid?: string }).uid === workerUid
                ) {
                  return true;
                }
              }
            }
            return false;
          });
        },
        [] as Array<Record<string, unknown>>,
      );

      const completedTasksPromise = safeRead(
        'completedTasks',
        async () => {
          const snap = await db
            .collection('tasks')
            .where('projectId', '==', projectId)
            .where('assignedUids', 'array-contains', workerUid)
            .where('status', '==', 'done')
            .limit(500)
            .get();
          return snap.docs.map(
            (d) => ({ id: d.id, ...d.data() } as Record<string, unknown>),
          );
        },
        [] as Array<Record<string, unknown>>,
      );

      const [worker, trainings, epps, taskDoc, incidents, completedTasks] =
        await Promise.all([
          workerDocPromise,
          trainingsPromise,
          eppPromise,
          taskPromise,
          incidentsPromise,
          completedTasksPromise,
        ]);

      if (!worker) {
        return res.status(404).json({ error: 'worker_not_found' });
      }

      let processDoc: Record<string, unknown> | null = null;
      if (
        taskDoc &&
        typeof taskDoc.processId === 'string' &&
        taskDoc.processId.length > 0
      ) {
        processDoc = await safeRead(
          'process',
          async () => {
            const snap = await db
              .collection('processes')
              .doc(taskDoc.processId as string)
              .get();
            if (!snap.exists) return null;
            const data = snap.data() as Record<string, unknown>;
            if (
              typeof data.projectId === 'string' &&
              data.projectId !== projectId
            ) {
              return null;
            }
            return data;
          },
          null as Record<string, unknown> | null,
        );
      }

      // ── Build WorkerProfile ───────────────────────────────────────

      const nowIso = new Date().toISOString();
      const activeTrainings: string[] = [];
      const trainingNotCompletedStatuses = new Set<string>([
        'assigned',
        'pending',
        'scheduled',
        'in_progress',
        'expired',
        'cancelled',
        'canceled',
        'rejected',
        'no_show',
      ]);
      for (const t of trainings) {
        const expiry =
          (typeof t.expiresAt === 'string' && t.expiresAt) ||
          (typeof t.validUntil === 'string' && t.validUntil) ||
          null;
        const expired = expiry !== null && expiry < nowIso;
        if (expired) continue;
        if (
          typeof t.status === 'string' &&
          trainingNotCompletedStatuses.has(t.status)
        ) {
          continue;
        }
        const code =
          (typeof t.code === 'string' && t.code) ||
          (typeof t.trainingCode === 'string' && t.trainingCode) ||
          (typeof t.name === 'string' && t.name) ||
          (typeof t.title === 'string' && t.title) ||
          (typeof t.id === 'string' && t.id) ||
          null;
        if (code) activeTrainings.push(code);
      }

      const activeEpp: string[] = [];
      for (const e of epps) {
        const expiry =
          (typeof e.expiresAt === 'string' && e.expiresAt) ||
          (typeof e.validUntil === 'string' && e.validUntil) ||
          null;
        const expired = expiry !== null && expiry < nowIso;
        if (expired) continue;
        const cat =
          (typeof e.category === 'string' && e.category) ||
          (typeof e.type === 'string' && e.type) ||
          (typeof e.kind === 'string' && e.kind) ||
          (typeof e.name === 'string' && e.name) ||
          (typeof e.eppItemName === 'string' && e.eppItemName) ||
          (typeof e.itemLabel === 'string' && e.itemLabel) ||
          null;
        if (cat) activeEpp.push(cat);
      }

      const medRaw = worker.medicalAptitudeStatus ?? worker.medicalStatus;
      let medicalAptitudeStatus:
        | 'vigente'
        | 'expirada'
        | 'restringida'
        | 'sin_aptitud' =
        medRaw === 'vigente' ||
        medRaw === 'expirada' ||
        medRaw === 'restringida'
          ? medRaw
          : 'sin_aptitud';
      if (medicalAptitudeStatus === 'sin_aptitud') {
        const medApt = worker.medicalAptitude;
        if (medApt && typeof medApt === 'object') {
          const lastEvalRaw = (medApt as Record<string, unknown>)
            .lastEvaluation;
          const lastEval =
            typeof lastEvalRaw === 'string' ? lastEvalRaw : null;
          const expiryRaw =
            (medApt as Record<string, unknown>).expiresAt ??
            (medApt as Record<string, unknown>).validUntil;
          const expiry = typeof expiryRaw === 'string' ? expiryRaw : null;
          if (lastEval) {
            medicalAptitudeStatus =
              expiry !== null && expiry < nowIso ? 'expirada' : 'vigente';
          }
        }
      }
      if (medicalAptitudeStatus === 'sin_aptitud') {
        const clrDate = worker.medicalClearanceDate;
        if (typeof clrDate === 'string' && clrDate.length > 0) {
          medicalAptitudeStatus = 'vigente';
        }
      }

      const signedDocsRaw =
        worker.signedDocuments ?? worker.acknowledgements;
      const signedDocsSet = new Set<string>(
        Array.isArray(signedDocsRaw)
          ? (signedDocsRaw.filter((s) => typeof s === 'string') as string[])
          : [],
      );
      if (worker.odiSigned === true) {
        signedDocsSet.add('ODI');
      }
      if (worker.digitalSignatureStatus === 'Firmado') {
        signedDocsSet.add('DIGITAL');
      }
      const signedDocuments: string[] = Array.from(signedDocsSet);

      const fatRaw = worker.fatigueLevel;
      const fatigueLevel: 'low' | 'moderate' | 'high' | 'critical' =
        fatRaw === 'moderate' || fatRaw === 'high' || fatRaw === 'critical'
          ? fatRaw
          : 'low';

      let daysSinceLastIncident = 90;
      if (incidents.length > 0) {
        const mostRecent = incidents
          .map((i) =>
            typeof i.occurredAt === 'string' ? i.occurredAt : '',
          )
          .filter((s) => s.length > 0)
          .sort()
          .reverse()[0];
        if (mostRecent) {
          const diffMs = Date.now() - new Date(mostRecent).getTime();
          daysSinceLastIncident = Math.max(
            0,
            Math.min(90, Math.floor(diffMs / (24 * 60 * 60 * 1000))),
          );
        }
      }

      const taskCategoryRaw =
        (taskDoc && typeof taskDoc.riskCategory === 'string'
          ? taskDoc.riskCategory
          : null) ??
        (taskDoc && typeof taskDoc.category === 'string'
          ? taskDoc.category
          : null) ??
        (processDoc && typeof processDoc.type === 'string'
          ? processDoc.type
          : null) ??
        'general';
      const taskCategory = taskCategoryRaw;

      let taskCategoryExperienceCount = 0;
      const expMap = worker.experienceByCategory;
      if (expMap && typeof expMap === 'object') {
        const v = (expMap as Record<string, unknown>)[taskCategory];
        if (typeof v === 'number') taskCategoryExperienceCount = v;
      }
      if (completedTasks.length > 0) {
        const processIds = new Set<string>();
        for (const t of completedTasks) {
          if (typeof t.processId === 'string' && t.processId.length > 0) {
            processIds.add(t.processId);
          }
        }
        const processIdToType = new Map<string, string>();
        if (processIds.size > 0) {
          const ids = Array.from(processIds);
          const chunks: string[][] = [];
          for (let i = 0; i < ids.length; i += 10) {
            chunks.push(ids.slice(i, i + 10));
          }
          await Promise.all(
            chunks.map(async (chunk) => {
              try {
                const refs = chunk.map((id) =>
                  db.collection('processes').doc(id),
                );
                const snaps = await db.getAll(...refs);
                for (const snap of snaps) {
                  if (!snap.exists) continue;
                  const data = snap.data() as Record<string, unknown>;
                  if (
                    typeof data.projectId === 'string' &&
                    data.projectId !== projectId
                  ) {
                    continue;
                  }
                  if (
                    typeof data.type === 'string' &&
                    data.type.length > 0
                  ) {
                    processIdToType.set(snap.id, data.type);
                  }
                }
              } catch (err) {
                logger.warn?.(
                  'workerReadiness.read.processBatch.failed',
                  err,
                );
              }
            }),
          );
        }
        let historyCount = 0;
        for (const t of completedTasks) {
          const pid = typeof t.processId === 'string' ? t.processId : null;
          if (!pid) continue;
          const ptype = processIdToType.get(pid);
          if (ptype && ptype === taskCategory) historyCount += 1;
        }
        taskCategoryExperienceCount += historyCount;
      }

      const profile = {
        workerUid,
        activeTrainings,
        activeEpp,
        medicalAptitudeStatus,
        signedDocuments,
        taskCategoryExperienceCount,
        fatigueLevel,
        daysSinceLastIncident,
      };

      // ── Build TaskRequirements ────────────────────────────────────

      const processTypeBaseline: Record<
        string,
        {
          trainings: string[];
          epp: string[];
          acks: string[];
          requiresMedical: boolean;
        }
      > = {
        soldadura: {
          trainings: ['Soldadura', 'Trabajo en caliente'],
          epp: ['casco', 'careta', 'guantes', 'mandil'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        instalacion_electrica: {
          trainings: ['Trabajo eléctrico', 'Bloqueo y etiquetado (LOTO)'],
          epp: ['casco', 'guantes dieléctricos', 'calzado dieléctrico'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        demolicion: {
          trainings: ['Demolición segura', 'Trabajo en altura'],
          epp: ['casco', 'gafas', 'arnés'],
          acks: ['ODI'],
          requiresMedical: true,
        },
        fachada: {
          trainings: ['Trabajo en altura'],
          epp: ['arnés', 'casco', 'línea de vida'],
          acks: ['ODI'],
          requiresMedical: true,
        },
        movimiento_tierras: {
          trainings: ['Operación maquinaria pesada'],
          epp: ['casco', 'chaleco reflectante', 'calzado seguridad'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        concreto: {
          trainings: [],
          epp: ['casco', 'guantes', 'botas'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        mantenimiento: {
          trainings: ['Bloqueo y etiquetado (LOTO)'],
          epp: ['casco', 'guantes', 'gafas'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        pintura: {
          trainings: ['Manejo solventes'],
          epp: ['respirador', 'guantes', 'gafas'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        topografia: {
          trainings: [],
          epp: ['casco'],
          acks: [],
          requiresMedical: false,
        },
        transporte: {
          trainings: ['Conducción defensiva'],
          epp: ['chaleco reflectante'],
          acks: ['ODI'],
          requiresMedical: true,
        },
      };

      const collectStrings = (
        src: Record<string, unknown> | null,
        key: string,
      ): string[] => {
        if (!src) return [];
        const v = src[key];
        if (!Array.isArray(v)) return [];
        return v.filter((s): s is string => typeof s === 'string');
      };

      const reqTrainingsSet = new Set<string>();
      for (const s of collectStrings(taskDoc, 'requiredTrainings'))
        reqTrainingsSet.add(s);
      for (const s of collectStrings(taskDoc, 'requiredTrainingIds'))
        reqTrainingsSet.add(s);
      for (const s of collectStrings(processDoc, 'requiredTrainings'))
        reqTrainingsSet.add(s);
      for (const s of collectStrings(processDoc, 'requiredTrainingIds'))
        reqTrainingsSet.add(s);

      const reqEppSet = new Set<string>();
      for (const s of collectStrings(taskDoc, 'requiredEpp'))
        reqEppSet.add(s);
      for (const s of collectStrings(taskDoc, 'requiredEppIds'))
        reqEppSet.add(s);
      for (const s of collectStrings(processDoc, 'requiredEpp'))
        reqEppSet.add(s);
      for (const s of collectStrings(processDoc, 'requiredEppIds'))
        reqEppSet.add(s);

      const reqAcksSet = new Set<string>();
      for (const s of collectStrings(taskDoc, 'requiredAcknowledgements'))
        reqAcksSet.add(s);
      for (const s of collectStrings(processDoc, 'requiredAcknowledgements'))
        reqAcksSet.add(s);

      let requiresMedicalAptitude: boolean = false;
      if (taskDoc)
        requiresMedicalAptitude = Boolean(taskDoc.requiresMedicalAptitude);
      if (!requiresMedicalAptitude && processDoc) {
        requiresMedicalAptitude = Boolean(
          processDoc.requiresMedicalAptitude,
        );
      }

      if (processDoc && typeof processDoc.type === 'string') {
        const baseline = processTypeBaseline[processDoc.type];
        if (baseline) {
          for (const s of baseline.trainings) reqTrainingsSet.add(s);
          for (const s of baseline.epp) reqEppSet.add(s);
          for (const s of baseline.acks) reqAcksSet.add(s);
          if (baseline.requiresMedical) requiresMedicalAptitude = true;
        }
      }

      const fuzzyResolve = (req: string, owned: string[]): string => {
        const reqLower = req.toLowerCase().trim();
        if (reqLower.length === 0) return req;
        for (const item of owned) {
          const itemLower = item.toLowerCase();
          if (itemLower.includes(reqLower)) {
            return item;
          }
        }
        return req;
      };
      const reqTrainings = Array.from(reqTrainingsSet).map((r) =>
        fuzzyResolve(r, activeTrainings),
      );
      const reqEpp = Array.from(reqEppSet).map((r) =>
        fuzzyResolve(r, activeEpp),
      );
      const reqAcks = Array.from(reqAcksSet);

      const task = {
        requiredTrainings: reqTrainings,
        requiredEpp: reqEpp,
        taskCategory,
        requiresMedicalAptitude,
        requiredAcknowledgements: reqAcks,
      };

      const report = computeReadiness(profile, task);

      return res.json({ report });
    } catch (err) {
      logger.error?.('workerReadiness.error', err);
      captureRouteError(err, 'workerReadiness');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
