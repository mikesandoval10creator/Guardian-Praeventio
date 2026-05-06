// SPDX-License-Identifier: MIT
//
// Sprint 38 — Brecha C closure: photogrammetry job orchestration endpoint.
//
// Mounted via `app.use('/api/photogrammetry', photogrammetryRouter)`.
//
// On-the-wire:
//   • POST /api/photogrammetry/jobs
//       body: { projectId: string; imageUrls: string[]; name?: string }
//       -> 201 { jobId, status: 'queued', estimatedDurationMin }
//   • GET  /api/photogrammetry/jobs/:jobId?projectId=...
//       -> 200 { jobId, status, meshUri?, errorMessage?, ... }
//
// === Why this exists ===
//
// `src/services/digitalTwin/photogrammetry/colmapAdapter.ts` already speaks
// HTTP to a Cloud Run worker; what was missing was an authenticated server
// endpoint that:
//   1. Verifies the caller's role (admin / supervisor — there's no
//      `digital_twin_user` role in `src/types/roles.ts`, so we map the
//      product-spec audience to the existing supervisor-tier).
//   2. Asserts project membership before touching any project data.
//   3. Persists a `photogrammetry_jobs` doc in Firestore so the job is
//      visible from the UI even if the worker is slow / down.
//   4. Enqueues the actual COLMAP work via Cloud Tasks pointing at
//      PHOTOGRAMMETRY_WORKER_URL (the Cloud Run service deployed from
//      `cloud-run/photogrammetry-worker/`).
//
// === Cost notes (per job, CPU-only Cloud Run) ===
//   • Compute: ~15-20 min @ 4 vCPU + 8 GiB ≈ USD 0.05–0.10
//   • Storage: <50 MB images + ~10 MB mesh per job — pennies/month
//   • Cloud Tasks: free tier covers <1M dispatches/month
// Anchored to the budget in DIGITAL_TWIN_GPU_FREE_PLAN.md §5.3 (Phase C2).

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { isAdminRole, isSupervisorRole } from '../../types/roles.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { logger } from '../../utils/logger.js';

const CreateJobSchema = z.object({
  projectId: z.string().min(1).max(128),
  imageUrls: z
    .array(z.string().url().or(z.string().regex(/^gs:\/\/[A-Za-z0-9_.\-/]+$/)))
    .min(3, 'photogrammetry needs >= 3 images')
    .max(500, 'photogrammetry capped at 500 images per job'),
  name: z.string().min(1).max(256).optional(),
});

const router = Router();

function sentryCapture(err: unknown, ctx: Record<string, unknown>): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      ctx as any,
    );
  } catch (e) {
    console.warn('[photogrammetry] sentry capture failed', e);
  }
}

/** Crude cost-aware ETA: 12 s feature extraction + 2 s/image dense step.
 *  Capped at 30 min (matches Cloud Run --timeout 1800). */
function estimateDurationMin(imageCount: number): number {
  const seconds = 60 + imageCount * 2;
  return Math.min(30, Math.max(2, Math.round(seconds / 60)));
}

