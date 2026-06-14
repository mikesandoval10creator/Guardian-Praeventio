// Praeventio Guard — Sprint 39 Bloque 3 wire (Plan item 3.2).
//
// REST surface en torno a `src/services/evacuation/evacuationHeadcount.ts`
// (engine puro) + `evacuationFirestoreAdapter.ts` (persistencia). Comple­
// menta `routes/evacuation.ts` (4 endpoints stateless: compute-status /
// record-scan / end-drill / build-postmortem) con la cara CRUD persistente
// que necesita `<EvacuationDashboard />`:
//
//   POST   /api/evacuation/start      — supervisor inicia drill (drill | real)
//   POST   /api/evacuation/scan-qr    — worker llega a meeting point (idempotente)
//   GET    /api/evacuation/status     — estado en vivo (safe vs missing + %)
//   POST   /api/evacuation/end        — supervisor cierra drill + retorna postmortem
//
// Middleware stack (canónico Sprint 35 audit P1 §1.3):
//   verifyAuth → idempotencyKey() → validate(zodSchema) → handler
//
// Directivas no negociables aplicadas aquí:
//   • ADR 0019 — Google ecosystem foundation: Firestore via firebase-admin,
//     NO migrations a PocketBase/Supabase. Path multi-tenant
//     `tenants/{tid}/projects/{pid}/evacuations/{drillId}` + sub-collection
//     `scans/{workerUid}` (one doc per worker → idempotencia natural).
//   • ADR 0011 — Digital Twin triple-gate: aunque este surface NO expone
//     geometría del twin, los datos de "qué workers están en faena" son
//     información sensible adyacente al twin. Por eso:
//       Gate 1 (project membership) — `assertProjectMember(uid, projectId)`.
//       Gate 2 (identity)           — verifyAuth (Firebase Auth + ID token).
//       Gate 3 (action authority)   — en `start` y `end`, validamos que
//         el caller no sea un worker rasgado: el handler exige que el
//         project doc liste al uid como `member` (gate 1 ya cubre eso).
//         En `scan-qr` el `scannedByUid` se FUERZA server-side al caller
//         (no se acepta del body) → un worker no puede ghost-scanear por
//         otro, igual que el patrón Sprint 39 en `routes/evacuation.ts`.
//   • Defensa cross-tenant: el `tenantId` NUNCA viene del body — se resuelve
//     desde `projects/{projectId}.tenantId` (mismo patrón que `incidents.ts`,
//     `visitors.ts`, `emergency.ts`).
//
// Sin Firestore writes desde el HTTP handler para el método de cómputo puro
// (`GET /status` reusa `computeStatus` del engine sobre el drill cargado).

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  computeStatus,
  recordScan,
  endDrill,
  buildPostmortem,
  type EvacuationDrill,
} from '../../services/evacuation/evacuationHeadcount.js';
import { EvacuationAdapter } from '../../services/evacuation/evacuationFirestoreAdapter.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** Resolve tenantId from `projects/{projectId}.tenantId`. Null if missing. */
async function tenantIdFor(projectId: string): Promise<string | null> {
  const db = admin.firestore();
  const snap = await db.collection('projects').doc(projectId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const tid = (data as { tenantId?: unknown }).tenantId;
  return typeof tid === 'string' && tid.length > 0 ? tid : null;
}

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

// ────────────────────────────────────────────────────────────────────────
// Action-authority (Gate 3) — drill lifecycle is a supervisor action.
// ────────────────────────────────────────────────────────────────────────
//
// Membership (`guard`) only proves the caller belongs to the project. Starting
// a drill (with an arbitrary `expectedWorkers` roster) and closing an active
// drill are supervisor-grade actions: a plain worker must NOT be able to fire
// a phantom drill or end one mid-evacuation. `evacuation_coordinator` is a real
// emergency brigade role (see `emergencyBrigade.ts`), so it is included here.
// Mirrors the `callerCanWriteBrigade` pattern in `routes/emergencyBrigade.ts`.
const EVAC_WRITE_ROLES = new Set([
  'admin',
  'prevencionista',
  'supervisor',
  'evacuation_coordinator',
]);

function callerCanManageEvac(req: import('express').Request): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.admin === true) return true;
  if (typeof u.role === 'string' && EVAC_WRITE_ROLES.has(u.role)) {
    return true;
  }
  const tenants = (u as unknown as {
    tenants?: Record<string, { role?: string }>;
  }).tenants;
  if (
    tenants &&
    typeof tenants === 'object' &&
    typeof u.tenantId === 'string'
  ) {
    const t = tenants[u.tenantId];
    if (
      t &&
      typeof t.role === 'string' &&
      EVAC_WRITE_ROLES.has(t.role)
    ) {
      return true;
    }
  }
  return false;
}

