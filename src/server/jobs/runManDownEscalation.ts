// Praeventio Guard — OLA 1: ManDown graduated-escalation cron.
//
// A worker whose phone detects a fall / prolonged immobility writes a FLAT
// `mandown_events` doc (see `hooks/useManDownDetection.ts` `triggerAlert`):
//
//   { projectId, workerId, workerName, location: "<lat>, <lng>" | "<error text>",
//     status: 'active', triggeredAt: serverTimestamp(), acknowledgedBy: null, … }
//
// `triggerAlert` already fires ONE emergency dispatch at detection. But if the
// worker is unconscious and nobody acknowledges, NOTHING re-pages a wider
// circle. This cron closes that gap: every minute it sweeps the active events
// and escalates supervisor → brigade → emergency_services as time without an
// ACK passes, mirroring the lone-worker escalation cron.
//
// The pure stage resolver (`services/loneWorker/manDownEscalationStage.ts`)
// decides which levels are warranted from the elapsed time; this job enumerates
// active events, fires the notify hook per newly-warranted level, and persists
// an idempotency marker so a level is paged at most once (per event, per day).
//
// Idempotency by (eventId, level, day): notify failure does NOT write the
// marker, so the next sweep retries — vidas dependen, a "marked sent" with zero
// delivery is the worst case. Each level is independent: a supervisor FCM
// failure never blocks the emergency_services page.

import type admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';
import {
  manDownLevelsForElapsed,
  type ManDownEscalationLevel,
} from '../../services/loneWorker/manDownEscalationStage.js';
import { DEFAULT_MAN_DOWN_CONFIG, type ManDownConfig } from '../../services/loneWorker/manDownTimer.js';

/** Context handed to the notify hook for a single (event, level) escalation. */
export interface ManDownEscalationInfo {
  eventId: string;
  workerId: string;
  workerName: string | null;
  level: ManDownEscalationLevel;
  /** ISO 8601 of when the man-down was first detected. */
  triggeredAtIso: string;
  /** Human message (Spanish-CL) for the notification body. */
  message: string;
  /** Worker's last-known coords parsed from the flat doc's location string. */
  location: { lat: number; lng: number } | null;
}

export interface ManDownCronDeps {
  db: admin.firestore.Firestore;
  /** Override clock for tests. */
  now?: () => Date;
  /**
   * Collection path. Default `'mandown_events'` (legacy root). Production data
   * is project-scoped: `projects/{projectId}/mandown_events`
   * (see `hooks/useManDownDetection.ts`). The caller enumerates projects and
   * invokes the cron once per project with the scoped path.
   */
  collectionPath?: string;
  /** Escalation timing config. Defaults to DEFAULT_MAN_DOWN_CONFIG. */
  config?: ManDownConfig;
  /** Hook to dispatch a notification for one warranted level (FCM/Resend). */
  notify?: (info: ManDownEscalationInfo) => Promise<void>;
}

export interface ManDownCronResult {
  eventsScanned: number;
  escalationsEmitted: number;
  escalationsSkippedIdempotent: number;
  byLevel: { supervisor: number; brigade: number; emergency_services: number };
  startedAtIso: string;
  finishedAtIso: string;
  errors: number;
}

const DEFAULT_COLLECTION = 'mandown_events';

/**
 * Best-effort conversion of the persisted `triggeredAt` to epoch millis.
 * Handles a Firestore Timestamp (the real shape), a Date, an ISO string, a raw
 * number, or a `{ seconds }` POJO. Returns null when it cannot be parsed — the
 * cron then skips the event rather than guessing an elapsed time.
 */
