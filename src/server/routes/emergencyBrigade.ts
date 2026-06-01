// Praeventio Guard — §74-78 Brigada de Emergencia + Recursos.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/emergency-brigade*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 4 endpoints:
//   GET  /:projectId/emergency-brigade                          → snapshot
//   POST /:projectId/emergency-brigade/members                  → add brigadist
//   POST /:projectId/emergency-brigade/resources                → add resource
//   POST /:projectId/emergency-brigade/resources/:id/inspect    → inspection
//
// Storage path: `tenants/{tid}/projects/{pid}/emergency_brigade/{id}`
//   - docType='member'      → brigadistas
//   - docType='resource'    → recursos (extintor / AED / eyewash / etc)
//   - docType='inspection'  → historial inspecciones
//
// El servicio `emergencyBrigadeService` es puro — aquí persistimos
// state, allá calculamos el report.
//
// Codex P1+P2 fixes preservados (PR #321 rounds 1-2):
//   - isoPastDate / isoDate validators rechazan "not-a-date" + futuro
//   - Role gate BRIGADE_WRITE_ROLES (admin/prevencionista/supervisor/brigade_chief)
//   - workerIsProjectMember chequea AMBAS fuentes (legacy array + canonical subcol)
//   - Deterministic member id por (workerUid, role) anti-duplicados
//   - Empty inventory cuenta como gap (readiness no se queda verde con 0 recursos)

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  buildBrigadeCoverageReport,
  buildResourceReadinessReport,
  type BrigadeMember,
  type BrigadeRole,
  type EmergencyResource,
} from '../../services/emergencyBrigade/emergencyBrigadeService.js';

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

// ── Schemas + role gate + helpers ─────────────────────────────────────

const brigadeRoleEnum = z.enum([
  'brigade_chief',
  'first_aid',
  'fire_response',
  'evacuation_coordinator',
  'communications',
]);

const resourceKindEnum = z.enum([
  'extinguisher',
  'first_aid_kit',
  'aed',
  'eyewash',
  'safety_shower',
  'fire_hose',
  'spill_kit',
]);

const isoPastDate = z
  .string()
  .min(10)
  .refine((s) => Number.isFinite(Date.parse(s)), {
    message: 'invalid_iso_date',
  })
  .refine((s) => Date.parse(s) <= Date.now(), {
    message: 'date_in_future',
  });

const isoDate = z
  .string()
  .min(10)
  .refine((s) => Number.isFinite(Date.parse(s)), {
    message: 'invalid_iso_date',
  });

const BRIGADE_WRITE_ROLES = new Set([
  'admin',
  'prevencionista',
  'supervisor',
  'brigade_chief',
]);

function callerCanWriteBrigade(
  req: import('express').Request,
): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.admin === true) return true;
  if (typeof u.role === 'string' && BRIGADE_WRITE_ROLES.has(u.role)) {
    return true;
  }
  const tenants = (u as unknown as {
    tenants?: Record<string, { role?: string }>;
  }).tenants;
  if (
    tenants &&
    typeof tenants === 'object' &&
    typeof u.tenantId === 'string'
  ) {
    const t = tenants[u.tenantId];
    if (
      t &&
      typeof t.role === 'string' &&
      BRIGADE_WRITE_ROLES.has(t.role)
    ) {
      return true;
    }
  }
  return false;
}

async function workerIsProjectMember(
  workerUid: string,
  projectId: string,
): Promise<boolean> {
  const db = admin.firestore();
  try {
    const snap = await db.collection('projects').doc(projectId).get();
    if (snap.exists) {
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      const members = data.members;
      const createdBy = data.createdBy;
      if (Array.isArray(members) && members.includes(workerUid))
        return true;
      if (typeof createdBy === 'string' && createdBy === workerUid)
        return true;
    }
  } catch (err) {
    logger.warn?.(
      'emergencyBrigade.workerIsProjectMember.legacyArray.failed',
      err,
    );
  }
  try {
    const memberDoc = await db
      .collection('projects')
      .doc(projectId)
      .collection('members')
      .doc(workerUid)
      .get();
    if (memberDoc.exists) return true;
  } catch (err) {
    logger.warn?.(
      'emergencyBrigade.workerIsProjectMember.subcollection.failed',
      err,
    );
  }
  return false;
}

