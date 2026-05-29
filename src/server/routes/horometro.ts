// Praeventio Guard — Bloque 4.1: Horometro routes.
//
// HTTP surface for the Horometro -> Mantenimiento Preventivo flow.
// Mirror del patron de equipmentQr.ts:
//
//   POST /:projectId/horometro/reading                                   — worker reporta horas
//   GET  /:projectId/horometro/equipment/:eqId/maintenance-tasks         — listar tareas activas
//   POST /:projectId/horometro/maintenance-task/:taskId/complete         — cerrar tarea con firma
//
// ADR 0019: persistencia 100% Firestore (Google) via los stores
// inyectados a horometroService + maintenanceScheduler.
//
// Founder directive — NUNCA bloquear maquinaria:
//   Cuando el horometro detecta un umbral cruzado, la tarea queda
//   creada con estado `open`. El equipo NO se marca `bloqueado` ni
//   `fuera_servicio`. Si el supervisor o el flow externo deciden
//   restringir el uso, lo hace via equipmentQrService.updateStatus()
//   con un evento separado. Aqui solo recomendamos via la cadena ZK.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { EquipmentAdapter } from '../../services/equipment/equipmentFirestoreAdapter.js';
import {
  recordReading,
  getCurrentHours,
  HorometroValidationError,
  type HorometroStore,
  type HorometroReading,
  type HorometroSource,
} from '../../services/horometro/horometroService.js';
import {
  getActiveTasksByProject,
  completeMaintenanceTask,
  MaintenanceSchedulerError,
  type MaintenanceTask,
  type MaintenanceTaskStore,
} from '../../services/maintenance/maintenanceScheduler.js';
import {
  onHorometroReading,
  onMaintenanceCompleted,
  type WriteNodesFn,
  type CreateEdgeFn,
} from '../../services/zettelkasten/flows/horometroMaintenanceFlow.js';
import { writeNodes } from '../../services/zettelkasten/persistence/writeNode.js';
import { createEdge } from '../../services/zettelkasten/edges.js';
import { buildEdgeStore } from '../../services/zettelkasten/edgeStoreFirestore.js';

const router = Router();

// ── Guard helpers (clon del patron equipmentQr.ts) ───────────────────

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

// ── Firestore adapters ───────────────────────────────────────────────
//
// Mantenemos los adapters inline porque su superficie es minima y los
// tests del flow se hacen con stores fake — no necesitamos exportar
// estos a su propio archivo todavia.

const HOROMETRO_PATH = (tid: string, pid: string, eqId: string) =>
  `tenants/${tid}/projects/${pid}/equipment/${eqId}/horometro_readings`;
