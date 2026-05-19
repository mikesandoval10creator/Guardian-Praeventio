// Praeventio Guard — Agenda + Focus Blocks + Reminders + Digests HTTP surface.
//
// Sprint K §201-207 — five stateless endpoints over the engine under
// `src/services/agenda/agendaScheduler.ts`:
//
//   POST /:projectId/agenda/schedule-reminders     { item }
//   POST /:projectId/agenda/select-channel         { prefs, urgency }
//   POST /:projectId/agenda/should-deliver         { reminder, prefs, nowIso }
//   POST /:projectId/agenda/in-focus-block         { items, nowIso }
//   POST /:projectId/agenda/build-daily-digest     { workerUid, forDate, inputs }
//
// Pure compute — no Firestore writes.

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
  scheduleReminders,
  selectChannelForUrgency,
  shouldDeliverNow,
  isInFocusBlock,
  buildDailyDigest,
  type AgendaItem,
  type UserPreferences,
  type ScheduledReminder,
  type ReminderUrgency,
  type DeliveryChannel,
  type DigestInputs,
} from '../../services/agenda/agendaScheduler.js';

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

const URGENCIES: readonly ReminderUrgency[] = ['low', 'medium', 'high', 'urgent'];
const CHANNELS: readonly DeliveryChannel[] = ['push', 'email', 'whatsapp', 'in_app'];

const itemSchema = z.object({
  id: z.string().min(1).max(200),
  workerUid: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  startAt: z.string().min(10),
  endAt: z.string().min(10),
  focusBlock: z.boolean(),
  urgency: z.enum(URGENCIES as readonly [ReminderUrgency, ...ReminderUrgency[]]),
  reminders: z.array(z.object({
    atOffsetMinutes: z.number().int().nonnegative().max(525_600),
    channel: z.enum(CHANNELS as readonly [DeliveryChannel, ...DeliveryChannel[]]),
  })).max(50),
}) as unknown as z.ZodType<AgendaItem>;

const prefsSchema = z.object({
  workerUid: z.string().min(1).max(200),
  workDayStartHour: z.number().int().min(0).max(23),
  workDayEndHour: z.number().int().min(0).max(23),
  channelByUrgency: z.object({
    low: z.enum(CHANNELS as readonly [DeliveryChannel, ...DeliveryChannel[]]),
    medium: z.enum(CHANNELS as readonly [DeliveryChannel, ...DeliveryChannel[]]),
    high: z.enum(CHANNELS as readonly [DeliveryChannel, ...DeliveryChannel[]]),
    urgent: z.enum(CHANNELS as readonly [DeliveryChannel, ...DeliveryChannel[]]),
  }),
  focusBlocksPerDay: z.number().int().min(0).max(24),
  doNotDisturbAfterHour: z.number().int().min(0).max(23).optional(),
}) as unknown as z.ZodType<UserPreferences>;

const reminderSchema = z.object({
  itemId: z.string().min(1).max(200),
  triggersAt: z.string().min(10),
  channel: z.enum(CHANNELS as readonly [DeliveryChannel, ...DeliveryChannel[]]),
  urgency: z.enum(URGENCIES as readonly [ReminderUrgency, ...ReminderUrgency[]]),
}) as unknown as z.ZodType<ScheduledReminder>;

// ────────────────────────────────────────────────────────────────────────
// 1. schedule-reminders
// ────────────────────────────────────────────────────────────────────────

const scheduleSchema = z.object({ item: itemSchema });

router.post(
  '/:projectId/agenda/schedule-reminders',
  verifyAuth,
  validate(scheduleSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof scheduleSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const reminders = scheduleReminders(body.item);
      return res.json({ reminders });
    } catch (err) {
      logger.error?.('agenda.scheduleReminders.error', err);
      captureRouteError(err, 'agenda.scheduleReminders');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. select-channel
// ────────────────────────────────────────────────────────────────────────

const selectChannelSchema = z.object({
  prefs: prefsSchema,
  urgency: z.enum(URGENCIES as readonly [ReminderUrgency, ...ReminderUrgency[]]),
});

router.post(
  '/:projectId/agenda/select-channel',
  verifyAuth,
  validate(selectChannelSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof selectChannelSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const channel = selectChannelForUrgency(body.prefs, body.urgency);
      return res.json({ channel });
    } catch (err) {
      logger.error?.('agenda.selectChannel.error', err);
      captureRouteError(err, 'agenda.selectChannel');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. should-deliver
// ────────────────────────────────────────────────────────────────────────

const deliverSchema = z.object({
  reminder: reminderSchema,
  prefs: prefsSchema,
  nowIso: z.string().min(10),
});

router.post(
  '/:projectId/agenda/should-deliver',
  verifyAuth,
  validate(deliverSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof deliverSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const decision = shouldDeliverNow(body.reminder, body.prefs, body.nowIso);
      return res.json({ decision });
    } catch (err) {
      logger.error?.('agenda.shouldDeliver.error', err);
      captureRouteError(err, 'agenda.shouldDeliver');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. in-focus-block
// ────────────────────────────────────────────────────────────────────────

const focusSchema = z.object({
  items: z.array(itemSchema).max(5000),
  nowIso: z.string().min(10),
});

router.post(
  '/:projectId/agenda/in-focus-block',
  verifyAuth,
  validate(focusSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof focusSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const focus = isInFocusBlock(body.items, body.nowIso);
      return res.json({ focus });
    } catch (err) {
      logger.error?.('agenda.inFocusBlock.error', err);
      captureRouteError(err, 'agenda.inFocusBlock');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. build-daily-digest
// ────────────────────────────────────────────────────────────────────────

const digestInputsSchema = z.object({
  upcomingItems: z.array(itemSchema).max(500),
  overdueActions: z.number().int().nonnegative().max(1_000_000),
  pendingApprovals: z.number().int().nonnegative().max(1_000_000),
  freshIncidents: z.number().int().nonnegative().max(1_000_000),
}) as unknown as z.ZodType<DigestInputs>;

const digestSchema = z.object({
  workerUid: z.string().min(1).max(200),
  forDate: z.string().min(10),
  inputs: digestInputsSchema,
});

router.post(
  '/:projectId/agenda/build-daily-digest',
  verifyAuth,
  validate(digestSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof digestSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const digest = buildDailyDigest(body.workerUid, body.forDate, body.inputs);
      return res.json({ digest });
    } catch (err) {
      logger.error?.('agenda.buildDailyDigest.error', err);
      captureRouteError(err, 'agenda.buildDailyDigest');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
