// Praeventio Guard — Bloque 4.3: Incident → Investigation → Lesson → Training PDCA HTTP surface.
//
// Endpoints (all mounted at `/api/sprint-k`, see server.ts):
//   POST /:projectId/incident-flow/report
//   POST /:projectId/incident-flow/:incidentId/open-investigation
//   POST /:projectId/incident-flow/:incidentId/conclude-investigation
//   POST /:projectId/incident-flow/:incidentId/publish-lesson
//   POST /:projectId/incident-flow/:incidentId/assign-microtraining
//   POST /:projectId/incident-flow/training/:assignmentId/complete
//   GET  /:projectId/incident-flow/:incidentId/status
//
// Architecture: the route layer is the orchestration boundary between the
// HTTP shape and the pure flow orchestrator at
// `services/zettelkasten/flows/incidentLessonTrainingFlow.ts`. The route:
//   1. Validates the body via zod.
//   2. Guards via `assertProjectMember` (same pattern as
//      `incidentBundle.ts`, `lessonsLearned.ts`).
//   3. Resolves `tenantId` from the project doc.
//   4. Computes the previous-step node id (`nodeIdFor` is deterministic) so
//      the orchestrator can wire the edge without needing to re-query.
//   5. Calls the flow step.
//   6. Persists an audit_log row.
//
// Founder directive: nunca push a APIs externas. Everything writes to our
// own Firestore tree. No SUSESO / MINSAL / OSHA outbound calls anywhere.

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
import { nodeIdFor } from '../../services/zettelkasten/persistence/writeNode.js';
import { makeServerWriteNodes } from '../services/serverZkNodeWriter.js';
import {
  createIncidentReportedNode,
  createInvestigationOpenedNode,
  createRootCauseNode,
  createLessonPublishedNode,
  createMicrotrainingAssignedNode,
  createMicrotrainingCompletedNode,
  createInvestigationClosedNode,
  onIncidentReported,
  onInvestigationOpened,
  onInvestigationConcluded,
  onLessonPublished,
  onMicrotrainingAssigned,
  onMicrotrainingCompleted,
  onInvestigationClosed,
  computePdcaStatus,
  type IncidentReportInput,
  type InvestigationOpeningInput,
  type InvestigationConclusionInput,
  type LessonPublicationInput,
  type MicrotrainingAssignmentInput,
  type MicrotrainingCompletionInput,
  type InvestigationClosureInput,
  type ChainNodeRef,
  type IncidentLessonTrainingNodeType,
  type FlowDeps,
} from '../../services/zettelkasten/flows/incidentLessonTrainingFlow.js';

const router = Router();

/**
 * Codex P1 (#650): the incident chain flow defaults to the BROWSER `writeNodes`
 * (relative fetch + IndexedDB), which can't persist in the Express runtime.
 * Inject the Admin-SDK server writer, stamped with the verified actor, into
 * every flow step so reports/investigations/lessons/trainings actually
 * materialize their ZK nodes server-side.
 */