function newDrillId(): string {
  // crypto.randomUUID() returns an RFC-4122 v4 UUID (128 bits of entropy).
  // Date.now() prefix preserves sort order for log/audit scanners.
  return `drill_${Date.now()}_${randomUUID()}`;
}

// ────────────────────────────────────────────────────────────────────────
// Zod schemas
// ────────────────────────────────────────────────────────────────────────

const expectedWorkerSchema = z.object({
  uid: z.string().min(1).max(200),
  fullName: z.string().min(1).max(500),
  lastKnownLocation: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      at: z.string().min(10),
    })
    .optional(),
});

const startSchema = z.object({
  projectId: z.string().min(1).max(128),
  kind: z.enum(['drill', 'real']),
  meetingPointId: z.string().min(1).max(200),
  expectedWorkers: z.array(expectedWorkerSchema).min(1).max(50_000),
  /** Optional client-side id for offline-first retry. */
  id: z.string().min(1).max(200).optional(),
});

const scanQrSchema = z.object({
  projectId: z.string().min(1).max(128),
  drillId: z.string().min(1).max(200),
  workerUid: z.string().min(1).max(200),
  meetingPointId: z.string().min(1).max(200),
  /** Optional client clock; server falls back to its own ISO timestamp. */
  scannedAt: z.string().min(10).optional(),
});

const statusQuerySchema = z.object({
  projectId: z.string().min(1).max(128),
  drillId: z.string().min(1).max(200),
});

const endSchema = z.object({
  projectId: z.string().min(1).max(128),
  drillId: z.string().min(1).max(200),
  endedAt: z.string().min(10).optional(),
});