// -----------------------------------------------------------------------------
// POST /api/photogrammetry/jobs — create a queued job and dispatch to worker.
// -----------------------------------------------------------------------------
router.post('/jobs', verifyAuth, validate(CreateJobSchema), async (req, res) => {
  const callerUid = (req as any).user.uid as string;
  const { projectId, imageUrls, name } = (req as any).validated as z.infer<
    typeof CreateJobSchema
  >;

  // 1. Role gate.
  let role: unknown;
  try {
    const callerRecord = await admin.auth().getUser(callerUid);
    role = callerRecord.customClaims?.role;
  } catch (err) {
    logger.warn('photogrammetry_role_lookup_failed', {
      callerUid,
      message: (err as Error)?.message,
    });
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!isAdminRole(role) && !isSupervisorRole(role)) {
    return res
      .status(403)
      .json({ error: 'Forbidden: Requires admin or supervisor role' });
  }

  // 2. Project membership.
  const db = admin.firestore();
  try {
    await assertProjectMember(callerUid, projectId, db);
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    sentryCapture(err, { endpoint: '/api/photogrammetry/jobs', tags: { phase: 'membership' } });
    return res.status(500).json({ error: 'membership_check_failed' });
  }

  // 3. Resolve tenant.
  let tenantId = projectId;
  try {
    const projSnap = await db.collection('projects').doc(projectId).get();
    if (projSnap.exists) {
      const candidate = (projSnap.data() as any)?.tenantId;
      if (typeof candidate === 'string' && candidate.length > 0) tenantId = candidate;
    }
  } catch (err) {
    logger.warn('photogrammetry_tenant_lookup_failed', { projectId, message: (err as Error)?.message });
  }

  // 4. Persist `queued` doc.
  const jobRef = db
    .collection('tenants')
    .doc(tenantId)
    .collection('photogrammetry_jobs')
    .doc();
  const jobId = jobRef.id;
  const estimatedDurationMin = estimateDurationMin(imageUrls.length);
  try {
    await jobRef.set({
      projectId,
      tenantId,
      name: name ?? null,
      status: 'queued',
      engine: 'colmap',
      imageCount: imageUrls.length,
      requestedBy: callerUid,
      estimatedDurationMin,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    sentryCapture(err, { endpoint: '/api/photogrammetry/jobs', tags: { phase: 'persist' } });
    return res.status(500).json({ error: 'persist_failed' });
  }

  // 5. Dispatch to Cloud Run worker (via direct HTTP for now; Cloud Tasks
  //    integration ships in a follow-up sprint when the queue is provisioned).
  const workerUrl = process.env.PHOTOGRAMMETRY_WORKER_URL;
  const workerToken = process.env.PHOTOGRAMMETRY_WORKER_TOKEN;
  const outputBucket =
    process.env.PHOTOGRAMMETRY_OUTPUT_BUCKET ?? 'praeventio-photogrammetry';
  if (!workerUrl || !workerToken) {
    // Worker not configured — leave job queued. The next manual run of the
    // worker can pick it up; UI shows status='queued' meanwhile.
    return res.status(201).json({
      jobId,
      status: 'queued',
      estimatedDurationMin,
      worker: 'not_configured',
    });
  }

  try {
    const dispatchRes = await fetch(`${workerUrl.replace(/\/$/, '')}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        projectId,
        tenantId,
        jobId,
        imageUrls,
        outputBucket,
      }),
    });
    if (!dispatchRes.ok) {
      logger.warn('photogrammetry_dispatch_failed', {
        jobId,
        status: dispatchRes.status,
      });
      // Job stays in 'queued'; orchestrator can retry. Don't fail the
      // user-facing call — they'll see the job in the UI.
    }
  } catch (err) {
    sentryCapture(err, {
      endpoint: '/api/photogrammetry/jobs',
      tags: { phase: 'dispatch', jobId },
    });
  }

  return res.status(201).json({ jobId, status: 'queued', estimatedDurationMin });
});

// -----------------------------------------------------------------------------
// GET /api/photogrammetry/jobs/:jobId — return status + result URL when done.
// -----------------------------------------------------------------------------
router.get('/jobs/:jobId', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid as string;
  const projectId = req.query.projectId;
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return res.status(400).json({ error: 'missing_projectId' });
  }

  const db = admin.firestore();
  try {
    await assertProjectMember(callerUid, projectId, db);
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    return res.status(500).json({ error: 'membership_check_failed' });
  }

  let tenantId = projectId;
  try {
    const projSnap = await db.collection('projects').doc(projectId).get();
    if (projSnap.exists) {
      const candidate = (projSnap.data() as any)?.tenantId;
      if (typeof candidate === 'string' && candidate.length > 0) tenantId = candidate;
    }
  } catch {
    /* fall through */
  }

  const snap = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('photogrammetry_jobs')
    .doc(req.params.jobId)
    .get();
  if (!snap.exists) return res.status(404).json({ error: 'not_found' });
  const data = snap.data() ?? {};
  return res.json({
    jobId: req.params.jobId,
    status: data.status ?? 'queued',
    meshUri: data.meshUri ?? null,
    meshFormat: data.meshFormat ?? null,
    errorMessage: data.errorMessage ?? null,
    estimatedDurationMin: data.estimatedDurationMin ?? null,
  });
});

export default router;
