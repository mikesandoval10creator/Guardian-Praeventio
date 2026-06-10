// SPDX-License-Identifier: MIT
// AUDIT-2026-06 A.1 — POST /api/projects/:projectId/health-check.
//
// Reintroduction of the project health-check endpoint removed in Round 14.
// The original was dropped because it was cross-tenant exploitable (no
// membership gate), but its consumer survived: ProjectHealthCheck.tsx
// (mounted in Analytics) POSTs here on demand and then renders the cached
// result from `projects/{pid}/health_checks/latest` via onSnapshot. Per the
// Round 14 removal note in server.ts, the reintroduction REQUIRES
// `assertProjectMember` — that's enforced before any read or write.
//
// Flow:
//   1. verifyAuth + assertProjectMember (403 for non-members).
//   2. Assemble projectContext (project doc + up to 20 open findings) and
//      normativeContext (country-pack regulations — real legal references,
//      jurisdiction-aware via project.country, default CL).
//   3. auditProjectComplianceWithAI (Gemini, structured JSON schema).
//   4. Cache to projects/{pid}/health_checks/latest (the component's
//      subscription path) and append the audit_logs row (rule #3).
//
// On AI failure: 502, NO cache write — a stale cached result stays
// authoritative rather than overwriting it with a fabricated one.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { auditProjectComplianceWithAI } from '../../services/gemini/operations.js';
import { getPackByCode, type CountryCode } from '../../services/normativa/countryPacks.js';

const router = Router();

const PROJECT_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

const SUPPORTED_PACKS: ReadonlySet<string> = new Set([
  'CL',
  'PE',
  'CO',
  'MX',
  'AR',
  'BR',
  'ISO',
]);

function packFor(country: unknown): ReturnType<typeof getPackByCode> {
  const code =
    typeof country === 'string' && SUPPORTED_PACKS.has(country.toUpperCase())
      ? (country.toUpperCase() as CountryCode)
      : 'CL';
  return getPackByCode(code);
}

router.post('/:projectId/health-check', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!PROJECT_ID_REGEX.test(projectId)) {
    return res.status(400).json({ error: 'Invalid projectId' });
  }

  const db = admin.firestore();
  try {
    await assertProjectMember(callerUid, projectId, db);
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      return res.status(403).json({ error: 'forbidden' });
    }
    throw err;
  }

  try {
    const projSnap = await db.collection('projects').doc(projectId).get();
    const proj = (projSnap.data() ?? {}) as Record<string, unknown>;
    const projectName = typeof proj.name === 'string' ? proj.name : projectId;

    const findingsSnap = await db
      .collection('projects')
      .doc(projectId)
      .collection('findings')
      .limit(20)
      .get();
    const findingLines = findingsSnap.docs.map((d) => {
      const f = d.data() as Record<string, unknown>;
      return `- [${f.status ?? 's/e'} | ${f.priority ?? 's/p'}] ${f.title ?? d.id}`;
    });

    const projectContext = [
      `Proyecto: ${projectName}`,
      typeof proj.type === 'string' ? `Tipo: ${proj.type}` : null,
      typeof proj.country === 'string' ? `País: ${proj.country}` : 'País: CL',
      `Hallazgos registrados (${findingLines.length}):`,
      ...(findingLines.length > 0 ? findingLines : ['- (sin hallazgos registrados)']),
    ]
      .filter((l): l is string => l !== null)
      .join('\n');

    const pack = packFor(proj.country);
    const normativeContext = [
      `Marco normativo ${pack.name} (${pack.code}):`,
      ...pack.regulations.map((r) => `- ${r.title} (${r.reference}): ${r.scope}`),
      `Umbral comité paritario: ${pack.thresholds.comiteRequiredAtWorkers} trabajadores.`,
      `Umbral depto. prevención: ${pack.thresholds.preventionDeptRequiredAtWorkers} trabajadores.`,
    ].join('\n');

    let compliance: Record<string, unknown>;
    try {
      compliance = (await auditProjectComplianceWithAI(
        projectName,
        projectContext,
        normativeContext
      )) as Record<string, unknown>;
    } catch (err) {
      logger.error('project_health_check_ai_failed', err, { projectId, callerUid });
      captureRouteError(err, 'projectHealth.ai', { projectId, callerUid });
      // 502, not 500: upstream AI dependency failed; the cached result (if
      // any) remains authoritative. Never fabricate a compliance score.
      return res.status(502).json({ error: 'AI compliance audit unavailable' });
    }

    const latestRef = db
      .collection('projects')
      .doc(projectId)
      .collection('health_checks')
      .doc('latest');
    await latestRef.set(
      {
        compliance,
        summary: typeof compliance.summary === 'string' ? compliance.summary : null,
        checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        checkedBy: callerUid,
        normativePack: pack.code,
      },
      { merge: false }
    );

    try {
      await auditServerEvent(
        req,
        'project_health_check',
        'projectHealth',
        {
          complianceScore:
            typeof compliance.complianceScore === 'number'
              ? compliance.complianceScore
              : null,
          normativePack: pack.code,
        },
        { projectId }
      );
    } catch (err) {
      // Rule #14 — audit failure is severe but must not roll back the
      // user-facing action that already succeeded.
      logger.error('audit_event_failed', err, { action: 'project_health_check' });
      captureRouteError(err, 'projectHealth.audit', { projectId, callerUid });
    }

    return res.json({ ok: true });
  } catch (error) {
    logger.error('project_health_check_failed', error, { projectId, callerUid });
    captureRouteError(error, 'projectHealth', { projectId, callerUid });
    return res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error instanceof Error
            ? error.message
            : String(error),
    });
  }
});

export default router;