// ────────────────────────────────────────────────────────────────────────
// 1. POST /api/evacuation/start
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/start',
  verifyAuth,
  idempotencyKey(),
  validate(startSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const body = req.validated as z.infer<typeof startSchema>;
    if (!(await guard(callerUid, body.projectId, res))) return undefined;
    // Gate 3: starting a drill is a supervisor action. A plain project member
    // must not be able to fire a phantom drill with an arbitrary roster.
    if (!callerCanManageEvac(req)) {
      return res.status(403).json({ error: 'forbidden_role' });
    }

    const tenantId = await tenantIdFor(body.projectId);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }

    const drillId = body.id ?? newDrillId();
    const drill: EvacuationDrill = {
      id: drillId,
      projectId: body.projectId,
      kind: body.kind,
      startedAt: new Date().toISOString(),
      startedByUid: callerUid,
      meetingPointId: body.meetingPointId,
      expectedWorkers: body.expectedWorkers,
      scans: [],
    };

    try {
      const adapter = new EvacuationAdapter(
        admin.firestore() as unknown as import('../../services/evacuation/evacuationFirestoreAdapter.js').EvacuationFirestoreDb,
        tenantId,
        body.projectId,
      );
      // One active evacuation per project. The client cannot reliably dedup (its
      // active-drill lookup may have failed), so the SERVER is the authority:
      // reject a start while ANY non-ended drill exists, to prevent two
      // concurrent drills fracturing headcount/scans mid-emergency. listActive
      // filters endedAt==null with NO recency window (an old still-active drill
      // under many finished ones is still caught). A failed read throws → caught
      // below → 500 (fail-safe: do not start when unverifiable).
      const active = (await adapter.listActive())[0];
      if (active) {
        return res.status(409).json({ error: 'drill_already_active', drillId: active.id });
      }
      await adapter.startDrill(drill);
      // CLAUDE.md #3: evacuation drill lifecycle must be audited.
      await auditServerEvent(req, 'evacuation.drill.start', 'evacuation', {
        drillId: drill.id,
        projectId: body.projectId,
        kind: body.kind,
        meetingPointId: body.meetingPointId,
        expectedWorkerCount: body.expectedWorkers.length,
      }, { projectId: body.projectId });
      return res.json({ ok: true, drill });
    } catch (err) {
      logger.error?.('evacuationHeadcount.start.error', err);
      captureRouteError(err, 'evacuationHeadcount.start', { callerUid, drillId });
      return res.status(500).json({ error: 'evacuation_start_failed' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. POST /api/evacuation/scan-qr   (worker checked in to assembly point)
// ────────────────────────────────────────────────────────────────────────
//
// `scannedByUid` se fuerza al caller (no se acepta del body) → un worker
// no puede ghost-scanear por otro. Para self-scan, workerUid === callerUid;
// para supervisor-scan-on-behalf, workerUid es el target y scannedByUid
// queda como el supervisor (que sí está autenticado en Firebase Auth).

router.post(
  '/scan-qr',
  verifyAuth,
  idempotencyKey(),
  validate(scanQrSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const body = req.validated as z.infer<typeof scanQrSchema>;
    if (!(await guard(callerUid, body.projectId, res))) return undefined;
    // Gate 3 (scan authority): a worker may only mark THEMSELVES safe
    // (workerUid === callerUid). Marking ANOTHER worker safe is a supervisor
    // action and requires an elevated role — otherwise a single member could
    // forge a clean headcount for absent colleagues. The expectedWorkers
    // membership check below still applies regardless of who scans.
    if (body.workerUid !== callerUid && !callerCanManageEvac(req)) {
      return res.status(403).json({ error: 'forbidden_scan' });
    }

    const tenantId = await tenantIdFor(body.projectId);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }

    try {
      const adapter = new EvacuationAdapter(
        admin.firestore() as unknown as import('../../services/evacuation/evacuationFirestoreAdapter.js').EvacuationFirestoreDb,
        tenantId,
        body.projectId,
      );
      // Drill debe existir antes de aceptar scans.
      const existing = await adapter.getDrill(body.drillId);
      if (!existing) {
        return res.status(404).json({ error: 'drill_not_found' });
      }
      if (existing.endedAt) {
        return res.status(409).json({ error: 'drill_already_ended' });
      }
      // Worker debe estar en la lista de expectedWorkers — defensa contra
      // scans fantasma de un uid que no estaba en faena.
      const known = existing.expectedWorkers.some((w) => w.uid === body.workerUid);
      if (!known) {
        return res.status(400).json({ error: 'worker_not_in_drill' });
      }

      await adapter.addScan(body.drillId, {
        workerUid: body.workerUid,
        meetingPointId: body.meetingPointId,
        scannedByUid: callerUid,
        scannedAt: body.scannedAt,
      });

      await auditServerEvent(req, 'evacuation.scan', 'evacuation', {
        drillId: body.drillId,
        projectId: body.projectId,
        workerUid: body.workerUid,
        meetingPointId: body.meetingPointId,
        scannedByUid: callerUid,
      }, { projectId: body.projectId });

      // Devolver el drill actualizado + status calculado para UI live.
      const refreshed = await adapter.getDrill(body.drillId);
      if (!refreshed) {
        // Edge case: doc borrado entre addScan y getDrill — devolvemos
        // 500 porque NO esperamos que pase y el cliente debe re-fetch.
        return res.status(500).json({ error: 'drill_vanished_after_scan' });
      }
      const status = computeStatus(refreshed);
      return res.json({ ok: true, drill: refreshed, status });
    } catch (err) {
      logger.error?.('evacuationHeadcount.scanQr.error', err);
      captureRouteError(err, 'evacuationHeadcount.scanQr', {
        callerUid,
        drillId: body.drillId,
      });
      return res.status(500).json({ error: 'evacuation_scan_failed' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. GET /api/evacuation/status?projectId=…&drillId=…
// ────────────────────────────────────────────────────────────────────────
//
// Polling fallback para clientes que NO usan onSnapshot directo. El UI
// principal suscribe a Firestore para latencia <1s, pero este endpoint
// existe para mesh/SLM offline + tests.

router.get(
  '/status',
  verifyAuth,
  validate(statusQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, drillId } = req.validated as z.infer<typeof statusQuerySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    const tenantId = await tenantIdFor(projectId);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }

    try {
      const adapter = new EvacuationAdapter(
        admin.firestore() as unknown as import('../../services/evacuation/evacuationFirestoreAdapter.js').EvacuationFirestoreDb,
        tenantId,
        projectId,
      );
      const drill = await adapter.getDrill(drillId);
      if (!drill) {
        return res.status(404).json({ error: 'drill_not_found' });
      }
      const status = computeStatus(drill);
      return res.json({ ok: true, drill, status });
    } catch (err) {
      logger.error?.('evacuationHeadcount.status.error', err);
      captureRouteError(err, 'evacuationHeadcount.status', { callerUid, drillId });
      return res.status(500).json({ error: 'evacuation_status_failed' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. POST /api/evacuation/end  — supervisor cierra drill + postmortem
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/end',
  verifyAuth,
  idempotencyKey(),
  validate(endSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const body = req.validated as z.infer<typeof endSchema>;
    if (!(await guard(callerUid, body.projectId, res))) return undefined;
    // Gate 3: closing an active drill mid-evacuation is a supervisor action.
    if (!callerCanManageEvac(req)) {
      return res.status(403).json({ error: 'forbidden_role' });
    }

    const tenantId = await tenantIdFor(body.projectId);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }

    try {
      const adapter = new EvacuationAdapter(
        admin.firestore() as unknown as import('../../services/evacuation/evacuationFirestoreAdapter.js').EvacuationFirestoreDb,
        tenantId,
        body.projectId,
      );
      const existing = await adapter.getDrill(body.drillId);
      if (!existing) {
        return res.status(404).json({ error: 'drill_not_found' });
      }
      if (existing.endedAt) {
        // Idempotente: devolvemos el postmortem ya calculado en lugar de
        // 409. La idempotencyKey middleware ya garantiza esto para retries
        // con la misma key, pero si dos clientes distintos llaman /end en
        // paralelo (e.g. supervisor + auto-trigger por SLM), preferimos
        // que ambos vean el resultado vs uno reciba error.
        const postmortem = buildPostmortem(existing);
        return res.json({ ok: true, drill: existing, postmortem });
      }

      const endedAt = body.endedAt ?? new Date().toISOString();
      await adapter.endDrill(body.drillId, endedAt);
      const ended = endDrill(existing, endedAt);
      const postmortem = buildPostmortem(ended);
      await auditServerEvent(req, 'evacuation.drill.end', 'evacuation', {
        drillId: body.drillId,
        projectId: body.projectId,
        endedAt,
      }, { projectId: body.projectId });
      return res.json({ ok: true, drill: ended, postmortem });
    } catch (err) {
      logger.error?.('evacuationHeadcount.end.error', err);
      captureRouteError(err, 'evacuationHeadcount.end', {
        callerUid,
        drillId: body.drillId,
      });
      return res.status(500).json({ error: 'evacuation_end_failed' });
    }
  },
);

export default router;
// Touch reference to keep `recordScan` exported from engine surface — used
// by the existing `routes/evacuation.ts` and by adapter logic indirectly.
export { recordScan };
