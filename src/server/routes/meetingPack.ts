// Praeventio Guard — Meeting pack + briefing HTTP surface.
//
// Sprint 51 §188-190 — three stateless endpoints over the engine under
// `src/services/meetingPack/meetingPackBuilder.ts`:
//
//   POST /:projectId/meeting-pack/build-summary          { snapshot }
//   POST /:projectId/meeting-pack/build-supervisor-briefing { input }
//   POST /:projectId/meeting-pack/extract-action-items   { text }
//
// Pure compute — no Firestore writes. Determinístico, sin LLM. Quorum
// gating per meeting kind (pre_shift_briefing 80%, cphs_monthly 50%,
// etc.).

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
  buildMeetingSummary,
  buildSupervisorBriefingPack,
  extractActionItems,
  type MeetingSnapshot,
  type MeetingKind,
  type BriefingInputs,
} from '../../services/meetingPack/meetingPackBuilder.js';

const router = Router();

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return false;
    }
    throw err;
  }
  return true;
}

const MEETING_KINDS: readonly MeetingKind[] = [
  'pre_shift_briefing',
  'cphs_monthly',
  'incident_review',
  'toolbox_talk',
  'project_status',
  'lessons_learned',
];
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const FATIGUE_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
const SEVERITIES = ['high', 'critical', 'sif'] as const;

const snapshotSchema = z.object({
  meetingId: z.string().min(1).max(200),
  kind: z.enum(MEETING_KINDS as readonly [MeetingKind, ...MeetingKind[]]),
  scheduledFor: z.string().min(10),
  durationMinutes: z.number().int().nonnegative().max(10_080),
  facilitatorUid: z.string().min(1).max(200),
  attendees: z.array(z.object({
    uid: z.string().min(1).max(200),
    name: z.string().min(1).max(500),
    role: z.string().min(1).max(200),
    attended: z.boolean(),
    absenceReason: z.string().min(1).max(500).optional(),
  })).max(10_000),
  discussionPoints: z.array(z.object({
    id: z.string().min(1).max(200),
    topic: z.string().min(1).max(500),
    raisedByUid: z.string().min(1).max(200).optional(),
    summary: z.string().min(1).max(5000),
    decision: z.string().min(1).max(5000).optional(),
  })).max(500),
  actionItems: z.array(z.object({
    description: z.string().min(1).max(2000),
    assignedToUid: z.string().min(1).max(200),
    dueDate: z.string().min(10),
    priority: z.enum(PRIORITIES),
  })).max(500),
}) as unknown as z.ZodType<MeetingSnapshot>;

// ────────────────────────────────────────────────────────────────────────
// 1. build-summary
// ────────────────────────────────────────────────────────────────────────

const summarySchema = z.object({
  snapshot: snapshotSchema,
});

router.post(
  '/:projectId/meeting-pack/build-summary',
  verifyAuth,
  validate(summarySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof summarySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = buildMeetingSummary(body.snapshot);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('meetingPack.buildSummary.error', err);
      captureRouteError(err, 'meetingPack.buildSummary');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-supervisor-briefing
// ────────────────────────────────────────────────────────────────────────

const briefingSchema = z.object({
  shiftStart: z.string().min(10),
  workersAssigned: z.array(z.object({
    uid: z.string().min(1).max(200),
    name: z.string().min(1).max(500),
    role: z.string().min(1).max(200),
    activeRestrictions: z.array(z.string().min(1).max(200)).max(50).optional(),
    fatigueLevel: z.enum(FATIGUE_LEVELS).optional(),
    expiredCerts: z.array(z.string().min(1).max(200)).max(50).optional(),
  })).max(10_000),
  criticalRisksForToday: z.array(z.object({
    id: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    severity: z.enum(SEVERITIES),
  })).max(200),
  pendingActions: z.array(z.object({
    id: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    dueDate: z.string().min(10),
  })).max(500),
  weather: z.object({
    temperatureC: z.number().min(-80).max(80),
    precipitation: z.string().min(1).max(200).optional(),
    uvIndex: z.number().min(0).max(20).optional(),
  }).optional(),
  customNotes: z.array(z.string().min(1).max(2000)).max(50).optional(),
});

router.post(
  '/:projectId/meeting-pack/build-supervisor-briefing',
  verifyAuth,
  validate(briefingSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof briefingSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const input: BriefingInputs = {
        supervisorUid: callerUid,
        projectId,
        ...body,
      };
      const pack = buildSupervisorBriefingPack(input);
      return res.json({ pack });
    } catch (err) {
      logger.error?.('meetingPack.buildSupervisorBriefing.error', err);
      captureRouteError(err, 'meetingPack.buildSupervisorBriefing');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. extract-action-items
// ────────────────────────────────────────────────────────────────────────

const extractSchema = z.object({
  text: z.string().min(0).max(100_000),
});

router.post(
  '/:projectId/meeting-pack/extract-action-items',
  verifyAuth,
  validate(extractSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof extractSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const suggestions = extractActionItems(body.text);
      return res.json({ suggestions });
    } catch (err) {
      logger.error?.('meetingPack.extractActionItems.error', err);
      captureRouteError(err, 'meetingPack.extractActionItems');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
