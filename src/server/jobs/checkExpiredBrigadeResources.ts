// SPDX-License-Identifier: MIT
//
// Phase 5 arista A3 (2026-06) — brigade resource expiry reaper.
//
// Brigade resources (extintores / DEA / botiquines / lavaojos / duchas /
// redes húmedas / kits antiderrame) live in
// `tenants/{tid}/projects/{pid}/emergency_brigade` (docType='resource',
// written by routes/emergencyBrigade.ts) and carry an ISO
// `nextExpirationAt` (carga / certificación). Before this job NOTHING
// reaped them server-side: an expired extinguisher only surfaced if a
// human opened the readiness report. Mirrors `checkExpiredPpe.ts` —
// for every resource whose `nextExpirationAt` has passed we:
//
//   • create a corrective-action finding in `projects/{pid}/findings`
//     with deterministic id `brigade-expiry_{resourceId}` (idempotent:
//     re-runs never duplicate, a closed finding is never reopened),
//   • stamp `expiryFindingAt` on the resource doc so the next pass
//     skips it (the resource itself keeps its inspection lifecycle —
//     re-certifying it via the inspect endpoint sets a new
//     `nextExpirationAt`; operators should clear the marker then),
//   • write an `audit_logs` row with `action: 'brigade.resource_expired'`,
//   • write a per-project `notifications` doc,
//   • best-effort FCM push to the project's supervisors.
//
// Tenant resolution mirrors routes/maintenance.ts run-daily-housekeeping:
// `projects/{pid}.tenantId` when present (non-empty string), else fall
// back to the projectId (legacy projects).
//
// Invoked from POST /api/maintenance/check-overdue alongside the other
// hourly reapers — see `routes/maintenance.ts`.

import type { Firestore } from 'firebase-admin/firestore';
import type { messaging as adminMessaging } from 'firebase-admin';
import { tracedAsync } from '../../services/observability/tracing.js';
import { logger } from '../../utils/logger.js';
import type { SupervisorNotifier } from './checkExpiredPpe.js';
import {
  ensureExpiryFinding,
  formatDateCl,
  type FindingPriority,
} from './expiryFindings.js';

/** Lazy accessors — keep firebase-admin out of import cycles. */
type FirestoreFactory = () => Firestore;
type MessagingFactory = () => adminMessaging.Messaging;

export interface CheckExpiredBrigadeResourcesOptions {
  /** Firestore handle factory. Default reads from firebase-admin. */
  getDb?: FirestoreFactory;
  /** FCM messaging factory. Default reads from firebase-admin. */
  getMessaging?: MessagingFactory;
  /** Supervisor push. Defaults to a no-op returning zero counts. */
  notifySupervisors?: SupervisorNotifier;
  /** Override of "now" for tests / replays. Default `new Date()`. */
  now?: () => Date;
  /** Page size for the project scan. Default 100. */
  projectLimit?: number;
  /** Page size for the per-project resource scan. Default 200. */
  resourceLimit?: number;
}

export interface CheckExpiredBrigadeResourcesResult {
  /** Number of resource docs scanned across all projects. */
  scanned: number;
  /** Number of resources newly detected as expired (marker stamped). */
  expired: number;
  /** Number of supervisor push deliveries successfully dispatched. */
  notified: number;
  /** Number of corrective-action findings created. */
  findingsCreated: number;
}

/** es-CL labels per resource kind (user-facing copy). */
const KIND_LABELS_CL: Record<string, string> = {
  extinguisher: 'Extintor',
  first_aid_kit: 'Botiquín',
  aed: 'DEA (desfibrilador)',
  eyewash: 'Lavaojos de emergencia',
  safety_shower: 'Ducha de seguridad',
  fire_hose: 'Red húmeda',
  spill_kit: 'Kit antiderrame',
};

// An expired extinguisher / DEA / fire hose is a failed life-safety
// control during an active emergency → 'Crítica'. The rest mitigate
// post-exposure harm → 'Alta'.
const CRITICAL_KINDS = new Set(['extinguisher', 'aed', 'fire_hose']);

function priorityForKind(kind: string): FindingPriority {
  return CRITICAL_KINDS.has(kind) ? 'Crítica' : 'Alta';
}

/**
 * Scan + reap. Returns counts so the HTTP wrapper can surface progress
 * to the operator dashboard.
 */
export async function checkExpiredBrigadeResources(
  opts: CheckExpiredBrigadeResourcesOptions = {},
): Promise<CheckExpiredBrigadeResourcesResult> {
  return tracedAsync(
    'job.check_expired_brigade_resources',
    {
      projectLimit: opts.projectLimit ?? 100,
      resourceLimit: opts.resourceLimit ?? 200,
    },
    () => checkExpiredBrigadeResourcesInner(opts),
  );
}