function flowDepsFor(req: import('express').Request): FlowDeps {
  return {
    writeNodes: makeServerWriteNodes({
      createdBy: req.user!.uid,
      createdByEmail: req.user?.email ?? null,
    }),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Guard helpers (mirror lessonsLearned.ts / incidentBundle.ts shape)
// ────────────────────────────────────────────────────────────────────────

async function resolveTenantId(
  _callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
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
  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// B4 (Fase 5): emit the CANONICAL audit_logs shape so incident-flow events are
// queryable by the standard audit tooling. The prior hand-rolled row used
// `kind`/`actorUid`/`createdAt`, which the audit readers (which filter on
// `action`/`userId`/`timestamp` + `module`) silently skipped. We keep the
// top-level `audit_logs` collection (append-only rules) and stamp the same
// field names auditServerEvent writes. (userEmail/ip/ua are not available at
// this helper's call sites — they default to null; the queryable keys
// `action`/`module`/`userId`/`timestamp`/`projectId` are what matters.)
async function writeAudit(
  tenantId: string,
  projectId: string,
  action: string,
  actorUid: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await admin
      .firestore()
      .collection('audit_logs')
      .add({
        action,
        module: 'incidentFlow',
        userId: actorUid,
        userEmail: null,
        projectId,
        details: { ...details, tenantId },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: null,
        userAgent: null,
      });
  } catch (err) {
    // Audit failure MUST NOT break the user flow.
    logger.warn?.('incidentFlow.audit_write_failed', err);
  }
}

const severityEnum = z.enum(['info', 'low', 'medium', 'high', 'critical']);

// ────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/incident-flow/report
// ────────────────────────────────────────────────────────────────────────

const reportSchema = z.object({
  incidentId: z.string().min(1).max(128),
  occurredAtIso: z.string().datetime(),
  description: z.string().min(10).max(4000),
  severity: severityEnum,
  involvedWorkerUids: z.array(z.string().min(1).max(128)).max(100).optional(),
  location: z.string().max(256).optional(),
  photoStorageUrl: z.string().url().max(2048).optional(),
});

router.post(
  '/:projectId/incident-flow/report',
  verifyAuth,
  validate(reportSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof reportSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;

    try {
      const input: IncidentReportInput = {
        incidentId: body.incidentId,
        projectId,
        tenantId: g.tenantId,
        reportedByUid: callerUid,
        involvedWorkerUids: body.involvedWorkerUids ?? [],
        occurredAtIso: body.occurredAtIso,
        description: body.description,
        severity: body.severity,
        location: body.location,
        photoStorageUrl: body.photoStorageUrl,
      };
      const result = await onIncidentReported(input, flowDepsFor(req));
      if (!result.ok) {
        return res.status(500).json({ error: result.error ?? 'flow_failed' });
      }
      await writeAudit(g.tenantId, projectId, 'incident_flow.report', callerUid, {
        incidentId: body.incidentId,
        nodeIds: result.nodeIds,
      });
      return res.status(201).json({
        ok: true,
        incidentId: body.incidentId,
        nodeIds: result.nodeIds,
        edgeIds: result.edgeIds,
      });
    } catch (err) {
      logger.error?.('incidentFlow.report.error', err);
      captureRouteError(err, 'incidentFlow.report');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/incident-flow/:incidentId/open-investigation
// ────────────────────────────────────────────────────────────────────────

const openInvestigationSchema = z.object({
  investigatorUid: z.string().min(1).max(128),
  openedAtIso: z.string().datetime(),
  scopeNotes: z.string().min(10).max(4000),
  /** Original report — required to compute the previous-step node id. */
  report: reportSchema,
});

router.post(
  '/:projectId/incident-flow/:incidentId/open-investigation',
  verifyAuth,
  validate(openInvestigationSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, incidentId } = req.params;
    const body = req.body as z.infer<typeof openInvestigationSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;

    try {
      // Re-derive the report node id from the same input the caller posted,
      // so the new edge attaches without a roundtrip read.
      const reportInput: IncidentReportInput = {
        incidentId,
        projectId,
        tenantId: g.tenantId,
        reportedByUid: callerUid,
        involvedWorkerUids: body.report.involvedWorkerUids ?? [],
        occurredAtIso: body.report.occurredAtIso,
        description: body.report.description,
        severity: body.report.severity,
        location: body.report.location,
        photoStorageUrl: body.report.photoStorageUrl,
      };
      const reportNodeId = await nodeIdFor(
        createIncidentReportedNode(reportInput),
        projectId,
      );

      const openingInput: InvestigationOpeningInput = {
        incidentId,
        projectId,
        tenantId: g.tenantId,
        investigatorUid: body.investigatorUid,
        openedAtIso: body.openedAtIso,
        scopeNotes: body.scopeNotes,
      };
      const result = await onInvestigationOpened(
        openingInput,
        reportNodeId,
        flowDepsFor(req),
      );
      if (!result.ok) {
        return res.status(500).json({ error: result.error ?? 'flow_failed' });
      }
      await writeAudit(
        g.tenantId,
        projectId,
        'incident_flow.open_investigation',
        callerUid,
        { incidentId, investigatorUid: body.investigatorUid },
      );
      return res.status(201).json({
        ok: true,
        nodeIds: result.nodeIds,
        edgeIds: result.edgeIds,
      });
    } catch (err) {
      logger.error?.('incidentFlow.openInvestigation.error', err);
      captureRouteError(err, 'incidentFlow.openInvestigation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/incident-flow/:incidentId/conclude-investigation
// ────────────────────────────────────────────────────────────────────────

const concludeInvestigationSchema = z.object({
  concludedAtIso: z.string().datetime(),
  rootCauseSummary: z.string().min(20).max(4000),
  contributingFactor: z.string().max(200).optional(),
  preventiveActions: z.array(z.string().min(1).max(500)).min(1).max(20),
  /** Original opening — needed to derive its node id. */
  opening: z.object({
    investigatorUid: z.string().min(1).max(128),
    openedAtIso: z.string().datetime(),
    scopeNotes: z.string().min(10).max(4000),
  }),
});

router.post(
  '/:projectId/incident-flow/:incidentId/conclude-investigation',
  verifyAuth,
  validate(concludeInvestigationSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, incidentId } = req.params;
    const body = req.body as z.infer<typeof concludeInvestigationSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;

    try {
      const openingInput: InvestigationOpeningInput = {
        incidentId,
        projectId,
        tenantId: g.tenantId,
        investigatorUid: body.opening.investigatorUid,
        openedAtIso: body.opening.openedAtIso,
        scopeNotes: body.opening.scopeNotes,
      };
      const openingNodeId = await nodeIdFor(
        createInvestigationOpenedNode(openingInput),
        projectId,
      );

      const conclusionInput: InvestigationConclusionInput = {
        incidentId,
        projectId,
        tenantId: g.tenantId,
        closedByUid: callerUid,
        concludedAtIso: body.concludedAtIso,
        rootCauseSummary: body.rootCauseSummary,
        contributingFactor: body.contributingFactor,
        preventiveActions: body.preventiveActions,
      };
      const result = await onInvestigationConcluded(
        conclusionInput,
        openingNodeId,
        flowDepsFor(req),
      );
      if (!result.ok) {
        return res.status(500).json({ error: result.error ?? 'flow_failed' });
      }
      await writeAudit(
        g.tenantId,
        projectId,
        'incident_flow.conclude_investigation',
        callerUid,
        {
          incidentId,
          preventiveActionCount: body.preventiveActions.length,
          contributingFactor: body.contributingFactor,
        },
      );
      return res.status(201).json({
        ok: true,
        nodeIds: result.nodeIds,
        edgeIds: result.edgeIds,
      });
    } catch (err) {
      logger.error?.('incidentFlow.concludeInvestigation.error', err);
      captureRouteError(err, 'incidentFlow.concludeInvestigation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/incident-flow/:incidentId/publish-lesson
// ────────────────────────────────────────────────────────────────────────

const publishLessonSchema = z.object({
  lessonId: z.string().min(1).max(128),
  publishedAtIso: z.string().datetime(),
  summary: z.string().min(10).max(2000),
  audienceUids: z.array(z.string().min(1).max(128)).min(1).max(500),
  tags: z.array(z.string().min(1).max(50)).max(50),
  riskCategories: z.array(z.string().min(1).max(50)).max(50),
  /** Conclusion input to derive its node id. */
  conclusion: z.object({
    concludedAtIso: z.string().datetime(),
    rootCauseSummary: z.string().min(20).max(4000),
    contributingFactor: z.string().max(200).optional(),
    preventiveActions: z.array(z.string().min(1).max(500)).min(1).max(20),
    closedByUid: z.string().min(1).max(128),
  }),
});

router.post(
  '/:projectId/incident-flow/:incidentId/publish-lesson',
  verifyAuth,
  validate(publishLessonSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, incidentId } = req.params;
    const body = req.body as z.infer<typeof publishLessonSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;

    try {
      const conclusionInput: InvestigationConclusionInput = {
        incidentId,
        projectId,
        tenantId: g.tenantId,
        closedByUid: body.conclusion.closedByUid,
        concludedAtIso: body.conclusion.concludedAtIso,
        rootCauseSummary: body.conclusion.rootCauseSummary,
        contributingFactor: body.conclusion.contributingFactor,
        preventiveActions: body.conclusion.preventiveActions,
      };
      const rootCauseNodeId = await nodeIdFor(
        createRootCauseNode(conclusionInput),
        projectId,
      );

      const lessonInput: LessonPublicationInput = {
        incidentId,
        projectId,
        tenantId: g.tenantId,
        lessonId: body.lessonId,
        publishedByUid: callerUid,
        publishedAtIso: body.publishedAtIso,
        summary: body.summary,
        audienceUids: body.audienceUids,
        tags: body.tags,
        riskCategories: body.riskCategories,
      };
      const result = await onLessonPublished(
        lessonInput,
        rootCauseNodeId,
        flowDepsFor(req),
      );
      if (!result.ok) {
        return res.status(500).json({ error: result.error ?? 'flow_failed' });
      }
      await writeAudit(
        g.tenantId,
        projectId,
        'incident_flow.publish_lesson',
        callerUid,
        {
          incidentId,
          lessonId: body.lessonId,
          audienceCount: body.audienceUids.length,
        },
      );
      return res.status(201).json({
        ok: true,
        nodeIds: result.nodeIds,
        edgeIds: result.edgeIds,
      });
    } catch (err) {
      logger.error?.('incidentFlow.publishLesson.error', err);
      captureRouteError(err, 'incidentFlow.publishLesson');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. POST /:projectId/incident-flow/:incidentId/assign-microtraining
// ────────────────────────────────────────────────────────────────────────

const assignMicrotrainingSchema = z.object({
  moduleId: z.string().min(1).max(128),
  workerUids: z.array(z.string().min(1).max(128)).min(1).max(500),
  assignedAtIso: z.string().datetime(),
  /** Lesson input so we can derive its node id. */
  lesson: z.object({
    lessonId: z.string().min(1).max(128),
    publishedAtIso: z.string().datetime(),
    summary: z.string().min(10).max(2000),
    audienceUids: z.array(z.string().min(1).max(128)).min(1).max(500),
    tags: z.array(z.string().min(1).max(50)).max(50),
    riskCategories: z.array(z.string().min(1).max(50)).max(50),
    publishedByUid: z.string().min(1).max(128),
  }),
});

router.post(
  '/:projectId/incident-flow/:incidentId/assign-microtraining',
  verifyAuth,
  validate(assignMicrotrainingSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, incidentId } = req.params;
    const body = req.body as z.infer<typeof assignMicrotrainingSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;

    try {
      const lessonInput: LessonPublicationInput = {
        incidentId,
        projectId,
        tenantId: g.tenantId,
        lessonId: body.lesson.lessonId,
        publishedByUid: body.lesson.publishedByUid,
        publishedAtIso: body.lesson.publishedAtIso,
        summary: body.lesson.summary,
        audienceUids: body.lesson.audienceUids,
        tags: body.lesson.tags,
        riskCategories: body.lesson.riskCategories,
      };
      const lessonNodeId = await nodeIdFor(
        createLessonPublishedNode(lessonInput),
        projectId,
      );

      const allNodeIds: string[] = [];
      const allEdgeIds: string[] = [];
      const assignments: Array<{
        workerUid: string;
        assignmentId: string;
        nodeIds: string[];
      }> = [];

      for (const workerUid of body.workerUids) {
        const assignmentId = `mt-assign-${incidentId}-${workerUid}`;
        const assignmentInput: MicrotrainingAssignmentInput = {
          incidentId,
          projectId,
          tenantId: g.tenantId,
          assignmentId,
          moduleId: body.moduleId,
          workerUid,
          assignedByUid: callerUid,
          assignedAtIso: body.assignedAtIso,
          derivedFromLessonId: body.lesson.lessonId,
        };
        const result = await onMicrotrainingAssigned(
          assignmentInput,
          lessonNodeId,
          flowDepsFor(req),
        );
        if (!result.ok) {
          // One worker failed — log + skip; do not abort the whole batch.
          logger.warn?.('incidentFlow.assignMicrotraining.worker_failed', {
            workerUid,
            error: result.error,
          });
          continue;
        }
        allNodeIds.push(...result.nodeIds);
        allEdgeIds.push(...result.edgeIds);
        assignments.push({ workerUid, assignmentId, nodeIds: result.nodeIds });
      }
      await writeAudit(
        g.tenantId,
        projectId,
        'incident_flow.assign_microtraining',
        callerUid,
        {
          incidentId,
          moduleId: body.moduleId,
          assignmentCount: assignments.length,
        },
      );
      return res.status(201).json({
        ok: true,
        assignments,
        nodeIds: allNodeIds,
        edgeIds: allEdgeIds,
      });
    } catch (err) {
      logger.error?.('incidentFlow.assignMicrotraining.error', err);
      captureRouteError(err, 'incidentFlow.assignMicrotraining');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 6. POST /:projectId/incident-flow/training/:assignmentId/complete
// ────────────────────────────────────────────────────────────────────────

const completeMicrotrainingSchema = z.object({
  incidentId: z.string().min(1).max(128),
  moduleId: z.string().min(1).max(128),
  workerUid: z.string().min(1).max(128),
  completedAtIso: z.string().datetime(),
  score: z.number().min(0).max(100),
  passed: z.boolean(),
  certified: z.boolean(),
  /** Assignment input so we can derive its node id. */
  assignment: z.object({
    assignedAtIso: z.string().datetime(),
    assignedByUid: z.string().min(1).max(128),
    derivedFromLessonId: z.string().min(1).max(128),
  }),
});

router.post(
  '/:projectId/incident-flow/training/:assignmentId/complete',
  verifyAuth,
  validate(completeMicrotrainingSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, assignmentId } = req.params;
    const body = req.body as z.infer<typeof completeMicrotrainingSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;

    try {
      // Reconstruct the assignment input to derive its node id.
      const assignmentInput: MicrotrainingAssignmentInput = {
        incidentId: body.incidentId,
        projectId,
        tenantId: g.tenantId,
        assignmentId,
        moduleId: body.moduleId,
        workerUid: body.workerUid,
        assignedByUid: body.assignment.assignedByUid,
        assignedAtIso: body.assignment.assignedAtIso,
        derivedFromLessonId: body.assignment.derivedFromLessonId,
      };
      const assignmentNodeId = await nodeIdFor(
        createMicrotrainingAssignedNode(assignmentInput),
        projectId,
      );

      const completionInput: MicrotrainingCompletionInput = {
        incidentId: body.incidentId,
        projectId,
        tenantId: g.tenantId,
        assignmentId,
        moduleId: body.moduleId,
        workerUid: body.workerUid,
        completedAtIso: body.completedAtIso,
        score: body.score,
        passed: body.passed,
        certified: body.certified,
      };
      const result = await onMicrotrainingCompleted(
        completionInput,
        assignmentNodeId,
        flowDepsFor(req),
      );
      if (!result.ok) {
        return res.status(500).json({ error: result.error ?? 'flow_failed' });
      }
      await writeAudit(
        g.tenantId,
        projectId,
        'incident_flow.training_completed',
        callerUid,
        {
          incidentId: body.incidentId,
          assignmentId,
          score: body.score,
          passed: body.passed,
          certified: body.certified,
        },
      );
      return res.status(201).json({
        ok: true,
        nodeIds: result.nodeIds,
        edgeIds: result.edgeIds,
      });
    } catch (err) {
      logger.error?.('incidentFlow.completeMicrotraining.error', err);
      captureRouteError(err, 'incidentFlow.completeMicrotraining');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 7. GET /:projectId/incident-flow/:incidentId/status
// ────────────────────────────────────────────────────────────────────────

/**
 * Reads the chain nodes for a single incident from
 * `tenants/{tenantId}/zettelkasten_nodes` filtered by
 * `metadata.incidentId == incidentId AND type IN [chain types]`. Returns
 * the PDCA reducer output (phase, closure %, counts) so the client UI can
 * paint the overview without re-implementing the reducer.
 *
 * Safe-fail: if the read fails, we return phase='idle' and log the error.
 * The caller already knows the incident exists (passed the path param).
 */
const CHAIN_TYPES: ReadonlyArray<IncidentLessonTrainingNodeType> = [
  'incident-reported',
  'investigation-opened',
  'root-cause-identified',
  'lesson-published',
  'microtraining-assigned',
  'microtraining-completed',
  'incident-investigation-closed',
];

router.get(
  '/:projectId/incident-flow/:incidentId/status',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, incidentId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;

    try {
      const db = admin.firestore();
      const snap = await db
        .collection(`tenants/${g.tenantId}/zettelkasten_nodes`)
        .where('metadata.incidentId', '==', incidentId)
        .where('type', 'in', CHAIN_TYPES as unknown as string[])
        .limit(1000)
        .get()
        .catch((err) => {
          logger.warn?.('incidentFlow.status.query_failed', err);
          return null;
        });

      const refs: ChainNodeRef[] = [];
      if (snap) {
        for (const doc of snap.docs) {
          const data = doc.data() ?? {};
          const type = String(data.type ?? '') as IncidentLessonTrainingNodeType;
          if (!CHAIN_TYPES.includes(type)) continue;
          const metadata = (data.metadata ?? {}) as Record<string, unknown>;
          const workerUid =
            typeof metadata.workerUid === 'string'
              ? metadata.workerUid
              : undefined;
          const createdAt =
            typeof data.createdAt === 'string'
              ? data.createdAt
              : data.createdAt?.toDate?.()?.toISOString?.() ?? undefined;
          refs.push({ nodeId: doc.id, type, workerUid, createdAt });
        }
      }

      const status = computePdcaStatus(incidentId, refs);
      return res.json({ status, nodeCount: refs.length });
    } catch (err) {
      logger.error?.('incidentFlow.status.error', err);
      captureRouteError(err, 'incidentFlow.status');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
