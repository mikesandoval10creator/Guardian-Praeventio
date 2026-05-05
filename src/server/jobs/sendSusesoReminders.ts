// SPDX-License-Identifier: MIT
//
// Sprint 28 follow-up — SUSESO DIAT/DIEP deadline reminder reaper.
//
// Scope: Praeventio does NOT submit DIAT/DIEP forms to SUSESO/the
// mutualidad. The EMPRESA does that (Ley 16.744 art. 76). This cron
// reminds the empresa (gerente/admin/supervisor of the project, plus
// the worker for DIATs) that the legal plazo is ticking.
//
// Mirror of `checkExpiredPpe.ts` — chained from the same Cloud Scheduler
// invocation `POST /api/maintenance/check-overdue` so we don't proliferate
// cron entries.
//
// Key invariants:
//   • Idempotent at YYYY-MM-DD granularity per (formId, recipientUid).
//   • Forms in `submitted_by_company` are NEVER spammed.
//   • Forms whose legalDeadline elapsed > 7 días are skipped to avoid
//     forever-spamming abandoned forms (audit row + UI badge already
//     surface them; the empresa knows it's overdue).
//   • Per-form failures NEVER abort the scan (mirrors checkExpiredPpe).

import type { Firestore } from 'firebase-admin/firestore';
import type { messaging as adminMessaging } from 'firebase-admin';
import {
  daysUntilDeadline,
  escalationLevel,
  reminderIdempotencyKey,
  type EscalationLevel,
  type SusesoFormKindLocal,
  type SusesoReminderEntry,
} from '../../services/suseso/reminders.js';

type FirestoreFactory = () => Firestore;
type MessagingFactory = () => adminMessaging.Messaging;

/**
 * Per-recipient delivery callback. Decoupled from a concrete FCM impl so
 * tests can inject a vi.fn() and the route layer can wire the real
 * fcmAdapter + Resend email service.
 */
export type ReminderDispatcher = (args: {
  recipientUid: string;
  channels: Array<'push' | 'email'>;
  formId: string;
  formKind: SusesoFormKindLocal;
  daysLeft: number;
  level: EscalationLevel;
  legalDeadline: string;
  isWorker: boolean;
  mutualidad?: string;
}) => Promise<{ pushSent: boolean; emailSent: boolean }>;

export interface SendSusesoRemindersOptions {
  getDb?: FirestoreFactory;
  getMessaging?: MessagingFactory;
  dispatcher?: ReminderDispatcher;
  now?: () => Date;
  /** Page size for the tenant scan. Default 100. */
  tenantLimit?: number;
  /** Page size for the suseso_forms scan per tenant. Default 200. */
  formLimit?: number;
}