async function checkExpiredBrigadeResourcesInner(
  opts: CheckExpiredBrigadeResourcesOptions = {},
): Promise<CheckExpiredBrigadeResourcesResult> {
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
  const resourceLimit = opts.resourceLimit ?? 200;

  const projectsSnap = await db
    .collection('projects')
    .limit(projectLimit)
    .get();

  let scanned = 0;
  let expired = 0;
  let notified = 0;
  let findingsCreated = 0;
  const nowIso = now.toISOString();

  for (const projectDoc of projectsSnap.docs) {
    const projectId = projectDoc.id;
    // Tenant fallback mirrors routes/maintenance.ts (codex round-5 P2):
    // empty-string tenantId must NOT produce `tenants//projects/...`.
    const projectData = projectDoc.data() as { tenantId?: unknown };
    const rawTenantId = projectData?.tenantId;
    const tenantId =
      typeof rawTenantId === 'string' && rawTenantId.trim().length > 0
        ? rawTenantId.trim()
        : projectId;

    const resourcesSnap = await db
      .collection(
        `tenants/${tenantId}/projects/${projectId}/emergency_brigade`,
      )
      .where('docType', '==', 'resource')
      .limit(resourceLimit)
      .get();

    for (const resourceDoc of resourcesSnap.docs) {
      scanned += 1;
      const r = resourceDoc.data() as {
        kind?: string;
        location?: string;
        nextExpirationAt?: string | null;
        expiryFindingAt?: string;
      };

      // Defensive: only act on a string ISO date that's strictly past.
      if (!r.nextExpirationAt || typeof r.nextExpirationAt !== 'string') {
        continue;
      }
      if (r.nextExpirationAt >= nowIso) continue;
      // Idempotency marker — this expiry was already processed.
      if (typeof r.expiryFindingAt === 'string' && r.expiryFindingAt) continue;

      const kind = r.kind ?? 'extinguisher';
      const kindLabel = KIND_LABELS_CL[kind] ?? 'Recurso de emergencia';
      const locationLabel = r.location ?? 'ubicación no registrada';
      const findingId = `brigade-expiry_${resourceDoc.id}`;

      // Finding FIRST: if this write throws, the marker is not stamped
      // and the next pass retries the whole unit of work.
      const findingCreated = await ensureExpiryFinding(
        db,
        projectId,
        findingId,
        now,
        {
          title: `Recurso de emergencia vencido: ${kindLabel} — ${locationLabel}`,
          description:
            `El recurso "${kindLabel}" ubicado en ${locationLabel} tiene su ` +
            `carga/certificación vencida desde el ` +
            `${formatDateCl(r.nextExpirationAt)}. Recargar o recertificar el ` +
            `equipo y registrar la inspección en el módulo de brigada.`,
          priority: priorityForKind(kind),
          source: 'brigade_resource_expiry',
          extra: {
            resourceId: resourceDoc.id,
            resourceKind: kind,
            location: r.location ?? null,
            nextExpirationAt: r.nextExpirationAt,
          },
        },
      );
      if (findingCreated) findingsCreated += 1;

      // Stamp the marker so the next pass doesn't re-notify.
      await resourceDoc.ref.update({ expiryFindingAt: nowIso });
      expired += 1;

      // Audit row — server-stamped, no req context (mirrors ppe.expired).
      await db.collection('audit_logs').add({
        action: 'brigade.resource_expired',
        module: 'emergencyBrigade',
        details: {
          projectId,
          resourceId: resourceDoc.id,
          kind,
          location: r.location ?? null,
          nextExpirationAt: r.nextExpirationAt,
          findingId,
          findingCreated,
        },
        userId: null,
        userEmail: null,
        projectId,
        timestamp: nowIso,
      });

      // In-app notification doc (reliable channel even if push is muted).
      await db
        .collection('projects')
        .doc(projectId)
        .collection('notifications')
        .add({
          kind: 'brigade.resource_expired',
          createdAt: nowIso,
          read: false,
          title: 'Recurso de emergencia vencido',
          body: `${kindLabel} en ${locationLabel} venció el ${formatDateCl(r.nextExpirationAt)}.`,
          resourceId: resourceDoc.id,
          resourceKind: kind,
          findingId,
        });

      // Best-effort supervisor push — failures must NOT abort the scan.
      try {
        const pushResult = await notifySupervisors({
          projectId,
          payload: {
            title: 'Recurso de emergencia vencido',
            body: `${kindLabel} en ${locationLabel} venció el ${formatDateCl(r.nextExpirationAt)}. Hallazgo creado.`,
            data: {
              kind: 'brigade.resource_expired',
              resourceId: resourceDoc.id,
              findingId,
            },
          },
          db,
          messaging,
        });
        notified += pushResult.notified;
      } catch (err) {
        logger.warn('brigade_expiry.notify_failed', {
          resourceId: resourceDoc.id,
          err: String(err),
        });
      }
    }
  }

  return { scanned, expired, notified, findingsCreated };
}