// ── GET /:projectId/emergency-brigade ─────────────────────────────────

router.get(
  '/:projectId/emergency-brigade',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );

      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`emergencyBrigade.read.${label}.failed`, err);
          return [];
        }
      };

      const [members, resources] = await Promise.all([
        safeRead<BrigadeMember & { id: string }>('members', async () => {
          const snap = await baseRef
            .where('docType', '==', 'member')
            .get();
          return snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              workerUid: String(data.workerUid ?? ''),
              role: (data.role ?? 'brigade_chief') as BrigadeRole,
              trainedAt: String(data.trainedAt ?? ''),
              trainingValidYears:
                typeof data.trainingValidYears === 'number'
                  ? data.trainingValidYears
                  : 2,
              active: data.active !== false,
            };
          });
        }),
        safeRead<EmergencyResource>('resources', async () => {
          const snap = await baseRef
            .where('docType', '==', 'resource')
            .get();
          return snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              kind: (data.kind ?? 'extinguisher') as EmergencyResource['kind'],
              location: String(data.location ?? ''),
              lastInspectedAt: String(data.lastInspectedAt ?? ''),
              nextExpirationAt: String(data.nextExpirationAt ?? ''),
              operational: data.operational !== false,
            };
          });
        }),
      ]);

      const brigadeReport = buildBrigadeCoverageReport(members);
      const resourceReport = buildResourceReadinessReport(resources);

      const coverageGapCount = brigadeReport.uncoveredRoles.length;
      const resourceGapCount = resourceReport.needingAttention.length;
      const emptyInventoryGap =
        resourceReport.totalResources === 0 ? 1 : 0;
      const totalGaps =
        coverageGapCount + resourceGapCount + emptyInventoryGap;
      let readinessLevel: 'green' | 'amber' | 'rose';
      if (totalGaps === 0 && brigadeReport.meetsMinimum) {
        readinessLevel = 'green';
      } else if (
        totalGaps === 1 ||
        (totalGaps <= 2 && brigadeReport.meetsMinimum)
      ) {
        readinessLevel = 'amber';
      } else {
        readinessLevel = 'rose';
      }

      return res.json({
        members,
        resources,
        brigade: brigadeReport,
        resourceReadiness: resourceReport,
        readinessLevel,
      });
    } catch (err) {
      logger.error?.('emergencyBrigade.snapshot.error', err);
      captureRouteError(err, 'emergencyBrigade.snapshot');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/emergency-brigade/members ────────────────────────

const addBrigadeMemberSchema = z.object({
  workerUid: z.string().min(1).max(120),
  role: brigadeRoleEnum,
  trainedAt: isoPastDate,
  trainingValidYears: z.number().int().min(1).max(10).optional(),
  active: z.boolean().optional(),
});

router.post(
  '/:projectId/emergency-brigade/members',
  verifyAuth,
  validate(addBrigadeMemberSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof addBrigadeMemberSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!callerCanWriteBrigade(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(BRIGADE_WRITE_ROLES),
      });
    }
    if (!(await workerIsProjectMember(body.workerUid, projectId))) {
      return res.status(422).json({ error: 'worker_not_in_project' });
    }
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );
      const safeUid = body.workerUid.replace(/[^a-zA-Z0-9_-]/g, '_');
      const id = `member-${safeUid}-${body.role}`;
      const doc = baseRef.doc(id);
      const existing = await doc.get();
      if (existing.exists) {
        return res.status(409).json({
          error: 'worker_already_in_role',
          existingId: id,
        });
      }
      await doc.set({
        docType: 'member',
        workerUid: body.workerUid,
        role: body.role,
        trainedAt: body.trainedAt,
        trainingValidYears: body.trainingValidYears ?? 2,
        active: body.active !== false,
        createdAt: new Date().toISOString(),
        createdBy: callerUid,
      });
      await auditServerEvent(req, 'emergencyBrigade.addMember', 'emergencyBrigade', {
        projectId,
        memberId: id,
        workerUid: body.workerUid,
        role: body.role,
      }, { projectId });
      return res.status(201).json({ ok: true, id });
    } catch (err) {
      logger.error?.('emergencyBrigade.addMember.error', err);
      captureRouteError(err, 'emergencyBrigade.addMember');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/emergency-brigade/resources ──────────────────────

const addResourceSchema = z.object({
  kind: resourceKindEnum,
  location: z.string().min(1).max(240),
  lastInspectedAt: isoPastDate,
  nextExpirationAt: isoDate,
  operational: z.boolean().optional(),
});

router.post(
  '/:projectId/emergency-brigade/resources',
  verifyAuth,
  validate(addResourceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof addResourceSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!callerCanWriteBrigade(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(BRIGADE_WRITE_ROLES),
      });
    }
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );
      const doc = baseRef.doc();
      const id = doc.id;
      await doc.set({
        docType: 'resource',
        kind: body.kind,
        location: body.location,
        lastInspectedAt: body.lastInspectedAt,
        nextExpirationAt: body.nextExpirationAt,
        operational: body.operational !== false,
        createdAt: new Date().toISOString(),
        createdBy: callerUid,
      });
      await auditServerEvent(req, 'emergencyBrigade.addResource', 'emergencyBrigade', {
        projectId,
        resourceId: id,
        kind: body.kind,
      }, { projectId });
      return res.status(201).json({ ok: true, id });
    } catch (err) {
      logger.error?.('emergencyBrigade.addResource.error', err);
      captureRouteError(err, 'emergencyBrigade.addResource');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/emergency-brigade/resources/:id/inspect ──────────

const inspectResourceSchema = z.object({
  inspectedAt: isoPastDate,
  operational: z.boolean(),
  nextExpirationAt: isoDate.optional(),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/emergency-brigade/resources/:id/inspect',
  verifyAuth,
  validate(inspectResourceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof inspectResourceSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!callerCanWriteBrigade(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(BRIGADE_WRITE_ROLES),
      });
    }
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );
      const resourceRef = baseRef.doc(id);
      const snap = await resourceRef.get();
      if (!snap.exists || snap.data()?.docType !== 'resource') {
        return res.status(404).json({ error: 'resource_not_found' });
      }
      const patch: Record<string, unknown> = {
        lastInspectedAt: body.inspectedAt,
        operational: body.operational,
        lastInspectedBy: callerUid,
      };
      if (body.nextExpirationAt) {
        patch.nextExpirationAt = body.nextExpirationAt;
      }
      const auditDoc = baseRef.doc();
      const batch = db.batch();
      batch.set(resourceRef, patch, { merge: true });
      batch.set(auditDoc, {
        docType: 'inspection',
        resourceId: id,
        inspectedAt: body.inspectedAt,
        inspectedBy: callerUid,
        operational: body.operational,
        notes: body.notes ?? null,
        createdAt: new Date().toISOString(),
      });
      await batch.commit();
      await auditServerEvent(req, 'emergencyBrigade.inspectResource', 'emergencyBrigade', {
        projectId,
        resourceId: id,
        inspectionId: auditDoc.id,
        operational: body.operational,
      }, { projectId });
      return res
        .status(201)
        .json({ ok: true, inspectionId: auditDoc.id });
    } catch (err) {
      logger.error?.('emergencyBrigade.inspect.error', err);
      captureRouteError(err, 'emergencyBrigade.inspect');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