const TASK_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/maintenance_tasks`;

function buildHorometroStore(
  db: admin.firestore.Firestore,
): HorometroStore {
  return {
    async saveReading({ tenantId, projectId, equipmentId, reading }) {
      await db
        .collection(HOROMETRO_PATH(tenantId, projectId, equipmentId))
        .doc()
        .set(reading);
    },
    async getLatestReading({ tenantId, projectId, equipmentId }) {
      const snap = await db
        .collection(HOROMETRO_PATH(tenantId, projectId, equipmentId))
        .orderBy('hours', 'desc')
        .limit(1)
        .get();
      if (snap.empty) return null;
      return snap.docs[0]!.data() as HorometroReading;
    },
    async getLastMaintenanceHours({ tenantId, projectId, equipmentId }) {
      // Lee el ultimo doc maintenance_tasks con status='completed' para
      // este equipo. Si no hay, devuelve 0.
      const snap = await db
        .collection(TASK_PATH(tenantId, projectId))
        .where('equipmentId', '==', equipmentId)
        .where('status', '==', 'completed')
        .orderBy('triggeredAtHours', 'desc')
        .limit(1)
        .get();
      if (snap.empty) return 0;
      const t = snap.docs[0]!.data() as MaintenanceTask;
      return t.completion?.horometroAtCompletion ?? t.triggeredAtHours;
    },
  };
}

function buildTaskStore(
  db: admin.firestore.Firestore,
  tenantId: string,
): MaintenanceTaskStore {
  return {
    async saveTask(task) {
      await db
        .collection(TASK_PATH(tenantId, task.projectId))
        .doc(task.id)
        .set(task, { merge: true });
    },
    async getTaskById({ projectId, taskId }) {
      const snap = await db
        .collection(TASK_PATH(tenantId, projectId))
        .doc(taskId)
        .get();
      return snap.exists ? (snap.data() as MaintenanceTask) : null;
    },
    async listActiveByProject({ projectId, equipmentId, statuses, limit }) {
      const list = statuses ?? ['open', 'scheduled', 'in_progress'];
      let q: any = db
        .collection(TASK_PATH(tenantId, projectId))
        .where('status', 'in', list);
      if (equipmentId) q = q.where('equipmentId', '==', equipmentId);
      q = q.limit(limit ?? 100);
      const snap = await q.get();
      return snap.docs.map((d: any) => d.data() as MaintenanceTask);
    },
  };
}

// Use writeNodes from persistence layer directly. Wrap in the flow's
// minimal interface so the impl can ignore the broader return shape.
const writeNodesAdapter: WriteNodesFn = async (nodes, ctx) => {
  const res = await writeNodes([...nodes], ctx);
  return {
    ok: res.ok,
    ids: res.ids,
    queued: res.queued,
    error: res.error,
  };
};

function buildCreateEdgeAdapter(db: admin.firestore.Firestore): CreateEdgeFn {
  const store = buildEdgeStore(db);
  return async (input) => {
    await createEdge(store, {
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      type: input.type,
      tenantId: input.tenantId,
      createdBy: input.createdBy,
      projectId: input.projectId,
    });
  };
}

// ── Schemas ──────────────────────────────────────────────────────────

const horometroSourceSchema = z.enum([
  'qr_entry',
  'manual',
  'iot',
  'integration',
]) as unknown as z.ZodType<HorometroSource>;

const readingSchema = z.object({
  equipmentId: z.string().min(1).max(200),
  hours: z.number().finite().min(0).max(1_000_000),
  source: horometroSourceSchema,
  notes: z.string().max(2_000).optional(),
});

const completeTaskSchema = z.object({
  notes: z.string().min(1).max(5_000),
  biometricSignatureHash: z.string().min(8).max(200).optional(),
  horometroAtCompletion: z.number().finite().min(0).max(1_000_000).optional(),
});

// ── 1. POST /:projectId/horometro/reading ────────────────────────────

router.post(
  '/:projectId/horometro/reading',
  verifyAuth,
  idempotencyKey(),
  validate(readingSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof readingSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const db = admin.firestore() as admin.firestore.Firestore;
    try {
      // Resolver equipo + tipo via EquipmentAdapter (single source of truth).
      const eqAdapter = new EquipmentAdapter(db as any, g.tenantId, projectId);
      const equipment = await eqAdapter.getById(body.equipmentId);
      if (!equipment) {
        return res.status(404).json({ error: 'equipment_not_found' });
      }
      const horoStore = buildHorometroStore(db);
      const taskStore = buildTaskStore(db, g.tenantId);
      let reading: HorometroReading;
      try {
        reading = await recordReading(
          {
            tenantId: g.tenantId,
            projectId,
            equipmentId: body.equipmentId,
            hours: body.hours,
            source: body.source,
            reportedByUid: callerUid,
            notes: body.notes,
          },
          horoStore,
        );
      } catch (err) {
        if (err instanceof HorometroValidationError) {
          return res.status(422).json({
            error: 'horometro_validation_error',
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
      const lastMaintenanceHours = await horoStore.getLastMaintenanceHours({
        tenantId: g.tenantId,
        projectId,
        equipmentId: body.equipmentId,
      });
      const flowResult = await onHorometroReading(
        {
          tenantId: g.tenantId,
          projectId,
          equipmentId: body.equipmentId,
          equipmentType: equipment.type,
          reading,
          lastMaintenanceHours,
          createdByUid: callerUid,
        },
        {
          writeNodes: writeNodesAdapter,
          createEdge: buildCreateEdgeAdapter(db),
          taskStore,
          logger,
        },
      );
      return res.status(201).json({
        reading,
        flow: flowResult,
      });
    } catch (err) {
      logger.error?.('horometro.reading.error', err);
      captureRouteError(err, 'horometro.reading', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── 2. GET /:projectId/horometro/equipment/:eqId/maintenance-tasks ───

router.get(
  '/:projectId/horometro/equipment/:eqId/maintenance-tasks',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, eqId } = req.params;
    if (!eqId || eqId.length < 1 || eqId.length > 200) {
      return res.status(400).json({ error: 'invalid_equipment_id' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const db = admin.firestore() as admin.firestore.Firestore;
    try {
      const taskStore = buildTaskStore(db, g.tenantId);
      const tasks = await getActiveTasksByProject(
        {
          tenantId: g.tenantId,
          projectId,
          equipmentId: eqId,
          limit: 200,
        },
        taskStore,
      );
      const currentHours = await getCurrentHours(
        { tenantId: g.tenantId, projectId, equipmentId: eqId },
        buildHorometroStore(db),
      );
      return res.json({ tasks, currentHours });
    } catch (err) {
      logger.error?.('horometro.listTasks.error', err);
      captureRouteError(err, 'horometro.listTasks', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── 3. POST /:projectId/horometro/maintenance-task/:taskId/complete ──

router.post(
  '/:projectId/horometro/maintenance-task/:taskId/complete',
  verifyAuth,
  idempotencyKey(),
  validate(completeTaskSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, taskId } = req.params;
    const body = req.validated as z.infer<typeof completeTaskSchema>;
    if (!taskId || taskId.length < 1 || taskId.length > 200) {
      return res.status(400).json({ error: 'invalid_task_id' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const db = admin.firestore() as admin.firestore.Firestore;
    try {
      const taskStore = buildTaskStore(db, g.tenantId);
      let updated: MaintenanceTask;
      try {
        updated = await completeMaintenanceTask(
          {
            tenantId: g.tenantId,
            projectId,
            taskId,
            completedByUid: callerUid,
            notes: body.notes,
            biometricSignatureHash: body.biometricSignatureHash,
            horometroAtCompletion: body.horometroAtCompletion,
          },
          taskStore,
        );
      } catch (err) {
        if (err instanceof MaintenanceSchedulerError) {
          const status = err.code === 'TASK_NOT_FOUND' ? 404 : 409;
          return res.status(status).json({
            error: 'maintenance_complete_error',
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
      if (!updated.completion) {
        // Defensive — completeMaintenanceTask siempre setea completion.
        return res.status(500).json({ error: 'completion_missing' });
      }
      const flowResult = await onMaintenanceCompleted(
        {
          tenantId: g.tenantId,
          projectId,
          task: updated,
          completion: updated.completion,
        },
        {
          writeNodes: writeNodesAdapter,
          createEdge: buildCreateEdgeAdapter(db),
          logger,
        },
      );
      return res.json({
        task: updated,
        flow: flowResult,
      });
    } catch (err) {
      logger.error?.('horometro.completeTask.error', err);
      captureRouteError(err, 'horometro.completeTask', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
