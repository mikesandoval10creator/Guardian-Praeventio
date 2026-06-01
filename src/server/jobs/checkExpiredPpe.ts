// SPDX-License-Identifier: MIT
//
// Sprint 28 H26 — EPP expiry reaper.
//
// Cron-invoked job that scans `projects/{p}/epp_assignments` for entries
// whose `expiresAt` (ISO string) has passed while `status` is still
// `active`. For every expired assignment we:
//
//   • notify the project's supervisors via FCM push,
//   • write an `audit_logs` row with `action: 'ppe.expired'`,
//   • write a per-project `notifications` doc so the supervisor sees
//     the alert in the UI even if the device push fails / is muted,
//   • flip the assignment to `status: 'expired'` so the next pass does
//     not re-notify (idempotent: only `active` → `expired` ever).
//
// Designed to run from Cloud Scheduler via POST /api/maintenance/check-overdue
// at ~1 h cadence — see `routes/maintenance.ts` for the wrapper.
//
// Mirrors the shape of `checkOverdueMaintenance.ts` (Bucket K.3) so the
// HTTP handler can call both back-to-back and consolidate counts.

import type { Firestore } from 'firebase-admin/firestore';
import type { messaging as adminMessaging } from 'firebase-admin';
import { tracedAsync } from '../../services/observability/tracing.js';
import { logger } from '../../utils/logger.js';

/** Lazy accessors — keep firebase-admin out of import cycles. */
type FirestoreFactory = () => Firestore;
type MessagingFactory = () => adminMessaging.Messaging;

/**
 * Per-project supervisor notifier. Decoupled from
 * `sendToProjectSupervisors` (in routes/emergency.ts) so this job can be
 * unit-tested without hauling in the express Request shape.
 */
export type SupervisorNotifier = (args: {
  projectId: string;
  payload: { title: string; body: string; data?: Record<string, string> };
  db: Firestore;
  messaging: adminMessaging.Messaging;
}) => Promise<{ notified: number; failed: number; supervisorEmails: string[] }>;

export interface CheckExpiredPpeOptions {
  /** Firestore handle factory. Default reads from firebase-admin. */
  getDb?: FirestoreFactory;
  /** FCM messaging factory. Default reads from firebase-admin. */
  getMessaging?: MessagingFactory;
  /**
   * Supervisor notification function. Defaults to a no-op that returns
   * zero counts so the job is testable without firebase-admin loaded.
   * The HTTP route wires the real `sendToProjectSupervisors`.
   */
  notifySupervisors?: SupervisorNotifier;
  /** Override of "now" for tests / replays. Default `new Date()`. */
  now?: () => Date;
  /** Page size for the project scan. Default 100. */
  projectLimit?: number;
  /** Page size for the per-project assignment scan. Default 200. */
  assignmentLimit?: number;
}

export interface CheckExpiredPpeResult {
  /** Number of assignments scanned across all projects. */
  scanned: number;
  /** Number of assignments transitioned `active` → `expired`. */
  expired: number;
  /** Number of supervisor push deliveries successfully dispatched. */
  notified: number;
}

/**
 * Scan + reap. Returns counts so the HTTP wrapper can surface progress
 * to the operator dashboard.
 */
export async function checkExpiredPpe(
  opts: CheckExpiredPpeOptions = {},
): Promise<CheckExpiredPpeResult> {
  return tracedAsync(
    'job.check_expired_ppe',
    {
      projectLimit: opts.projectLimit ?? 100,
      assignmentLimit: opts.assignmentLimit ?? 200,
    },
    () => checkExpiredPpeInner(opts),
  );
}

async function checkExpiredPpeInner(
  opts: CheckExpiredPpeOptions = {},
): Promise<CheckExpiredPpeResult> {
  const db = opts.getDb
    ? opts.getDb()
    : (await import('firebase-admin')).default.firestore();
  const messaging = opts.getMessaging
    ? opts.getMessaging()
    : (await import('firebase-admin')).default.messaging();
  const notifySupervisors: SupervisorNotifier =
    opts.notifySupervisors ??
    (async () => ({ notified: 0, failed: 0, supervisorEmails: [] }));
  const now = (opts.now ?? (() => new Date()))();
  const projectLimit = opts.projectLimit ?? 100;
  const assignmentLimit = opts.assignmentLimit ?? 200;

  const projectsSnap = await db
    .collection('projects')
    .limit(projectLimit)
    .get();

  let scanned = 0;
  let expired = 0;
  let notified = 0;
  const nowIso = now.toISOString();

  for (const projectDoc of projectsSnap.docs) {
    const projectId = projectDoc.id;
    const assignSnap = await db
      .collection('projects')
      .doc(projectId)
      .collection('epp_assignments')
      .where('status', '==', 'active')
      .limit(assignmentLimit)
      .get();

    for (const assignmentDoc of assignSnap.docs) {
      scanned += 1;
      const a = assignmentDoc.data() as {
        workerId?: string;
        workerName?: string;
        eppItemId?: string;
        eppItemName?: string;
        expiresAt?: string | null;
      };

      // Defensive: only act on a string ISO date that's strictly past.
      if (!a.expiresAt || typeof a.expiresAt !== 'string') continue;
      if (a.expiresAt >= nowIso) continue;

      // Flip status so the next pass doesn't re-notify.
      await assignmentDoc.ref.update({
        status: 'expired',
        expiredDetectedAt: nowIso,
      });
      expired += 1;

      // Audit row — server-stamped, no req context here so we mirror the
      // `khipu_ipn_completed` audit shape (userId/email null, projectId set).
      await db.collection('audit_logs').add({
        action: 'ppe.expired',
        module: 'epp',
        details: {
          projectId,
          assignmentId: assignmentDoc.id,
          workerId: a.workerId ?? null,
          eppItemId: a.eppItemId ?? null,
          eppItemName: a.eppItemName ?? null,
          expiresAt: a.expiresAt,
        },
        userId: null,
        userEmail: null,
        projectId,
        timestamp: nowIso,
      });

      // In-app notification doc so the supervisor sees the alert in the
      // dashboard even if push is silenced / muted.
      await db
        .collection('projects')
        .doc(projectId)
        .collection('notifications')
        .add({
          kind: 'ppe.expired',
          createdAt: nowIso,
          read: false,
          title: 'EPP vencido',
          body: `Vence el EPP "${a.eppItemName ?? 'sin nombre'}" para ${a.workerName ?? a.workerId ?? 'un trabajador'}.`,
          assignmentId: assignmentDoc.id,
          workerId: a.workerId ?? null,
          eppItemId: a.eppItemId ?? null,
        });

      // Best-effort supervisor push. Failures here must NOT abort the
      // scan — the audit row + in-app notif still went out.
      try {
        const pushResult = await notifySupervisors({
          projectId,
          payload: {
            title: 'EPP vencido',
            body: `${a.eppItemName ?? 'EPP'} para ${a.workerName ?? a.workerId ?? 'trabajador'} venció el ${a.expiresAt}.`,
            data: {
              kind: 'ppe.expired',
              assignmentId: assignmentDoc.id,
              workerId: a.workerId ?? '',
            },
          },
          db,
          messaging,
        });
        notified += pushResult.notified;
      } catch (err) {
        // The push is best-effort (the audit row + UI notification doc are
        // the reliable channels), so a per-assignment failure must not abort
        // the scan — but log it so the FCM failure rate stays observable.
        logger.warn('ppe_expiry.notify_failed', {
          assignmentId: assignmentDoc.id,
          err: String(err),
        });
      }
    }
  }

  return { scanned, expired, notified };
}
