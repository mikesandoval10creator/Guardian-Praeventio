// Praeventio Guard — Sprint 39: Lone worker auto-escalation cron.
//
// El servicio loneWorkerService.ts es pure logic (derive + decide).
// Este job ejecuta CADA 5 MINUTOS sobre todas las sesiones activas
// y emite escalamientos cuando deriveLoneWorkerStatus dispara
// overdue/help_requested.
//
// Niveles de escalación (de loneWorkerService.decideEscalation):
//   - 'supervisor'         → 1× intervalo sin check-in
//   - 'brigade'            → 2× intervalo sin check-in
//   - 'emergency_services' → worker pulsó "ayuda"
//
// Idempotency por (sessionId, level): el cron NO re-emite el mismo
// nivel si ya fue emitido. Solo escala cuando cambia el nivel.

import type admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';
import {
  decideEscalation,
  type LoneWorkerSession,
  type EscalationDecision,
} from '../../services/loneWorker/loneWorkerService.js';

export interface LoneWorkerCronDeps {
  db: admin.firestore.Firestore;
  /** Override clock para tests. */
  now?: () => Date;
  /**
   * Collection path. Default `'lone_worker_sessions'` (legacy root).
   * Production data is project-scoped: `projects/{projectId}/lone_worker_sessions`
   * (ver `services/loneWorker/loneWorkerStore.ts`). El caller debe enumerar
   * proyectos e invocar el cron una vez por proyecto pasando el path scoped.
   */
  collectionPath?: string;
  /** Hook de notificación supervisor (FCM/Resend). */
  notifySupervisor?: (sessionId: string, decision: EscalationDecision) => Promise<void>;
  /** Hook de notificación brigada (cuando level=brigade). */
  notifyBrigade?: (sessionId: string, decision: EscalationDecision) => Promise<void>;
  /** Hook de emergency services (cuando level=emergency_services). */
  notifyEmergency?: (sessionId: string, decision: EscalationDecision) => Promise<void>;
}

export interface LoneWorkerCronResult {
  sessionsScanned: number;
  escalationsEmitted: number;
  escalationsSkippedIdempotent: number;
  byLevel: { supervisor: number; brigade: number; emergency_services: number };
  startedAtIso: string;
  finishedAtIso: string;
  errors: number;
}

const DEFAULT_COLLECTION = 'lone_worker_sessions';

/**
 * Idempotency key persistido en el doc para no re-escalar el mismo nivel.
 */
function idempotencyKey(sessionId: string, decision: EscalationDecision): string {
  return `${sessionId}_${decision.level}_${decision.triggeredAt.slice(0, 10)}`;
}

export async function runLoneWorkerEscalationCron(
  deps: LoneWorkerCronDeps,
): Promise<LoneWorkerCronResult> {
  const now = deps.now ?? (() => new Date());
  const collectionPath = deps.collectionPath ?? DEFAULT_COLLECTION;
  const startedAt = now();
  const result: LoneWorkerCronResult = {
    sessionsScanned: 0,
    escalationsEmitted: 0,
    escalationsSkippedIdempotent: 0,
    byLevel: { supervisor: 0, brigade: 0, emergency_services: 0 },
    startedAtIso: startedAt.toISOString(),
    finishedAtIso: '',
    errors: 0,
  };

  let snap: admin.firestore.QuerySnapshot;
  try {
    snap = await deps.db.collection(collectionPath).where('status', '!=', 'ended').get();
  } catch (e) {
    logger.warn?.('lone_worker_cron.scan_failed', { collectionPath, err: String(e) });
    result.errors += 1;
    result.finishedAtIso = now().toISOString();
    return result;
  }

  result.sessionsScanned = snap.size;

  for (const doc of snap.docs) {
    try {
      const session = doc.data() as LoneWorkerSession;
      const decision = decideEscalation(session, now());
      if (!decision) continue;

      const key = idempotencyKey(doc.id, decision);

      // Check if this exact (session, level, day) already emitted
      const escalationDocRef = deps.db
        .collection(collectionPath)
        .doc(doc.id)
        .collection('escalations')
        .doc(key);

      const existing = await escalationDocRef.get();
      if (existing.exists) {
        result.escalationsSkippedIdempotent += 1;
        continue;
      }

      // Emit notifications based on level
      const notifyHook =
        decision.level === 'supervisor'
          ? deps.notifySupervisor
          : decision.level === 'brigade'
            ? deps.notifyBrigade
            : deps.notifyEmergency;

      // PR #482 codex P1 (round 2): si notify falla, NO persistir el marker
      // idempotente. Vidas dependen — el próximo run (cada 5 min) debe
      // reintentar hasta que alguien sea efectivamente notificado.
      if (notifyHook) {
        try {
          await notifyHook(doc.id, decision);
        } catch (e) {
          logger.warn?.('lone_worker_cron.notify_failed', {
            sessionId: doc.id,
            level: decision.level,
            err: String(e),
          });
          result.errors += 1;
          continue;
        }
      }

      // Persist escalation marker
      await escalationDocRef.set({
        sessionId: doc.id,
        level: decision.level,
        message: decision.message,
        triggeredAtIso: decision.triggeredAt,
        notified: Boolean(notifyHook),
      });

      result.escalationsEmitted += 1;
      result.byLevel[decision.level] += 1;
    } catch (e) {
      logger.warn?.('lone_worker_cron.session_failed', { id: doc.id, err: String(e) });
      result.errors += 1;
    }
  }

  result.finishedAtIso = now().toISOString();
  return result;
}
