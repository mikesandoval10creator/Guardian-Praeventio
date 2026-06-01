// Praeventio Guard — Plan Bloque 3.14: Legal Obligations Calendar wire-up.
//
// Wires the pure-compute engine at
// `src/services/legalCalendar/legalObligationsCalendar.ts` to authenticated,
// project-scoped HTTP endpoints. Mirrors the readReceipts / loneWorker /
// stoppage pattern: thin JSON marshalling around engine functions,
// project-membership-gated, idempotency-aware on the mutating calls.
//
// IMPORTANTE — directiva proyecto (no negociable):
//   • Praeventio NUNCA hace push automático a APIs estatales
//     (SUSESO / SII / MINSAL / OSHA / Mutualidad).
//   • Este calendario MUESTRA obligaciones legales próximas a vencer y emite
//     recordatorios internos (FCM via cron) al responsable del proyecto.
//   • La acción real (firmar DIAT, entregar el documento al organismo,
//     subir el examen ocupacional al portal mutual) la ejecuta la empresa,
//     manualmente, con su firma.
//   • Copia visible: "La empresa debe firmar y entregar — Praeventio NO
//     envía automáticamente."
//
// Note de nombrado: este archivo es `legalObligations.ts` para NO chocar con
// el viejo `src/services/calendar/legalObligations.ts` (otro engine de un
// dominio distinto). El servicio canónico de este wire es
// `legalCalendar/legalObligationsCalendar.ts` (Sprint 39 Fase J.2).
//
// Endpoints (mount: /api/sprint-k):
//   GET  /:projectId/legal-calendar/upcoming?days=30   → due in window
//   GET  /:projectId/legal-calendar/overdue            → already past due
//   POST /:projectId/legal-calendar/acknowledge        → mark done & roll
//   POST /:projectId/legal-calendar/snooze             → push next-due
//   GET  /:projectId/legal-calendar/history            → reminders history
//
// Storage model: obligations live in the `legal_obligations` Firestore
// collection (project-scoped via `projectId` field). The cron
// `runLegalCalendarReminders.ts` writes to
// `legal_obligations/{id}/reminders_sent/{key}` for idempotency.
// History is read from that subcollection.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  advanceObligation,
  computeCalendar,
  summarizeCalendar,
  type CalendarEntry,
  type CalendarSummary,
  type LegalObligation,
  type ObligationKind,
  type RecurrencePattern,
} from '../../services/legalCalendar/legalObligationsCalendar.js';

const router = Router();

const COLLECTION_OBLIGATIONS = 'legal_obligations';
const SUBCOLLECTION_REMINDERS = 'reminders_sent';

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

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

/**
 * IDOR guard. `legal_obligations` docs are keyed by their own id — the path is
 * NOT project-scoped (`loadProjectObligations` filters by the `projectId`
 * field). Without this check a member of project A could `.set()` an obligation
 * whose id belongs to project B and reassign / corrupt B's compliance calendar
 * (Codex P1 on #650, found once the router was mounted). Before any write,
 * confirm the existing doc (if any) belongs to THIS project. A non-existent id
 * is allowed — the write creates it scoped to this project via the `projectId`
 * field. Returns false + sends 403 on a cross-project hit.
 */
async function assertObligationInProject(
  db: admin.firestore.Firestore,
  obligationId: string,
  projectId: string,
  res: import('express').Response,
): Promise<boolean> {
  const snap = await db
    .collection(COLLECTION_OBLIGATIONS)
    .doc(obligationId)
    .get();
  if (snap.exists) {
    const existing = (snap.data() ?? {}) as { projectId?: unknown };
    if (
      typeof existing.projectId === 'string' &&
      existing.projectId !== projectId
    ) {
      res.status(403).json({ error: 'forbidden_cross_project' });
      return false;
    }
  }
  return true;
}

/**
 * Load obligations for the given project. The collection is shared across
 * projects (one doc per obligation) so we filter by `projectId` field.
 */
