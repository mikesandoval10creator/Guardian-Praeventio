// Praeventio Guard — Sprint 40: Resilience health alert cron.
//
// El servicio puro `resilienceHealthMonitor.buildResilienceHealthReport`
// es agnostic del environment — recibe checkers inyectados y agrega.
// Este job lo invoca SERVER-SIDE con checkers que tocan los subsistemas
// que el server puede medir desde su POV:
//
//   - `firestore` — ping `_health/ping` doc read
//   - `gemini`    — opcional, llama a un endpoint de Google AI con HEAD
//   - `network`   — siempre healthy server-side (si llegó hasta acá)
//
// SLM / KEK / encrypted_kv / zettelkasten son client-side. Si el caller
// también quiere observar el estado client-side, los clients hacen POST
// a `/api/health/report` y este cron lee la última muestra desde
// `health_reports/`. Eso queda para un PR siguiente.
//
// Cuando el `overallStatus` resulta `critical`, el job:
//   1. Persiste el reporte en `health_reports/{ISO_DATE}_{rand}`
//   2. Marca idempotency en `health_alerts/{YYYY-MM-DD}` para NO spammear
//      a la misma audiencia el mismo día
//   3. Llama al hook `notifyOps(report)` (típicamente FCM multicast a
//      tokens de la role `ops` u `admin`)
//
// `degraded` y `healthy` se persisten pero NO disparan FCM (evitamos
// alert fatigue — opinión documentada: gerencia y prevencionistas
// quieren saber sólo cuando algo ESTÁ ROTO, no cuando se midió).

import type admin from 'firebase-admin';
import {
  buildResilienceHealthReport,
  type ResilienceCheckers,
  type ResilienceHealthReport,
} from '../../services/observability/resilienceHealthMonitor.js';
import { logger } from '../../utils/logger.js';
import { randomUUID } from 'node:crypto';

export interface ResilienceHealthAlertDeps {
  db: admin.firestore.Firestore;
  /** Checkers ya configurados con sus closures (Firestore ping, Gemini ping, …). */
  checkers: ResilienceCheckers;
  /** Override clock para tests. */
  now?: () => Date;
  /**
   * Hook de notificación cuando overallStatus='critical' y NO se alertó
   * todavía hoy. El default es no-op (el cron se vuelve write-only).
   */
  notifyOps?: (report: ResilienceHealthReport) => Promise<void>;
  /** Si true (default), persiste TODOS los reportes en health_reports/. */
  persistAllReports?: boolean;
  /** Timeout por checker (ms). Default 3000. */
  checkerTimeoutMs?: number;
}

export interface ResilienceHealthAlertResult {
  overallStatus: ResilienceHealthReport['overallStatus'];
  /** Si se emitió FCM en esta corrida. False si ya se alertó hoy. */
  alertFired: boolean;
  /** True si se persistió el reporte. */
  reportPersisted: boolean;
  /** Idempotency key del alert (formato YYYY-MM-DD) si aplica. */
  alertIdempotencyKey?: string;
  /** Reporte completo (útil para tests + audit). */
  report: ResilienceHealthReport;
  startedAtIso: string;
  finishedAtIso: string;
  errors: number;
}

const REPORTS_COLLECTION = 'health_reports';
const ALERTS_COLLECTION = 'health_alerts';

function isoDateKey(d: Date): string {
  // YYYY-MM-DD UTC — idempotency por día calendario UTC.
  return d.toISOString().slice(0, 10);
}

export async function runResilienceHealthAlertCron(
  deps: ResilienceHealthAlertDeps,
): Promise<ResilienceHealthAlertResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const persistAll = deps.persistAllReports !== false; // default ON

  let errors = 0;
  const report = await buildResilienceHealthReport(deps.checkers, {
    nowMs: () => now().getTime(),
    checkerTimeoutMs: deps.checkerTimeoutMs,
  });

  // ── 1) Persist (no-op si persistAll=false y status no es critical) ──
  let reportPersisted = false;
  const shouldPersist = persistAll || report.overallStatus === 'critical';
  if (shouldPersist) {
    try {
      // ID: timestamp UTC ordenable + suffix random para evitar colisión
      // entre corridas en el mismo segundo (no usamos auto-id porque
      // queremos sort lexicográfico por timestamp). crypto.randomUUID()
      // provides 128 bits of entropy per RFC-4122 v4 (suffix has hyphens
      // but the surrounding timestamp keeps lexicographic ordering by
      // arrival time).
      const id = `${startedAt.toISOString().replace(/[:.]/g, '-')}_${randomUUID()}`;
      await deps.db.collection(REPORTS_COLLECTION).doc(id).set({
        ...report,
        // Firestore no permite undefined a fondo — clean opcionales
        recommendations: report.recommendations.map((r) => ({ ...r })),
      });
      reportPersisted = true;
    } catch (e) {
      logger.warn?.('resilience_health.persist_failed', { err: String(e) });
      errors += 1;
    }
  }

  // ── 2) Alert fan-out (solo si critical + no alertado hoy) ──
  let alertFired = false;
  let alertIdempotencyKey: string | undefined;

  if (report.overallStatus === 'critical') {
    alertIdempotencyKey = isoDateKey(startedAt);
    const alertRef = deps.db.collection(ALERTS_COLLECTION).doc(alertIdempotencyKey);

    let alreadyAlerted = false;
    try {
      const existing = await alertRef.get();
      alreadyAlerted = existing.exists;
    } catch (e) {
      logger.warn?.('resilience_health.alert_check_failed', { err: String(e) });
      errors += 1;
    }

    if (!alreadyAlerted) {
      if (deps.notifyOps) {
        try {
          await deps.notifyOps(report);
        } catch (e) {
          logger.warn?.('resilience_health.notify_failed', { err: String(e) });
          errors += 1;
        }
      }
      // Persistimos el marker incluso si notifyOps no estaba — sino el
      // próximo cron-run del mismo día creería que nunca se "intentó".
      try {
        await alertRef.set({
          idempotencyKey: alertIdempotencyKey,
          firedAtIso: startedAt.toISOString(),
          notified: Boolean(deps.notifyOps),
          subsystemsCritical: report.subsystems
            .filter((s) => s.status === 'critical')
            .map((s) => s.id),
        });
        alertFired = true;
      } catch (e) {
        logger.warn?.('resilience_health.alert_marker_failed', { err: String(e) });
        errors += 1;
      }
    }
  }

  const finishedAt = now();
  return {
    overallStatus: report.overallStatus,
    alertFired,
    reportPersisted,
    alertIdempotencyKey,
    report,
    startedAtIso: startedAt.toISOString(),
    finishedAtIso: finishedAt.toISOString(),
    errors,
  };
}
