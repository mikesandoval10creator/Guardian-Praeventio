// Praeventio Guard — F.15 Centro de Permisos de Trabajo.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/work-permits*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// Permisos digitales para tareas críticas:
//   - Trabajo en altura (DS 594 art. 53)
//   - Trabajo en caliente (DS 132)
//   - Espacios confinados (DS 132 + protocolo MINSAL)
//   - LOTO / bloqueo energético (DS 132 + DS 109)
//   - Excavaciones (DS 594)
//   - Izaje crítico (DS 132)
//
// 4 endpoints:
//   GET  /:projectId/work-permits             — list (filters status/kind)
//   POST /:projectId/work-permits             — create permit (engine valida)
//   POST /:projectId/work-permits/:permitId/sign   — sign/issue active permit
//   POST /:projectId/work-permits/:permitId/close  — close (fulfill/cancel)
//
// Codex P1 fixes preservados:
//   - Issuer identity (workerUid/approverUid/approverRole) NUNCA del body
//   - Checklist items siempre seeded como false en create — supervisor
//     atesta en /sign
//   - Permit issuance gated por canIssuePermits claim
//   - Expired permits no se pueden marcar como fulfilled/cancelled

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
  WorkPermitAdapter,
  WorkPermitDuplicateError,
} from '../../services/workPermits/workPermitFirestoreAdapter.js';
import {
  createPendingPermit,
  attestAndIssuePermit,
  cancelPermit,
  fulfillPermit,
  deriveStatus,
  WorkPermitValidationError,
  type WorkPermit,
  type WorkPermitKind,
  type WorkPermitStatus,
} from '../../services/workPermits/workPermitEngine.js';

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

// ── Constants + role gate ─────────────────────────────────────────────

const VALID_KINDS: ReadonlySet<WorkPermitKind> = new Set<WorkPermitKind>([
  'altura',
  'caliente',
  'confinado',
  'loto',
  'excavacion',
  'izaje_critico',
]);

const VALID_STATUSES: ReadonlySet<WorkPermitStatus> =
  new Set<WorkPermitStatus>([
    'draft',
    'pending_approval',
    'active',
    'expired',
    'cancelled',
    'fulfilled',
  ]);

const PERMIT_ISSUER_ROLES: ReadonlySet<string> = new Set([
  'supervisor',
  'prevencionista',
  'gerente',
  'admin',
]);

interface CallerRoleContext {
  role: string | null;
  canIssuePermits: boolean;
}

function resolveCallerRoleContext(
  user: Express.PraeventioAuthUser,
): CallerRoleContext {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const primaryRole =
    typeof user.role === 'string' && user.role.length > 0 ? user.role : null;
  if (user.admin === true) {
    return { role: primaryRole ?? 'admin', canIssuePermits: true };
  }
  if (primaryRole && PERMIT_ISSUER_ROLES.has(primaryRole)) {
    return { role: primaryRole, canIssuePermits: true };
  }
  for (const r of roles) {
    if (typeof r === 'string' && PERMIT_ISSUER_ROLES.has(r)) {
      return { role: r, canIssuePermits: true };
    }
  }
  return { role: primaryRole, canIssuePermits: false };
}

// ── GET /:projectId/work-permits ──────────────────────────────────────

router.get('/:projectId/work-permits', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new WorkPermitAdapter({
      db: admin.firestore() as any,
      tenantId: g.tenantId,
      projectId,
    });
    const statusQ =
      typeof req.query.status === 'string' ? req.query.status : null;
    const kindQ =
      typeof req.query.kind === 'string' ? req.query.kind : null;
    const kind =
      kindQ && VALID_KINDS.has(kindQ as WorkPermitKind)
        ? (kindQ as WorkPermitKind)
        : null;
    const status =
      statusQ && VALID_STATUSES.has(statusQ as WorkPermitStatus)
        ? (statusQ as WorkPermitStatus)
        : null;
    const wantsAll = statusQ === 'all';
    const now = new Date();

    let permits: WorkPermit[];
    if (kind && status) {
      if (status === 'active') {
        permits = (
          await adapter.listByKindAndStatus(kind, 'active')
        ).filter((p) => deriveStatus(p, now) === 'active');
      } else if (status === 'expired') {
        permits = (
          await adapter.listByKindAndStatus(kind, 'active')
        ).filter((p) => deriveStatus(p, now) === 'expired');
      } else {
        permits = await adapter.listByKindAndStatus(kind, status);
      }
    } else if (kind && wantsAll) {
      permits = await adapter.listByKind(kind);
    } else if (kind) {
      permits = (
        await adapter.listByKindAndStatus(kind, 'active')
      ).filter((p) => deriveStatus(p, now) === 'active');
    } else if (status === 'active') {
      permits = await adapter.listActive(now);
    } else if (status === 'expired') {
      const candidates = await adapter.listByStatus('active');
      permits = candidates.filter(
        (p) => deriveStatus(p, now) === 'expired',
      );
    } else if (status) {
      permits = await adapter.listByStatus(status);
    } else if (wantsAll) {
      permits = await adapter.listActive(now);
    } else {
      permits = await adapter.listActive(now);
    }

    return res.json({ permits });
  } catch (err) {
    logger.error?.('workPermits.list.error', err);
    captureRouteError(err, 'workPermits.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /:projectId/work-permits ─────────────────────────────────────

const checklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  checked: z.boolean(),
  verifiedAt: z.string().optional(),
});

const workPermitCreateSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'altura',
    'caliente',
    'confinado',
    'loto',
    'excavacion',
    'izaje_critico',
  ]),
  workerUid: z.string().min(1).optional(),
  zoneId: z.string().optional(),
  taskDescription: z.string().min(3).max(4000),
  durationHours: z.number().positive().max(24),
  preconditions: z
    .object({
      workerHasTraining: z.boolean().optional(),
      workerHasEpp: z.boolean().optional(),
      workerMedicallyFit: z.boolean().optional(),
      checklist: z
        .object({
          items: z.array(checklistItemSchema),
        })
        .optional(),
    })
    .optional(),
});

router.post(
  '/:projectId/work-permits',
  verifyAuth,
  validate(workPermitCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof workPermitCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const ctx = resolveCallerRoleContext(req.user!);
    if (!ctx.canIssuePermits) {
      return res.status(403).json({
        error: 'forbidden',
        reason: 'caller_lacks_permit_issuer_role',
      });
    }
    const workerUid =
      typeof body.workerUid === 'string' && body.workerUid.length > 0
        ? body.workerUid
        : callerUid;
    try {
      const permit = createPendingPermit({
        id: body.id,
        kind: body.kind,
        workerUid,
        approverUid: callerUid,
        approverRole: ctx.role ?? 'supervisor',
        zoneId: body.zoneId,
        taskDescription: body.taskDescription,
        preconditions: {
          workerHasTraining: false,
          workerHasEpp: false,
          workerMedicallyFit: false,
          checklist: { items: [] },
        },
        durationHours: body.durationHours,
      });
      const adapter = new WorkPermitAdapter({
        db: admin.firestore() as any,
        tenantId: g.tenantId,
        projectId,
      });
      await adapter.create(permit);
      return res.status(201).json({ permit });
    } catch (err) {
      if (err instanceof WorkPermitDuplicateError) {
        return res
          .status(409)
          .json({ error: 'permit_id_duplicate', permitId: err.permitId });
      }
      if (err instanceof WorkPermitValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('workPermits.create.error', err);
      captureRouteError(err, 'workPermits.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/work-permits/:permitId/sign ──────────────────────

const signPermitSchema = z
  .object({
    workerHasTraining: z.boolean().optional(),
    workerHasEpp: z.boolean().optional(),
    workerMedicallyFit: z.boolean().optional(),
    checkedLabels: z.array(z.string()).optional(),
  })
  .optional();

router.post(
  '/:projectId/work-permits/:permitId/sign',
  verifyAuth,
  validate(signPermitSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, permitId } = req.params;
    const body = (req.body ?? {}) as z.infer<typeof signPermitSchema> &
      object;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const ctx = resolveCallerRoleContext(req.user!);
    if (!ctx.canIssuePermits) {
      return res.status(403).json({
        error: 'forbidden',
        reason: 'caller_lacks_permit_issuer_role',
      });
    }
    try {
      const adapter = new WorkPermitAdapter({
        db: admin.firestore() as any,
        tenantId: g.tenantId,
        projectId,
      });
      const permit = await adapter.getById(permitId);
      if (!permit) return res.status(404).json({ error: 'not_found' });

      const checkedLabels =
        body?.checkedLabels ??
        permit.preconditions.checklist.items
          .filter((i) => i.checked)
          .map((i) => i.label);
      const attestation = {
        workerHasTraining:
          body?.workerHasTraining ??
          permit.preconditions.workerHasTraining,
        workerHasEpp:
          body?.workerHasEpp ?? permit.preconditions.workerHasEpp,
        workerMedicallyFit:
          body?.workerMedicallyFit ??
          permit.preconditions.workerMedicallyFit,
        checkedLabels,
      };

      const next: WorkPermit =
        permit.status === 'active'
          ? { ...permit, approvedAt: new Date().toISOString() }
          : attestAndIssuePermit(permit, attestation);
      await adapter.save(next);
      return res.json({ permit: next });
    } catch (err) {
      if (err instanceof WorkPermitValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('workPermits.sign.error', err);
      captureRouteError(err, 'workPermits.sign');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/work-permits/:permitId/close ─────────────────────

const closePermitSchema = z.object({
  reason: z.string().min(10).max(2000),
  outcome: z.enum(['fulfill', 'cancel']).optional(),
});

router.post(
  '/:projectId/work-permits/:permitId/close',
  verifyAuth,
  validate(closePermitSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, permitId } = req.params;
    const body = req.body as z.infer<typeof closePermitSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new WorkPermitAdapter({
        db: admin.firestore() as any,
        tenantId: g.tenantId,
        projectId,
      });
      const permit = await adapter.getById(permitId);
      if (!permit) return res.status(404).json({ error: 'not_found' });

      const now = new Date();
      const derived = deriveStatus(permit, now);
      if (derived === 'expired') {
        return res.status(422).json({
          error: 'permit_already_expired',
          hint: 'extend the validity (re-sign) or omit this close call; expired permits cannot be marked as fulfilled or cancelled',
        });
      }
      if (derived === 'cancelled' || derived === 'fulfilled') {
        return res.status(422).json({
          error: 'permit_already_terminal',
          status: derived,
        });
      }

      const outcome = body.outcome ?? 'fulfill';
      const next =
        outcome === 'cancel'
          ? cancelPermit(permit, body.reason, now)
          : fulfillPermit(permit, now);
      await adapter.save(next);
      return res.json({ permit: next });
    } catch (err) {
      if (err instanceof WorkPermitValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('workPermits.close.error', err);
      captureRouteError(err, 'workPermits.close');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
