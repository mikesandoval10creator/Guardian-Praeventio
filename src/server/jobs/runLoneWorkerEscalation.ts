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

import { logger } from '../../utils/logger.js';
import {
  claimEscalationMarker,
  markEscalationDelivered,
  markEscalationWithoutNotifier,
} from './escalationMarker.js';

import type { Firestore, QuerySnapshot } from 'firebase-admin/firestore';
import {
  decideEscalation,
  type LoneWorkerSession,
  type EscalationDecision,
} from '../../services/loneWorker/loneWorkerService.js';

export interface LoneWorkerCronDeps {
  db: Firestore;
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

  let snap: QuerySnapshot;
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
      const evalNow = now();
      const decision = decideEscalation(session, evalNow);
      if (!decision) continue;

      const key = idempotencyKey(doc.id, decision);

      // The marker is the idempotency boundary. It includes the worker's
      // last-known location (when the session has it) so the responder feed
      // shows WHERE the worker is, not just which session escalated.
      const escalationDocRef = deps.db
        .collection(collectionPath)
        .doc(doc.id)
        .collection('escalations')
        .doc(key);
      const markerPayload = {
        sessionId: doc.id,
        level: decision.level,
        message: decision.message,
        triggeredAtIso: decision.triggeredAt,
        lastKnownLocation: decision.lastKnownLocation ?? null,
      };

      // [P0][VIDA] Claim BEFORE the external notification. The previous
      // read-then-write let two overlapping sweeps both notify before either
      // wrote the marker, paging the same supervisor/brigade twice for one
      // worker. A failed delivery keeps the claim with `notified:false`; a
      // later sweep re-claims it after the short lease and retries.
      let claim: Awaited<ReturnType<typeof claimEscalationMarker>>;
      try {
        claim = await claimEscalationMarker({
          db: deps.db,
          markerRef: escalationDocRef,
          payload: markerPayload,
          now: evalNow,
        });
      } catch (e) {
        logger.warn?.('lone_worker_cron.marker_claim_failed', {
          sessionId: doc.id,
          level: decision.level,
          err: String(e),
        });
        result.errors += 1;
        continue;
      }
      if (claim !== 'claimed') {
        result.escalationsSkippedIdempotent += 1;
        continue;
      }

      // Emit notifications based on level.
      const notifyHook =
        decision.level === 'supervisor'
          ? deps.notifySupervisor
          : decision.level === 'brigade'
            ? deps.notifyBrigade
            : deps.notifyEmergency;

      // PR #482 codex P1 (round 2): if notify fails, leave the claim
      // un-delivered. Vidas dependen: the next run (every 5 min, or after
      // the claim lease) must retry until someone is actually notified.
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

      // Persist escalation marker. Includes the worker's last-known location
      // (when the session has it) so the responder feed — readable by project
      // members via the recursive master gate — shows WHERE the worker is, not
      // just which session escalated.
      try {
        if (notifyHook) {
          await markEscalationDelivered(escalationDocRef, markerPayload, now());
        } else {
          // No delivery channel configured. Record it explicitly instead of
          // pretending the escalation was delivered, and stop re-claiming it.
          await markEscalationWithoutNotifier(escalationDocRef, markerPayload, now());
        }
      } catch (e) {
        logger.warn?.('lone_worker_cron.marker_write_failed', {
          sessionId: doc.id,
          level: decision.level,
          err: String(e),
        });
        result.errors += 1;
        continue;
      }

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