export interface SendSusesoRemindersResult {
  scanned: number;
  remindedTotal: number;
  escalations: Record<EscalationLevel, number>;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface MinimalFormDoc {
  formId: string;
  kind?: string;
  status?: string;
  legalDeadline?: string;
  incidentDate?: string;
  workerUid?: string | null;
  workerRut?: string | null;
  workerFullName?: string | null;
  projectId?: string | null;
  mutualidad?: string;
  reportedBy?: { uid?: string };
  remindersSent?: SusesoReminderEntry[];
  // Sub-set of SusesoForm — see types.ts (Bucket B6).
}

/**
 * Resolve recipients for a form:
 *   • the project's gerente/admin/supervisor members,
 *   • the form creator (reportedBy.uid) — even if their role changed,
 *   • for DIAT only, the affected worker (workerUid) so they know their
 *     empresa has a legal obligation pending.
 *
 * Returns a Set keyed by uid so duplicates collapse.
 */
async function resolveRecipients(
  db: Firestore,
  form: MinimalFormDoc,
): Promise<Set<string>> {
  const recipients = new Set<string>();

  if (form.reportedBy?.uid) recipients.add(form.reportedBy.uid);
  if (form.kind === 'DIAT' && form.workerUid) recipients.add(form.workerUid);

  if (form.projectId) {
    try {
      const membersSnap = await db
        .collection('projects')
        .doc(form.projectId)
        .collection('members')
        .get();
      for (const m of membersSnap.docs) {
        const data = m.data() as { role?: string };
        if (
          data?.role === 'gerente' ||
          data?.role === 'admin' ||
          data?.role === 'supervisor'
        ) {
          recipients.add(m.id);
        }
      }
    } catch {
      // missing project sub-collection → fall back to creator-only.
    }
  }

  return recipients;
}

/**
 * Scan + remind. Returns counts for the consolidated maintenance JSON.
 */
export async function sendSusesoReminders(
  opts: SendSusesoRemindersOptions = {},
): Promise<SendSusesoRemindersResult> {
  const db = opts.getDb
    ? opts.getDb()
    : (await import('firebase-admin')).default.firestore();
  const dispatcher: ReminderDispatcher =
    opts.dispatcher ??
    (async () => ({ pushSent: false, emailSent: false }));
  const now = (opts.now ?? (() => new Date()))();
  const tenantLimit = opts.tenantLimit ?? 100;
  const formLimit = opts.formLimit ?? 200;

  const nowIso = now.toISOString();
  const cutoffOlderThan7d = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();

  let scanned = 0;
  let remindedTotal = 0;
  const escalations: Record<EscalationLevel, number> = {
    green: 0,
    yellow: 0,
    orange: 0,
    red: 0,
    overdue: 0,
  };

  const tenantsSnap = await db.collection('tenants').limit(tenantLimit).get();

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    const formsSnap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('suseso_forms')
      .limit(formLimit)
      .get();

    for (const formDoc of formsSnap.docs) {
      const raw = formDoc.data() as MinimalFormDoc;
      const form: MinimalFormDoc = { ...raw, formId: formDoc.id };
      scanned += 1;

      // Skip forms already submitted by the empresa.
      if (form.status === 'submitted_by_company') continue;
      // Skip forms without a legalDeadline (B6 main bucket may not have
      // backfilled them yet — graceful degradation, not an error).
      if (!form.legalDeadline || typeof form.legalDeadline !== 'string') continue;
      // Skip stale-overdue forms (>7 días past deadline).
      if (form.legalDeadline < cutoffOlderThan7d) continue;

      const daysLeft = daysUntilDeadline(form.legalDeadline, now.getTime());
      const level = escalationLevel(daysLeft);
      escalations[level] += 1;

      const recipients = await resolveRecipients(db, form);
      if (recipients.size === 0) continue;

      const remindersSent = Array.isArray(form.remindersSent)
        ? form.remindersSent
        : [];
      const todayKey = reminderIdempotencyKey(form.formId, '', now).split(':').slice(-1)[0];

      const newEntries: SusesoReminderEntry[] = [];
      for (const recipientUid of recipients) {
        // Idempotency: skip if we already reminded this recipient today
        // for this form. Compare by (recipientUid, YYYY-MM-DD) prefix.
        const alreadySentToday = remindersSent.some(
          (r) =>
            r.recipientUid === recipientUid &&
            typeof r.sentAt === 'string' &&
            r.sentAt.slice(0, 10) === todayKey,
        );
        if (alreadySentToday) continue;

        try {
          const result = await dispatcher({
            recipientUid,
            channels: ['push', 'email'],
            formId: form.formId,
            formKind: (form.kind as SusesoFormKindLocal) ?? 'DIAT',
            daysLeft,
            level,
            legalDeadline: form.legalDeadline,
            isWorker: form.workerUid === recipientUid,
            mutualidad: form.mutualidad,
          });
          if (result.pushSent) {
            newEntries.push({ sentAt: nowIso, channel: 'push', recipientUid });
            remindedTotal += 1;
          }
          if (result.emailSent) {
            newEntries.push({ sentAt: nowIso, channel: 'email', recipientUid });
            remindedTotal += 1;
          }
        } catch {
          // Per-recipient failure must not abort the form (let alone the scan).
        }
      }

      if (newEntries.length > 0) {
        try {
          await formDoc.ref.update({
            remindersSent: [...remindersSent, ...newEntries],
          });
        } catch {
          // Keep the audit row consistent with what was actually delivered:
          // if the update fails we'd over-report — but per-form failures
          // must not abort the scan, and the next pass will retry naturally.
        }

        // Audit row per form (single entry, even if multiple recipients).
        try {
          await db.collection('audit_logs').add({
            action: 'suseso.deadline.reminded',
            module: 'suseso',
            details: {
              tenantId,
              formId: form.formId,
              kind: form.kind ?? null,
              level,
              daysLeft,
              recipientCount: newEntries.length,
            },
            userId: null,
            userEmail: null,
            projectId: form.projectId ?? null,
            timestamp: nowIso,
          });
        } catch {
          // observability never breaks the scan
        }
      }
    }
  }

  return { scanned, remindedTotal, escalations };
}
