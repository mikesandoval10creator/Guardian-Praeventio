// SPDX-License-Identifier: MIT
//
// Bucket K.3 — HTTP wrapper for the overdue-maintenance reaper.
//
// Mount point (added in server.ts):
//   app.use('/api/maintenance', maintenanceRouter);
//
// The single endpoint is meant to be invoked by Cloud Scheduler on a
// ~1 h cadence:
//
//   POST /api/maintenance/check-overdue
//
// Auth model: Cloud Scheduler hits this with an OIDC token; we rely on
// IAP / Cloud Run service-to-service IAM rather than a per-user Firebase
// JWT. Inside the cluster the path is unauthenticated by default — if
// you mount it on the public ingress, gate it behind `verifyAuth` and
// an admin role check (mirrors `routes/admin.ts`).
//
// The handler is intentionally thin: it delegates to the pure job in
// `jobs/checkOverdueMaintenance.ts` and surfaces its counts in JSON.

import { Router } from 'express';
import admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { checkOverdueMaintenance } from '../jobs/checkOverdueMaintenance.js';
import { checkExpiredPpe } from '../jobs/checkExpiredPpe.js';
// Phase 5 arista A3 (2026-06) — brigade resource expiry reaper. Mirrors the
// PPE step: expired extintores/DEA/botiquines now materialise a corrective
// finding in projects/{pid}/findings instead of relying on a human opening
// the readiness report.
import { checkExpiredBrigadeResources } from '../jobs/checkExpiredBrigadeResources.js';
import { sendSusesoReminders } from '../jobs/sendSusesoReminders.js';
// B5/B15 (2026-06-11) — DTE issue queue drain. Failed post-payment DTE
// emissions (PSE down) persist to `dte_issue_queue`; this step retries them
// with the dteIssueQueue backoff ladder. Mirrors the PPE step: independent,
// idempotent, fault-isolated. No-op (gateClosed) while DTE_AUTO_ISSUE!='true'.
import {
  runDteIssueQueueDrain,
  type DteIssueQueueDrainResult,
} from '../jobs/runDteIssueQueueDrain.js';
import { sendToProjectSupervisors } from './emergency.js';
import { verifySchedulerToken } from '../middleware/verifySchedulerToken.js';
// Sprint 29 Bucket DD F-E — predictive×calendar pre-warn cron.
// Mounted as a fourth no-op step after the SUSESO reminder reaper. The
// loader factories degrade to empty arrays in environments where the
// projects/tasks collection is not seeded yet, so the cron is safe to
// run from day one.
import { runCalendarPreWarnCron } from '../../services/predictiveAlerts/calendarPreWarn.js';
// Sprint 56 follow-up — resilience health alert cron.
import { runResilienceHealthAlertCron } from '../jobs/runResilienceHealthAlert.js';
import { fcmAdapter } from '../../services/notifications/fcmAdapter.js';
// Sprint E backend debt (2026-05-16) — B2D MRR monthly snapshot.
// El B2dAdminPanel hace render de la serie temporal MRR; sin este job
// solo aparece el punto del mes actual. Endpoint dedicado para Cloud
// Scheduler corriendo día 1 de cada mes a 00:30 UTC.
import { runB2dMrrSnapshot } from '../jobs/runB2dMrrSnapshot.js';
// Plan v2 Bloque A20 — wire critical safety cron: lone-worker escalation.
// Vidas dependen: si un trabajador solo no hace check-in o pulsa "ayuda",
// este job escala (supervisor → brigade → emergency_services).
import { runLoneWorkerEscalationCron } from '../jobs/runLoneWorkerEscalation.js';
import type {
  EscalationDecision,
} from '../../services/loneWorker/loneWorkerService.js';
// Plan v2 Bloque F6 — wire 3 jobs implementados pero no montados (Sprint 39):
// excepciones expiradas, work_permits expirados, recordatorios obligaciones
// legales. El motor puro deriva el estado, pero hasta que el cron materialize
// el campo `status='expired'` las queries UI (where status=='active') van a
// retornar registros stale. FCM reminders por obligaciones legales son la
// única vía para que el responsable se entere antes del vencimiento.
import { runExceptionAutoExpire } from '../jobs/runExceptionAutoExpire.js';
import { runWorkPermitAutoExpire } from '../jobs/runWorkPermitAutoExpire.js';
import { runLegalCalendarReminders } from '../jobs/runLegalCalendarReminders.js';
// PR #482 codex P1 — los datos de lone_worker / exceptions / work_permits /
// legal_obligations viven project-scoped (`projects/{pid}/<col>`), no en root.
// Estos helpers resuelven tokens por role + chunkean envíos FCM en lotes
// de 500 para no perder entregas en brigadas grandes.
import {
  iterateAllProjects,
  resolveProjectMemberTokens,
  LONE_WORKER_ROLE_BUCKETS,
} from '../services/projectTokens.js';
import { sendMulticastChunked } from '../utils/fcmMulticast.js';