function triggeredAtMs(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && typeof (raw as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (raw as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof raw === 'object' && typeof (raw as { seconds?: unknown }).seconds === 'number') {
    return (raw as { seconds: number }).seconds * 1000;
  }
  return null;
}

/**
 * Parses the flat doc's `location` string ("<lat>, <lng>") into coords so the
 * responder feed/FCM payload can point to the worker. Returns null for the
 * error placeholders the hook writes when GPS is unavailable.
 */
function parseLocationString(loc: unknown): { lat: number; lng: number } | null {
  if (typeof loc !== 'string') return null;
  const m = loc.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function messageForLevel(level: ManDownEscalationLevel, who: string): string {
  switch (level) {
    case 'supervisor':
      return `Trabajador ${who} caído o inmóvil — alerta supervisor (man down)`;
    case 'brigade':
      return `Trabajador ${who} caído sin confirmación — activar brigada`;
    case 'emergency_services':
      return `Trabajador ${who} caído — PROTOCOLO EMERGENCIA (SAMU + brigada)`;
  }
}

export async function runManDownEscalationCron(
  deps: ManDownCronDeps,
): Promise<ManDownCronResult> {
  const now = deps.now ?? (() => new Date());
  const config = deps.config ?? DEFAULT_MAN_DOWN_CONFIG;
  const collectionPath = deps.collectionPath ?? DEFAULT_COLLECTION;
  const startedAt = now();
  const result: ManDownCronResult = {
    eventsScanned: 0,
    escalationsEmitted: 0,
    escalationsSkippedIdempotent: 0,
    byLevel: { supervisor: 0, brigade: 0, emergency_services: 0 },
    startedAtIso: startedAt.toISOString(),
    finishedAtIso: '',
    errors: 0,
  };

  let snap: admin.firestore.QuerySnapshot;
  try {
    snap = await deps.db.collection(collectionPath).where('status', '==', 'active').get();
  } catch (e) {
    logger.warn?.('man_down_cron.scan_failed', { collectionPath, err: String(e) });
    result.errors += 1;
    result.finishedAtIso = now().toISOString();
    return result;
  }

  result.eventsScanned = snap.size;
  const evalNow = now();
  const nowMs = evalNow.getTime();
  const dayIso = evalNow.toISOString().slice(0, 10);

  for (const doc of snap.docs) {
    try {
      const data = doc.data() as {
        triggeredAt?: unknown;
        workerId?: unknown;
        workerName?: unknown;
        location?: unknown;
      };

      const tMs = triggeredAtMs(data.triggeredAt);
      if (tMs == null) {
        logger.warn?.('man_down_cron.bad_triggeredAt', { id: doc.id });
        continue;
      }
      const elapsedSec = (nowMs - tMs) / 1000;
      const levels = manDownLevelsForElapsed(elapsedSec, config);
      if (levels.length === 0) continue;

      const workerId = typeof data.workerId === 'string' ? data.workerId : 'desconocido';
      const workerName = typeof data.workerName === 'string' ? data.workerName : null;
      const location = parseLocationString(data.location);
      const triggeredAtIso = new Date(tMs).toISOString();

      // Each level is independent: a failed supervisor page must never block the
      // emergency_services page for the same (possibly unconscious) worker.
      for (const level of levels) {
        const key = `${doc.id}_${level}_${dayIso}`;
        const markerRef = deps.db
          .collection(collectionPath)
          .doc(doc.id)
          .collection('escalations')
          .doc(key);

        let existing: admin.firestore.DocumentSnapshot;
        try {
          existing = await markerRef.get();
        } catch (e) {
          logger.warn?.('man_down_cron.marker_read_failed', { id: doc.id, level, err: String(e) });
          result.errors += 1;
          continue;
        }
        if (existing.exists) {
          result.escalationsSkippedIdempotent += 1;
          continue;
        }

        const info: ManDownEscalationInfo = {
          eventId: doc.id,
          workerId,
          workerName,
          level,
          triggeredAtIso,
          message: messageForLevel(level, workerName ?? workerId),
          location,
        };

        // Notify FIRST. If it throws, do NOT persist the marker so the next
        // sweep retries until someone is actually paged.
        if (deps.notify) {
          try {
            await deps.notify(info);
          } catch (e) {
            logger.warn?.('man_down_cron.notify_failed', { id: doc.id, level, err: String(e) });
            result.errors += 1;
            continue;
          }
        }

        try {
          await markerRef.set({
            eventId: doc.id,
            level,
            message: info.message,
            triggeredAtIso,
            workerId,
            workerName: workerName ?? null,
            location: location ?? null,
            notified: Boolean(deps.notify),
            escalatedAtIso: evalNow.toISOString(),
          });
        } catch (e) {
          logger.warn?.('man_down_cron.marker_write_failed', { id: doc.id, level, err: String(e) });
          result.errors += 1;
          continue;
        }

        result.escalationsEmitted += 1;
        result.byLevel[level] += 1;
      }
    } catch (e) {
      logger.warn?.('man_down_cron.event_failed', { id: doc.id, err: String(e) });
      result.errors += 1;
    }
  }

  result.finishedAtIso = now().toISOString();
  return result;
}
