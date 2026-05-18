// Praeventio Guard — Communication Map HTTP surface.
//
// Sprint K §216-221 — five stateless endpoints over the engine under
// `src/services/comms/communicationMap.ts`:
//
//   POST /:projectId/comms/best-channel-for-zone
//     body: { contact, zone }
//     200:  { channel: CommunicationChannel | null }
//
//   POST /:projectId/comms/detect-dead-zones
//     body: { zones, requiredChannels }
//     200:  { deadZones: ZoneCoverage[] }
//
//   POST /:projectId/comms/compute-escalation
//     body: { chain, minutesSinceTrigger }
//     200:  { decision: EscalationDecision }
//
//   POST /:projectId/comms/build-contactability-report
//     body: { tests }
//     200:  { report: ContactabilityReport }
//
//   POST /:projectId/comms/plan-channel-failover
//     body: { contact, zone, isPrimaryDown }
//     200:  { decision: ChannelFailoverDecision }
//
// Pure compute — no Firestore writes. Determinístico, sin LLM.

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
  bestChannelForZone,
  detectDeadZones,
  computeEscalation,
  buildContactabilityReport,
  planChannelFailover,
  type ContactInfo,
  type ZoneCoverage,
  type EscalationLevel,
  type ContactabilityTest,
} from '../../services/comms/communicationMap.js';

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

const CHANNELS = [
  'radio_uhf',
  'radio_vhf',
  'phone_cell',
  'phone_satellite',
  'app_push',
  'whatsapp',
  'face_to_face',
] as const;

const contactInfoSchema = z.object({
  workerUid: z.string().min(1).max(200),
  role: z.string().min(1).max(200),
  channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length),
  radioChannel: z.number().int().nonnegative().max(10_000).optional(),
  lastReachableAt: z.string().min(10).optional(),
}) as unknown as z.ZodType<ContactInfo>;

const zoneCoverageSchema = z.object({
  zoneId: z.string().min(1).max(200),
  availableChannels: z.array(z.enum(CHANNELS)).max(CHANNELS.length),
}) as unknown as z.ZodType<ZoneCoverage>;

// ────────────────────────────────────────────────────────────────────────
// 1. best-channel-for-zone
// ────────────────────────────────────────────────────────────────────────

const bestChannelSchema = z.object({
  contact: contactInfoSchema,
  zone: zoneCoverageSchema,
});

router.post(
  '/:projectId/comms/best-channel-for-zone',
  verifyAuth,
  validate(bestChannelSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof bestChannelSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const channel = bestChannelForZone(body.contact, body.zone);
      return res.json({ channel });
    } catch (err) {
      logger.error?.('comms.bestChannelForZone.error', err);
      captureRouteError(err, 'comms.bestChannelForZone');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. detect-dead-zones
// ────────────────────────────────────────────────────────────────────────

const deadZonesSchema = z.object({
  zones: z.array(zoneCoverageSchema).max(10_000),
  requiredChannels: z.array(z.enum(CHANNELS)).max(CHANNELS.length),
});

router.post(
  '/:projectId/comms/detect-dead-zones',
  verifyAuth,
  validate(deadZonesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof deadZonesSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const deadZones = detectDeadZones(body.zones, body.requiredChannels);
      return res.json({ deadZones });
    } catch (err) {
      logger.error?.('comms.detectDeadZones.error', err);
      captureRouteError(err, 'comms.detectDeadZones');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. compute-escalation
// ────────────────────────────────────────────────────────────────────────

const escalationLevelSchema = z.object({
  level: z.number().int().nonnegative().max(1000),
  uids: z.array(z.string().min(1).max(200)).max(500),
  waitMinutes: z.number().nonnegative().max(10_080),
}) as unknown as z.ZodType<EscalationLevel>;

const escalationSchema = z.object({
  chain: z.array(escalationLevelSchema).max(50),
  minutesSinceTrigger: z.number().nonnegative().max(525_600),
});

router.post(
  '/:projectId/comms/compute-escalation',
  verifyAuth,
  validate(escalationSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof escalationSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const decision = computeEscalation(body.chain, body.minutesSinceTrigger);
      return res.json({ decision });
    } catch (err) {
      logger.error?.('comms.computeEscalation.error', err);
      captureRouteError(err, 'comms.computeEscalation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. build-contactability-report
// ────────────────────────────────────────────────────────────────────────

const contactabilityTestSchema = z.object({
  workerUid: z.string().min(1).max(200),
  testedAt: z.string().min(10),
  reachable: z.boolean(),
  channelUsed: z.enum(CHANNELS).optional(),
  responseSeconds: z.number().nonnegative().max(86_400).optional(),
}) as unknown as z.ZodType<ContactabilityTest>;

const contactabilitySchema = z.object({
  tests: z.array(contactabilityTestSchema).max(50_000),
});

router.post(
  '/:projectId/comms/build-contactability-report',
  verifyAuth,
  validate(contactabilitySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof contactabilitySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = buildContactabilityReport(body.tests);
      return res.json({ report });
    } catch (err) {
      logger.error?.('comms.buildContactabilityReport.error', err);
      captureRouteError(err, 'comms.buildContactabilityReport');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. plan-channel-failover
// ────────────────────────────────────────────────────────────────────────

const failoverSchema = z.object({
  contact: contactInfoSchema,
  zone: zoneCoverageSchema,
  isPrimaryDown: z.boolean(),
});

router.post(
  '/:projectId/comms/plan-channel-failover',
  verifyAuth,
  validate(failoverSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof failoverSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const decision = planChannelFailover(body.contact, body.zone, body.isPrimaryDown);
      return res.json({ decision });
    } catch (err) {
      logger.error?.('comms.planChannelFailover.error', err);
      captureRouteError(err, 'comms.planChannelFailover');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