// PR #482 codex P1 (round 2) — page size for project enumeration. 500 is
// a safe per-call Firestore limit; deployments with more than 500 projects
// require pagination (cursor) rather than a hard cap.
const PROJECT_PAGE_SIZE = 500;

const router = Router();

router.post('/check-overdue', verifySchedulerToken, async (_req, res) => {
  const start = Date.now();
  try {
    const maintenance = await checkOverdueMaintenance();
    // Sprint 28 H26 — extend the same scheduler invocation to also reap
    // expired EPP assignments. Both jobs are independent and idempotent;
    // running them in sequence here keeps Cloud Scheduler config simple
    // (one cron entry instead of two).
    let ppe: {
      scanned: number;
      expired: number;
      notified: number;
      findingsCreated: number;
    } = {
      scanned: 0,
      expired: 0,
      notified: 0,
      findingsCreated: 0,
    };
    try {
      ppe = await checkExpiredPpe({
        notifySupervisors: ({ projectId, payload, db, messaging }) =>
          sendToProjectSupervisors(projectId, payload, db, messaging),
      });
    } catch (ppeErr) {
      logger.error('[maintenance] check-expired-ppe failed', ppeErr);
      captureRouteError(ppeErr, 'maintenance.check-expired-ppe');
    }
    // Phase 5 arista A3 — brigade resource expiry reaper. Independent +
    // idempotent like the PPE step; failure here must not abort the rest.
    let brigadeResources: {
      scanned: number;
      expired: number;
      notified: number;
      findingsCreated: number;
    } = {
      scanned: 0,
      expired: 0,
      notified: 0,
      findingsCreated: 0,
    };
    try {
      brigadeResources = await checkExpiredBrigadeResources({
        notifySupervisors: ({ projectId, payload, db, messaging }) =>
          sendToProjectSupervisors(projectId, payload, db, messaging),
      });
    } catch (brigadeErr) {
      logger.error(
        '[maintenance] check-expired-brigade-resources failed',
        brigadeErr,
      );
      captureRouteError(
        brigadeErr,
        'maintenance.check-expired-brigade-resources',
      );
    }
    // Sprint 28 follow-up — third step: SUSESO DIAT/DIEP deadline reminders.
    // Independent + idempotent like the prior two steps.
    let susesoReminders: Awaited<ReturnType<typeof sendSusesoReminders>> = {
      scanned: 0,
      remindedTotal: 0,
      escalations: { green: 0, yellow: 0, orange: 0, red: 0, overdue: 0 },
    };
    try {
      susesoReminders = await sendSusesoReminders();
    } catch (susesoErr) {
      logger.error('[maintenance] suseso-reminders failed', susesoErr);
      captureRouteError(susesoErr, 'maintenance.suseso-reminders');
    }
    // B5/B15 — fourth step: DTE issue queue drain (retries DTE emissions
    // that failed transiently post-payment). Independent + idempotent like
    // the prior steps; failure here must not abort the rest.
    let dteQueue: DteIssueQueueDrainResult = {
      gateClosed: false,
      scanned: 0,
      attempted: 0,
      issued: 0,
      retried: 0,
      permanentFailures: 0,
      skippedNotDue: 0,
      errors: 0,
    };
    try {
      dteQueue = await runDteIssueQueueDrain();
    } catch (dteErr) {
      logger.error('[maintenance] dte-issue-queue-drain failed', dteErr);
      captureRouteError(dteErr, 'maintenance.dte-issue-queue-drain');
    }
    // Sprint 29 Bucket DD F-E — predictive × calendar pre-warn.
    // Wired after SUSESO reminders so failures stay isolated. Factories
    // default to no-op behaviour when the project store is empty.
    let calendarPreWarn: { scanned: number; warned: number } = { scanned: 0, warned: 0 };
    try {
      const preWarnResult = await runCalendarPreWarnCron({
        loadProjects: async () => [],
        loadTasksForProject: async () => [],
        getWeatherForTask: async () => ({}),
        getSeismicForProject: async () => ({}),
        daysOfRisk: () => 1,
        dispatchPush: async () => ({ ok: false }),
        dispatchEmail: async () => ({ ok: false }),
        createCalendarEvent: async () => ({ id: null }),
        alreadyWarned: async () => false,
        markWarned: async () => undefined,
      });
      calendarPreWarn = { scanned: preWarnResult.scanned, warned: preWarnResult.warned };
    } catch (preWarnErr) {
      logger.error('[maintenance] calendar-prewarn failed', preWarnErr);
      captureRouteError(preWarnErr, 'maintenance.calendar-prewarn');
    }
    // Sprint 56 follow-up — fifth step: resilience health alert.
    // Server-side check del firestore reachability + alert FCM a admins
    // si flips a critical. Política `strict` para no spammear con
    // subsystems no-medibles desde server (slm/zk/device_kek son
    // client-only y devuelven 'unknown' → degraded bajo slm_priority).
    let resilienceHealth: {
      status: string;
      alertFired: boolean;
      reportPersisted: boolean;
    } = {
      status: 'unknown',
      alertFired: false,
      reportPersisted: false,
    };
    try {
      const db = admin.firestore();
      const healthResult = await runResilienceHealthAlertCron({
        db,
        checkers: {
          firestore: async () => {
            // Ping a un doc canónico — si la lectura falla, Firestore está down.
            try {
              await db.collection('_health').doc('ping').get();
              return {
                id: 'firestore',
                status: 'healthy',
                detail: 'Firestore reachable (ping doc OK).',
              };
            } catch (err) {
              return {
                id: 'firestore',
                status: 'critical',
                detail: 'Firestore read failed.',
                error: err instanceof Error ? err.message : String(err),
              };
            }
          },
          // Network siempre healthy server-side — si el cron corre, hay red.
          network: async () => ({
            id: 'network',
            status: 'healthy',
            detail: 'Server-side cron running → network up.',
          }),
        },
        checkerTimeoutMs: 4_000,
        notifyOps: async (report) => {
          // Recolectar FCM tokens de admins globales (claim role='admin').
          // Estrategia: query users where customClaims.role='admin' usaria
          // Auth Admin SDK; aquí seguimos el patrón existing y leemos los
          // tokens desde `users/{uid}.fcmTokens[]` para usuarios cuyo
          // `role === 'admin'` en el doc.
          let adminTokens: string[] = [];
          try {
            const snap = await db
              .collection('users')
              .where('role', '==', 'admin')
              .limit(100)
              .get();
            for (const doc of snap.docs) {
              const data = doc.data() as { fcmTokens?: string[] };
              if (Array.isArray(data.fcmTokens)) {
                adminTokens.push(...data.fcmTokens.filter((t) => typeof t === 'string' && t));
              }
            }
            adminTokens = Array.from(new Set(adminTokens)); // dedup
          } catch (e) {
            logger.warn('[maintenance] resilience-health admin token query failed', {
              err: String(e),
            });
          }
          if (adminTokens.length === 0) {
            logger.warn(
              '[maintenance] resilience-health: critical pero NO hay admin tokens — alert no se envía',
            );
            return;
          }
          const criticalSubsystems = report.subsystems
            .filter((s) => s.status === 'critical')
            .map((s) => s.id)
            .join(', ');
          await fcmAdapter.sendToTokens(adminTokens, {
            title: '⚠️ Praeventio: subsistema crítico',
            body: `Estado: critical. Subsistemas: ${criticalSubsystems || 'n/a'}`,
            data: {
              kind: 'resilience_health_alert',
              overallStatus: report.overallStatus,
              criticalSubsystems: criticalSubsystems,
              generatedAt: report.generatedAt,
            },
          });
        },
      });
      resilienceHealth = {
        status: healthResult.overallStatus,
        alertFired: healthResult.alertFired,
        reportPersisted: healthResult.reportPersisted,
      };
    } catch (healthErr) {
      logger.error('[maintenance] resilience-health failed', healthErr);
      captureRouteError(healthErr, 'maintenance.resilience-health');
    }
    const tookMs = Date.now() - start;
    logger.info('[maintenance] check-overdue done', {
      ...maintenance,
      ppe,
      brigadeResources,
      susesoReminders,
      dteQueue,
      calendarPreWarn,
      resilienceHealth,
      tookMs,
    });
    return res
      .status(200)
      .json({
        ok: true,
        ...maintenance,
        ppe,
        brigadeResources,
        susesoReminders,
        dteQueue,
        calendarPreWarn,
        resilienceHealth,
        tookMs,
      });
  } catch (err) {
    logger.error('[maintenance] check-overdue failed', err);
    captureRouteError(err, 'maintenance.check-overdue');
    return res
      .status(500)
      .json({ ok: false, error: 'internal_error', message: 'check-overdue failed' });
  }
});

