// Praeventio Guard — Sprint 39: Cron legal calendar reminders.
//
// El servicio legalObligationsCalendar.ts es pure logic. Este cron
// diario:
//   1. Lista todas las legal_obligations activas por proyecto
//   2. Calcula días hasta nextDueAt
//   3. Si daysUntil ≤ alertLeadDays → emite reminder (FCM + audit_log)
//
// Idempotency: solo emite 1 reminder por (obligationId, dueDay).

import type admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';
import type { LegalObligation } from '../../services/legalCalendar/legalObligationsCalendar.js';

const DEFAULT_COLLECTION = 'legal_obligations';

export interface LegalCalendarRemindersDeps {
  db: admin.firestore.Firestore;
  now?: () => Date;
  /**
   * Collection path. Default `'legal_obligations'` (legacy root). Production
   * data lives under `projects/{projectId}/legal_obligations`
   * (`services/legalCalendar/legalCalendarStore.ts`). El caller debe
   * enumerar proyectos e invocar el cron una vez por proyecto.
   */
  collectionPath?: string;
  notifyResponsible?: (obligationId: string, obligation: LegalObligation, daysUntil: number) => Promise<void>;
}

export interface LegalCalendarRemindersResult {
  scanned: number;
  remindersEmitted: number;
  skippedNotDue: number;
  skippedIdempotent: number;
  errors: number;
  startedAtIso: string;
  finishedAtIso: string;
}

/**
 * Idempotency key: obligation + due day (YYYY-MM-DD) — un solo
 * reminder por obligación y día calendario.
 */
function reminderKey(obligationId: string, dueAtIso: string): string {
  return `${obligationId}_${dueAtIso.slice(0, 10)}`;
}

export async function runLegalCalendarReminders(
  deps: LegalCalendarRemindersDeps,
): Promise<LegalCalendarRemindersResult> {
  const now = deps.now ?? (() => new Date());
  const collectionPath = deps.collectionPath ?? DEFAULT_COLLECTION;
  const startedAt = now();
  const result: LegalCalendarRemindersResult = {
    scanned: 0,
    remindersEmitted: 0,
    skippedNotDue: 0,
    skippedIdempotent: 0,
    errors: 0,
    startedAtIso: startedAt.toISOString(),
    finishedAtIso: '',
  };

  let snap: admin.firestore.QuerySnapshot;
  try {
    snap = await deps.db.collection(collectionPath).get();
  } catch (e) {
    logger.warn?.('legal_reminders.scan_failed', { collectionPath, err: String(e) });
    result.errors += 1;
    result.finishedAtIso = now().toISOString();
    return result;
  }

  result.scanned = snap.size;
  const nowMs = now().getTime();

  for (const doc of snap.docs) {
    try {
      const obligation = doc.data() as LegalObligation;
      if (!obligation.nextDueAt || !obligation.alertLeadDays) {
        result.skippedNotDue += 1;
        continue;
      }

      const dueMs = Date.parse(obligation.nextDueAt);
      if (Number.isNaN(dueMs)) {
        result.errors += 1;
        continue;
      }

      const daysUntil = Math.floor((dueMs - nowMs) / 86_400_000);
      if (daysUntil > obligation.alertLeadDays) {
        result.skippedNotDue += 1;
        continue;
      }

      const key = reminderKey(doc.id, obligation.nextDueAt);
      const remRef = deps.db
        .collection(collectionPath)
        .doc(doc.id)
        .collection('reminders_sent')
        .doc(key);

      const existing = await remRef.get();
      if (existing.exists) {
        result.skippedIdempotent += 1;
        continue;
      }

      if (deps.notifyResponsible) {
        try {
          await deps.notifyResponsible(doc.id, obligation, daysUntil);
        } catch (e) {
          logger.warn?.('legal_reminders.notify_failed', {
            obligationId: doc.id,
            err: String(e),
          });
        }
      }

      await remRef.set({
        sentAtIso: now().toISOString(),
        daysUntilWhenSent: daysUntil,
        obligationKind: obligation.kind,
        legalCitation: obligation.legalCitation,
      });

      result.remindersEmitted += 1;
    } catch (e) {
      logger.warn?.('legal_reminders.entry_failed', { id: doc.id, err: String(e) });
      result.errors += 1;
    }
  }

  result.finishedAtIso = now().toISOString();
  return result;
}