async function loadProjectObligations(
  projectId: string,
): Promise<Array<{ id: string; obligation: LegalObligation }>> {
  const snap = await admin
    .firestore()
    .collection(COLLECTION_OBLIGATIONS)
    .where('projectId', '==', projectId)
    .get();
  const out: Array<{ id: string; obligation: LegalObligation }> = [];
  for (const doc of snap.docs) {
    const data = doc.data() as LegalObligation & { projectId?: string };
    if (!data.nextDueAt || !data.alertLeadDays || !data.kind) continue;
    out.push({
      id: doc.id,
      obligation: {
        id: doc.id,
        kind: data.kind,
        label: data.label,
        legalCitation: data.legalCitation,
        recurrence: data.recurrence,
        alertLeadDays: data.alertLeadDays,
        nextDueAt: data.nextDueAt,
      },
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// shared schemas
// ────────────────────────────────────────────────────────────────────────

const obligationKindSchema = z.enum([
  'audit',
  'env_measurement',
  'training_renewal',
  'cphs_meeting',
  'mutualidad_report',
  'drill',
  'medical_exam',
  'document_renewal',
  'permit_renewal',
]) as unknown as z.ZodType<ObligationKind>;

const recurrencePatternSchema = z.enum([
  'monthly',
  'quarterly',
  'biannual',
  'annual',
  'biennial',
]) as unknown as z.ZodType<RecurrencePattern>;

const obligationSchema = z.object({
  id: z.string().min(1).max(200),
  kind: obligationKindSchema,
  label: z.string().min(1).max(500),
  legalCitation: z.string().min(1).max(500),
  recurrence: recurrencePatternSchema,
  alertLeadDays: z.number().int().min(0).max(365),
  nextDueAt: z.string().min(10),
}) as unknown as z.ZodType<LegalObligation>;

// ────────────────────────────────────────────────────────────────────────
// 1. GET /:projectId/legal-calendar/upcoming?days=30
//    Lists obligations due within `days` (default 30). Returns calendar
//    entries (with derived isInAlertWindow / daysUntilDue / isOverdue) +
//    summary counters. The UI uses this for the "upcoming" tab.
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/legal-calendar/upcoming',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    const days = Math.max(
      1,
      Math.min(365, Number.parseInt(String(req.query.days ?? '30'), 10) || 30),
    );
    try {
      const rows = await loadProjectObligations(projectId);
      const calendar = computeCalendar(rows.map((r) => r.obligation));
      // "Upcoming" = within window AND not overdue. Overdues live on their
      // own endpoint so the UI can render them with red-tone urgency.
      const upcoming: CalendarEntry[] = calendar.filter(
        (e) => !e.isOverdue && e.daysUntilDue <= days,
      );
      const summary: CalendarSummary = summarizeCalendar(calendar);
      return res.json({ entries: upcoming, summary, windowDays: days });
    } catch (err) {
      logger.error?.('legalCalendar.upcoming.error', err);
      captureRouteError(err, 'legalCalendar.upcoming', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. GET /:projectId/legal-calendar/overdue
//    Lists obligations whose nextDueAt is in the past. The UI surfaces
//    these in red — the empresa needs to act (firmar + entregar).
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/legal-calendar/overdue',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const rows = await loadProjectObligations(projectId);
      const calendar = computeCalendar(rows.map((r) => r.obligation));
      const overdue: CalendarEntry[] = calendar.filter((e) => e.isOverdue);
      return res.json({ entries: overdue, count: overdue.length });
    } catch (err) {
      logger.error?.('legalCalendar.overdue.error', err);
      captureRouteError(err, 'legalCalendar.overdue', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/legal-calendar/acknowledge
//    The supervisor marks an obligation as done (firmada + entregada).
//    We roll `nextDueAt` to the next cycle via `advanceObligation`. We do
//    NOT call any external API: la empresa firmó y entregó manualmente;
//    aquí solo registramos que el ciclo se cerró.
//
//    Body: { obligation } — the current legal-obligation doc.
//    Response: { obligation } — the next-cycle doc with nextDueAt rolled.
// ────────────────────────────────────────────────────────────────────────

const acknowledgeSchema = z.object({
  obligation: obligationSchema,
  /** Optional notes captured from the supervisor (firma/entrega). */
  notes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/legal-calendar/acknowledge',
  verifyAuth,
  idempotencyKey(),
  validate(acknowledgeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof acknowledgeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    const db = admin.firestore();
    if (!(await assertObligationInProject(db, body.obligation.id, projectId, res)))
      return undefined;
    try {
      const next = advanceObligation(body.obligation);
      // Persist the new nextDueAt + an audit entry. Best-effort: the engine
      // return value is the wire response even if persistence flakes —
      // matches the stoppage.recommend pattern.
      try {
        await db
          .collection(COLLECTION_OBLIGATIONS)
          .doc(body.obligation.id)
          .set(
            {
              nextDueAt: next.nextDueAt,
              lastAcknowledgedAt: new Date().toISOString(),
              lastAcknowledgedByUid: callerUid,
              lastAcknowledgeNotes: body.notes ?? '',
              projectId,
            },
            { merge: true },
          );
      } catch (persistErr) {
        logger.warn?.('legalCalendar.acknowledge.persist_failed', persistErr);
        captureRouteError(persistErr, 'legalCalendar.acknowledge.persist', {
          callerUid,
          projectId,
        });
      }
      await auditServerEvent(req, 'legalCalendar.acknowledge', 'legalCalendar', {
        obligationId: body.obligation.id,
        kind: body.obligation.kind,
        nextDueAt: next.nextDueAt,
      }, { projectId });
      return res.json({ obligation: next });
    } catch (err) {
      logger.error?.('legalCalendar.acknowledge.error', err);
      captureRouteError(err, 'legalCalendar.acknowledge', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/legal-calendar/snooze
//    Postpone an obligation's `nextDueAt` by a given number of days. Used
//    when the empresa requests an extension (e.g. mutualidad approved a
//    rolling 30-day deferral). We do NOT auto-extend deadlines silently —
//    the supervisor invokes this explicitly with a reason.
// ────────────────────────────────────────────────────────────────────────

const snoozeSchema = z.object({
  obligation: obligationSchema,
  /** Days to push the next due date out. Capped to one year. */
  days: z.number().int().min(1).max(365),
  /** Reason for the deferral — required, audit-grade. */
  reason: z.string().min(10).max(1000),
});

router.post(
  '/:projectId/legal-calendar/snooze',
  verifyAuth,
  idempotencyKey(),
  validate(snoozeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof snoozeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    const db = admin.firestore();
    if (!(await assertObligationInProject(db, body.obligation.id, projectId, res)))
      return undefined;
    try {
      const dueMs = Date.parse(body.obligation.nextDueAt);
      if (Number.isNaN(dueMs)) {
        return res.status(400).json({
          error: 'invalid_date',
          message: 'nextDueAt is not a valid ISO date.',
        });
      }
      const nextMs = dueMs + body.days * 86_400_000;
      const next: LegalObligation = {
        ...body.obligation,
        nextDueAt: new Date(nextMs).toISOString(),
      };
      try {
        await db
          .collection(COLLECTION_OBLIGATIONS)
          .doc(body.obligation.id)
          .set(
            {
              nextDueAt: next.nextDueAt,
              lastSnoozedAt: new Date().toISOString(),
              lastSnoozedByUid: callerUid,
              lastSnoozeReason: body.reason,
              lastSnoozeDays: body.days,
              projectId,
            },
            { merge: true },
          );
      } catch (persistErr) {
        logger.warn?.('legalCalendar.snooze.persist_failed', persistErr);
        captureRouteError(persistErr, 'legalCalendar.snooze.persist', {
          callerUid,
          projectId,
        });
      }
      await auditServerEvent(req, 'legalCalendar.snooze', 'legalCalendar', {
        obligationId: body.obligation.id,
        kind: body.obligation.kind,
        snoozeDays: body.days,
        reason: body.reason,
        nextDueAt: next.nextDueAt,
      }, { projectId });
      return res.json({ obligation: next });
    } catch (err) {
      logger.error?.('legalCalendar.snooze.error', err);
      captureRouteError(err, 'legalCalendar.snooze', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. GET /:projectId/legal-calendar/history
//    Returns the per-obligation reminder history (which reminders fired
//    when, plus snooze/ack metadata). Useful for audits — un fiscalizador
//    quiere ver que se notificó al responsable antes del vencimiento.
// ────────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  obligationId: string;
  kind: ObligationKind;
  label: string;
  legalCitation: string;
  nextDueAt: string;
  reminders: Array<{
    sentAtIso: string;
    daysUntilWhenSent: number;
  }>;
  lastAcknowledgedAt?: string;
  lastAcknowledgedByUid?: string;
  lastSnoozedAt?: string;
  lastSnoozedByUid?: string;
  lastSnoozeReason?: string;
}

router.get(
  '/:projectId/legal-calendar/history',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const db = admin.firestore();
      const snap = await db
        .collection(COLLECTION_OBLIGATIONS)
        .where('projectId', '==', projectId)
        .get();
      const entries: HistoryEntry[] = [];
      for (const doc of snap.docs) {
        const data = doc.data() as LegalObligation & {
          projectId?: string;
          lastAcknowledgedAt?: string;
          lastAcknowledgedByUid?: string;
          lastSnoozedAt?: string;
          lastSnoozedByUid?: string;
          lastSnoozeReason?: string;
        };
        if (!data.nextDueAt || !data.kind) continue;
        let reminders: Array<{
          sentAtIso: string;
          daysUntilWhenSent: number;
        }> = [];
        try {
          const remSnap = await doc.ref
            .collection(SUBCOLLECTION_REMINDERS)
            .get();
          reminders = remSnap.docs.map((r) => {
            const rd = r.data() as {
              sentAtIso?: string;
              daysUntilWhenSent?: number;
            };
            return {
              sentAtIso: rd.sentAtIso ?? '',
              daysUntilWhenSent: rd.daysUntilWhenSent ?? 0,
            };
          });
        } catch (subErr) {
          logger.warn?.('legalCalendar.history.subcollection_failed', {
            obligationId: doc.id,
            err: String(subErr),
          });
        }
        entries.push({
          obligationId: doc.id,
          kind: data.kind,
          label: data.label,
          legalCitation: data.legalCitation,
          nextDueAt: data.nextDueAt,
          reminders,
          lastAcknowledgedAt: data.lastAcknowledgedAt,
          lastAcknowledgedByUid: data.lastAcknowledgedByUid,
          lastSnoozedAt: data.lastSnoozedAt,
          lastSnoozedByUid: data.lastSnoozedByUid,
          lastSnoozeReason: data.lastSnoozeReason,
        });
      }
      return res.json({ entries, count: entries.length });
    } catch (err) {
      logger.error?.('legalCalendar.history.error', err);
      captureRouteError(err, 'legalCalendar.history', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