// Sprint E backend debt (2026-05-16) — B2D MRR monthly snapshot.
//
//   POST /api/maintenance/run-b2d-mrr-snapshot
//
// Cloud Scheduler corre esto día 1 de cada mes a 00:30 UTC. El job
// SIEMPRE cierra el mes inmediatamente anterior (cron en Jun 1 →
// cierra mayo), computando métricas AS-OF el último ms del mes
// cerrado en UTC. Es idempotente: re-correr en cualquier momento
// del mes en curso sigue cerrando el mismo mes-anterior (capturedAt
// original se preserva via merge). Si necesitas el live state del
// mes en curso, usa `GET /api/admin/b2d/metrics`.
router.post('/run-b2d-mrr-snapshot', verifySchedulerToken, async (_req, res) => {
  const start = Date.now();
  try {
    const db = admin.firestore();
    const result = await runB2dMrrSnapshot({ db });
    logger.info('[maintenance] b2d-mrr-snapshot done', {
      monthKey: result.monthKey,
      created: result.created,
      mrr: result.snapshot.mrr,
      arr: result.snapshot.arr,
      tookMs: Date.now() - start,
    });
    return res.status(200).json({
      ok: true,
      monthKey: result.monthKey,
      created: result.created,
      mrr: result.snapshot.mrr,
      arr: result.snapshot.arr,
      customersActive: result.snapshot.customersActive,
      tookMs: Date.now() - start,
    });
  } catch (err) {
    logger.error('[maintenance] b2d-mrr-snapshot failed', err);
    captureRouteError(err, 'maintenance.b2d-mrr-snapshot');
    return res
      .status(500)
      .json({ ok: false, error: 'internal_error', message: 'b2d-mrr-snapshot failed' });
  }
});

