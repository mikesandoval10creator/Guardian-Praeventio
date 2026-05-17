// Praeventio Guard — Sprint 33 wire W4 (2026-05-17).
//
// POST /api/incidents/report — punto canónico para reportar near-miss,
// incidente o post-mortem. Cierra el TODO histórico de
// `services/incidents/incidentRagService.ts` línea 8 ("no hay reportIncident()
// claramente identificable") y wireas los hooks de gamificación POSITIVA:
//
//   • incidentType === 'near_miss' | 'incident' → awardXp('near_miss_reported', 10, ctx)
//   • incidentType === 'post_mortem'            → awardXp('incident_post_mortem_completed', 50, ctx)
//
// Directiva del producto (positivo-only): reportar SIEMPRE suma XP — la
// cultura de seguridad se construye reforzando la observación temprana, no
// castigando al portador de malas noticias. Ver `services/gamification/
// positiveXp.ts` para la justificación type-level del chokepoint.
//
// Middleware stack:
//   verifyAuth → idempotencyKey() → validate(zodSchema) → handler
//
// uid SIEMPRE viene del token verificado (`req.user!.uid`) — nunca del body.
// El tenantId NUNCA viene del body; se resuelve desde `projects/{projectId}`
// igual que /api/emergency/sos y /api/commute (defensa contra cross-tenant
// writes).
//
// Path Firestore: `tenants/{tenantId}/projects/{projectId}/incidents/{id}`.
// El servicio interno también indexa el resumen en
// `incident_vectors/{tenantId}/items/{id}` para RAG (best-effort).

import { Router } from 'express';
import admin from 'firebase-admin';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  reportIncident,
  type ReportIncidentDeps,
  type ReportIncidentInput,
} from '../../services/incidents/incidentRagService.js';
import { awardXp } from '../../services/gamification/positiveXp.js';
import { generateEmbedding } from '../../services/ragService.js';

const router = Router();

// Per-uid rate limiter — mismo shape que commuteLimiter (30 req / 15 min).
// Reportar incidentes desde el campo NUNCA debería pasar de unos pocos
// por turno; 30 por 15min cubre operaciones legítimas + retries offline.
export const incidentsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req: Request) =>
    req.user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados reportes de incidentes. Intenta de nuevo en 15 minutos.' },
});

const reportIncidentSchema = z.object({
  projectId: z.string().min(1).max(128),
  incidentType: z.enum(['near_miss', 'incident', 'post_mortem']),
  severity: z.enum(['low', 'med', 'high', 'critical']),
  description: z.string().min(1).max(4000),
  location: z.string().max(256).optional(),
  witnesses: z.array(z.string().min(1).max(128)).max(50).optional(),
  ts: z.string().datetime().optional(),
  // Opcional — caller offline-first puede pasar un id deterministico.
  id: z.string().min(1).max(128).optional(),
});

/** Resuelve tenantId desde el project doc. Null si no existe o falta el campo. */
async function tenantIdFor(projectId: string): Promise<string | null> {
  const db = admin.firestore();
  const snap = await db.collection('projects').doc(projectId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const tid = (data as { tenantId?: unknown }).tenantId;
  return typeof tid === 'string' && tid.length > 0 ? tid : null;
}

router.post(
  '/report',
  verifyAuth,
  incidentsLimiter,
  idempotencyKey(),
  validate(reportIncidentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail: string | null = req.user!.email ?? null;
    const payload = req.validated as z.infer<typeof reportIncidentSchema>;

    const db = admin.firestore();
    try {
      await assertProjectMember(callerUid, payload.projectId, db);
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }

    const tenantId = await tenantIdFor(payload.projectId);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }

    try {
      const input: ReportIncidentInput = {
        tenantId,
        projectId: payload.projectId,
        id: payload.id,
        incidentType: payload.incidentType,
        severity: payload.severity,
        description: payload.description,
        location: payload.location,
        witnesses: payload.witnesses,
        ts: payload.ts,
      };
      const deps: ReportIncidentDeps = {
        db: db as unknown as ReportIncidentDeps['db'],
        embed: generateEmbedding,
        toVector: (vec) => admin.firestore.FieldValue.vector(vec),
        now: () => admin.firestore.FieldValue.serverTimestamp(),
        awardXp,
      };
      const result = await reportIncident(callerUid, input, deps);
      if (!result.ok) {
        logger.warn('incident_report_rejected', {
          uid: callerUid,
          projectId: payload.projectId,
          reason: result.reason,
        });
        return res.status(400).json({ error: result.reason });
      }

      // Audit log (Sprint 13 pattern — module='incidents').
      try {
        await db.collection('audit_logs').add({
          action: 'incident.reported',
          module: 'incidents',
          details: {
            incidentId: result.incidentId,
            incidentType: payload.incidentType,
            severity: payload.severity,
            indexed: result.indexed,
            xpAwarded: result.xpAwarded,
          },
          userId: callerUid,
          userEmail: callerEmail,
          projectId: payload.projectId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        });
      } catch (auditErr: any) {
        // Audit failure must NOT break the report path — log and continue.
        logger.warn('incident_audit_log_failed', {
          uid: callerUid,
          incidentId: result.incidentId,
          message: auditErr?.message,
        });
      }

      return res.json({
        success: true,
        incidentId: result.incidentId,
        path: result.path,
        xpAwarded: result.xpAwarded,
        indexed: result.indexed,
      });
    } catch (error: any) {
      logger.error('incident_report_failed', {
        uid: callerUid,
        projectId: payload.projectId,
        message: error?.message,
      });
      captureRouteError(error, 'incidents.report', {
        callerUid,
        projectId: payload.projectId,
        tenantId,
      });
      return res.status(500).json({ error: 'incident_report_failed' });
    }
  },
);

export default router;