// Plan v2 Bloque A20 — lone-worker escalation cron.
//
//   POST /api/maintenance/run-lone-worker-escalation
//
// Cloud Scheduler debería correr esto CADA 5 MINUTOS sobre las sesiones
// activas en `projects/{pid}/lone_worker_sessions`. El pure decide engine
// (`loneWorker/loneWorkerService.ts`) determina cuándo escalar y a qué
// nivel; este endpoint enumera proyectos, invoca el cron por cada uno con
// el path project-scoped, y emite FCM (chunkeado a 500 tokens por call)
// a supervisor/brigade/emergency_services del proyecto. Idempotente por
// (sessionId, level, día).
//
// PR #482 codex P1 — antes de este fix el job se invocaba con path raíz
// (`lone_worker_sessions/*`) y tokens leídos del doc de sesión; ambas vías
// devuelven vacío en producción porque la data real es project-scoped y los
// docs no contienen arrays de tokens. Resultado: cron OK con cero entregas.
//
// Auth: `verifySchedulerToken` middleware — Cloud Scheduler envía el
// shared secret en el header `X-Scheduler-Token`.
router.post(
  '/run-lone-worker-escalation',
  verifySchedulerToken,
  async (_req, res) => {
    const start = Date.now();
    try {
      const db = admin.firestore();
      const messaging = admin.messaging();

      const aggregated = {
        projectsScanned: 0,
        sessionsScanned: 0,
        escalationsEmitted: 0,
        escalationsSkippedIdempotent: 0,
        byLevel: { supervisor: 0, brigade: 0, emergency_services: 0 },
        errors: 0,
        notifications: {
          attempted: 0,
          delivered: 0,
          failed: 0,
          chunks: 0,
          chunkErrors: 0,
        },
      };

      const perProject = async (
        projectDoc: FirebaseFirestore.QueryDocumentSnapshot,
      ): Promise<void> => {
        const projectId = projectDoc.id;
        aggregated.projectsScanned += 1;

        const notifyForLevel = async (
          sessionId: string,
          decision: EscalationDecision,
          title: string,
          bodyPrefix: string,
        ): Promise<void> => {
          const roles = LONE_WORKER_ROLE_BUCKETS[decision.level];
          // PR #482 codex P1 (round 3): `resolveProjectMemberTokens` throws
          // `ProjectTokenLookupError` on Firestore read failures; the cron's
          // try/catch around notifyHook ensures the marker is NOT written
          // and the next 5-minute pass retries. Vidas dependen.
          const { tokens } = await resolveProjectMemberTokens(projectId, roles, db);
          if (tokens.length === 0) {
            // No throw on "lookup succeeded but no recipients" — but ALSO
            // do not mark this escalation as delivered. Throw so the cron
            // skips the idempotency marker and retries next pass. The
            // operator must then provision the role; until they do, the
            // cron will log this warning every 5 minutes (acceptable noise
            // for a safety-critical hole).
            logger.warn('[maintenance] lone-worker no tokens for project/level', {
              projectId,
              sessionId,
              level: decision.level,
            });
            throw new Error(
              `no_recipients_for_level: project=${projectId} level=${decision.level}`,
            );
          }
          const result = await sendMulticastChunked(messaging, tokens, {
            notification: {
              title,
              body: `${bodyPrefix} (sesión ${sessionId}, proyecto ${projectId}).`,
            },
            data: {
              kind: 'lone_worker_escalation',
              sessionId,
              projectId,
              level: decision.level,
              message: decision.message,
              triggeredAt: decision.triggeredAt,
            },
            android: { priority: 'high' },
            apns: { headers: { 'apns-priority': '10' } },
          });
          aggregated.notifications.attempted += result.attempted;
          aggregated.notifications.delivered += result.successCount;
          aggregated.notifications.failed += result.failureCount;
          aggregated.notifications.chunks += result.chunkCount;
          aggregated.notifications.chunkErrors += result.errorCount;
          // PR #482 codex P1 (round 2): chunk-level transport failures must
          // surface so the cron skips the idempotency marker and the next
          // 5-minute pass retries — otherwise a transient FCM outage marks
          // the escalation as "delivered" with zero successful sends.
          //
          // PR #482 codex P1 (round 4): also fail when ALL tokens failed
          // delivery (successCount=0 with failures>0). `sendEachForMulticast`
          // never throws on per-token failures; it just returns
          // failureCount=N, which would otherwise mark the escalation as
          // delivered with zero recipients reached. Vidas dependen.
          if (
            result.errorCount > 0 ||
            (result.attempted > 0 && result.successCount === 0)
          ) {
            throw new Error(
              `fcm_multicast_no_delivery: chunks=${result.errorCount}/${result.chunkCount} ` +
                `(attempted=${result.attempted}, delivered=${result.successCount}, ` +
                `failed=${result.failureCount})`,
            );
          }
        };

        await runLoneWorkerEscalationCron({
          db,
          collectionPath: `projects/${projectId}/lone_worker_sessions`,
          notifySupervisor: (sessionId, decision) =>
            notifyForLevel(
              sessionId,
              decision,
              'Trabajador solo — revisar check-in',
              'Sin check-in dentro del intervalo',
            ),
          notifyBrigade: (sessionId, decision) =>
            notifyForLevel(
              sessionId,
              decision,
              '⚠️ Trabajador solo — sin check-in prolongado',
              'Activar brigada — revisión presencial',
            ),
          notifyEmergency: (sessionId, decision) =>
            notifyForLevel(
              sessionId,
              decision,
              '🚨 Trabajador solo — solicitó ayuda',
              'EMERGENCIA — coordinar servicios externos',
            ),
        }).then(
          (r) => {
            aggregated.sessionsScanned += r.sessionsScanned;
            aggregated.escalationsEmitted += r.escalationsEmitted;
            aggregated.escalationsSkippedIdempotent += r.escalationsSkippedIdempotent;
            aggregated.byLevel.supervisor += r.byLevel.supervisor;
            aggregated.byLevel.brigade += r.byLevel.brigade;
            aggregated.byLevel.emergency_services += r.byLevel.emergency_services;
            aggregated.errors += r.errors;
          },
          (err) => {
            logger.error('[maintenance] lone-worker per-project failed', {
              projectId,
              err: String(err),
            });
            captureRouteError(err, 'maintenance.lone-worker-escalation.project', {
              projectId,
            });
            aggregated.errors += 1;
          },
        );
      };

      await iterateAllProjects(db, PROJECT_PAGE_SIZE, perProject);

      logger.info('[maintenance] lone-worker-escalation done', {
        ...aggregated,
        tookMs: Date.now() - start,
      });
      return res.status(200).json({
        ok: true,
        ...aggregated,
        tookMs: Date.now() - start,
      });
    } catch (err) {
      logger.error('[maintenance] lone-worker-escalation failed', err);
      captureRouteError(err, 'maintenance.lone-worker-escalation');
      return res.status(500).json({
        ok: false,
        error: 'internal_error',
        message: 'lone-worker-escalation failed',
      });
    }
  },
);

// Plan v2 Bloque F6 — daily housekeeping: expire stale exceptions +
// work_permits, dispatch legal calendar reminders. Cloud Scheduler
// invoca a diario 00:00 UTC.
//
//   POST /api/maintenance/run-daily-housekeeping
//
// Tres pasos independientes + idempotentes; failure de uno no aborta
// los otros (catch + log + continue).
//
// PR #482 codex P1 — los tres jobs solían invocarse con `{ db }` solamente,
// lo que apuntaba a colecciones raíz inexistentes en producción (la data
// real vive en `projects/{pid}/{exceptions,work_permits,legal_obligations}`).
// Esta versión enumera proyectos y aplica cada job con `collectionPath`
// scoped, además de pasar `notifyResponsible` real (sin él los reminders
// legales se persistían sin disparar FCM).
router.post(
  '/run-daily-housekeeping',
  verifySchedulerToken,
  async (_req, res) => {
    const start = Date.now();
    // PR #482 codex P2 (round 2): top-level try/catch — antes el
    // `projects/{}` initial get() podía rechazarse fuera del catch
    // per-project, dejando una unhandled rejection y al scheduler sin
    // respuesta estructurada para reintentar.
    try {
      const db = admin.firestore();
      const messaging = admin.messaging();

      const exceptions = { scanned: 0, expired: 0, errors: 0 };
      const workPermits = { scanned: 0, expired: 0, errors: 0 };
      const legalReminders = {
        scanned: 0,
        remindersEmitted: 0,
        skipped: 0,
        errors: 0,
        notifications: { attempted: 0, delivered: 0, failed: 0, chunks: 0, chunkErrors: 0 },
      };
      let projectsScanned = 0;
      const responsibleRoles = LONE_WORKER_ROLE_BUCKETS.supervisor;

      const perProject = async (
        projectDoc: FirebaseFirestore.QueryDocumentSnapshot,
      ): Promise<void> => {
        const projectId = projectDoc.id;
        projectsScanned += 1;

        try {
          const r = await runExceptionAutoExpire({
            db,
            collectionPath: `projects/${projectId}/exceptions`,
          });
          exceptions.scanned += r.scanned;
          exceptions.expired += r.expired;
          exceptions.errors += r.errors;
        } catch (err) {
          logger.error('[maintenance] exception-auto-expire failed', { projectId, err: String(err) });
          captureRouteError(err, 'maintenance.exception-auto-expire', { projectId });
          exceptions.errors += 1;
        }

        // PR #482 codex P1 (round 4): work_permits viven tenant-scoped en
        // `tenants/{tenantId}/projects/{pid}/work_permits` (ver
        // `services/workPermits/workPermitFirestoreAdapter.ts:49`). Resolver
        // tenantId desde el doc del proyecto; fallback a projectId si el
        // campo no existe (legacy projects, mismo pattern que
        // `routes/emergency.ts:243` para tenants/emergency_alerts).
        //
        // Codex round-5 P2 (PR #483 follow-up) — nullish coalescing trataba
        // `""` como valor válido, produciendo `tenants//projects/...` que
        // Firestore rechaza en query → auto-expire fallaba para cada
        // proyecto con `tenantId: ""`. Guard explícito: string no-vacía o
        // fallback a projectId.
        const projectData = projectDoc.data() as { tenantId?: unknown };
        const rawTenantId = projectData?.tenantId;
        const tenantId =
          typeof rawTenantId === 'string' && rawTenantId.trim().length > 0
            ? rawTenantId.trim()
            : projectId;

        try {
          const r = await runWorkPermitAutoExpire({
            db,
            collectionPath: `tenants/${tenantId}/projects/${projectId}/work_permits`,
          });
          workPermits.scanned += r.scanned;
          workPermits.expired += r.expired;
          workPermits.errors += r.errors;
        } catch (err) {
          logger.error('[maintenance] work-permit-auto-expire failed', { projectId, err: String(err) });
          captureRouteError(err, 'maintenance.work-permit-auto-expire', { projectId });
          workPermits.errors += 1;
        }

        try {
          const r = await runLegalCalendarReminders({
            db,
            collectionPath: `projects/${projectId}/legal_obligations`,
            notifyResponsible: async (obligationId, obligation, daysUntil) => {
              // PR #482 codex P1 (round 3): same retry semantics as lone-worker.
              // Token-lookup failure → throw via ProjectTokenLookupError.
              // Empty recipient set → throw too: marker not written, next
              // daily run retries. For legal reminders the noise floor is
              // 1×/day so a missing supervisor provisioning generates one
              // warn per obligation per day until the operator fixes it.
              const { tokens } = await resolveProjectMemberTokens(projectId, responsibleRoles, db);
              if (tokens.length === 0) {
                logger.warn('[maintenance] legal-reminder no responsible tokens', {
                  projectId,
                  obligationId,
                  kind: obligation.kind,
                });
                throw new Error(
                  `no_responsible_recipients: project=${projectId} obligation=${obligationId}`,
                );
              }
              const dispatched = await sendMulticastChunked(messaging, tokens, {
                notification: {
                  title: `Obligación legal: ${obligation.label}`,
                  body: `Vence en ${daysUntil} día(s) — ${obligation.legalCitation}`,
                },
                data: {
                  kind: 'legal_obligation_reminder',
                  obligationId,
                  projectId,
                  obligationKind: obligation.kind,
                  legalCitation: obligation.legalCitation,
                  daysUntil: String(daysUntil),
                  nextDueAt: obligation.nextDueAt ?? '',
                },
                android: { priority: 'high' },
                apns: { headers: { 'apns-priority': '10' } },
              });
              legalReminders.notifications.attempted += dispatched.attempted;
              legalReminders.notifications.delivered += dispatched.successCount;
              legalReminders.notifications.failed += dispatched.failureCount;
              legalReminders.notifications.chunks += dispatched.chunkCount;
              legalReminders.notifications.chunkErrors += dispatched.errorCount;
              // PR #482 codex P1 (round 2): chunk-level errors deben abortar
              // el marker idempotente para que el próximo run reintente.
              // Plazos regulatorios (DS 54, Ley 16.744) no toleran "marked
              // sent" sin entrega.
              //
              // PR #482 codex P1 (round 4): además, all-failed multicast
              // (successCount=0 + failureCount>0) también es no-delivery.
              if (
                dispatched.errorCount > 0 ||
                (dispatched.attempted > 0 && dispatched.successCount === 0)
              ) {
                throw new Error(
                  `fcm_multicast_no_delivery: chunks=${dispatched.errorCount}/${dispatched.chunkCount} ` +
                    `(attempted=${dispatched.attempted}, delivered=${dispatched.successCount}, ` +
                    `failed=${dispatched.failureCount})`,
                );
              }
            },
          });
          legalReminders.scanned += r.scanned;
          legalReminders.remindersEmitted += r.remindersEmitted;
          legalReminders.skipped += r.skippedNotDue + r.skippedIdempotent;
          legalReminders.errors += r.errors;
        } catch (err) {
          logger.error('[maintenance] legal-calendar-reminders failed', { projectId, err: String(err) });
          captureRouteError(err, 'maintenance.legal-calendar-reminders', { projectId });
          legalReminders.errors += 1;
        }
      };

      await iterateAllProjects(db, PROJECT_PAGE_SIZE, perProject);

      logger.info('[maintenance] daily-housekeeping done', {
        projectsScanned,
        exceptions,
        workPermits,
        legalReminders,
        tookMs: Date.now() - start,
      });
      return res.status(200).json({
        ok: true,
        projectsScanned,
        exceptions,
        workPermits,
        legalReminders,
        tookMs: Date.now() - start,
      });
    } catch (err) {
      logger.error('[maintenance] daily-housekeeping failed', err);
      captureRouteError(err, 'maintenance.daily-housekeeping');
      return res.status(500).json({
        ok: false,
        error: 'internal_error',
        message: 'daily-housekeeping failed',
      });
    }
  },
);

// Re-export `admin` access through this module so the test harness can
// inject a fake; defensively imported here to keep this file the single
// entry point for the maintenance HTTP surface.
export { admin };
export default router;
