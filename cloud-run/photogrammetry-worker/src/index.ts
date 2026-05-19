// SPDX-License-Identifier: MIT
//
// Sprint 38 — Brecha C (photogrammetry pipeline auto). Cloud Run worker.
//
// HTTP shape (matches what `src/services/digitalTwin/photogrammetry/colmapAdapter.ts`
// expects, so the existing adapter can target this image without code change):
//
//   GET  /health                        -> 200 { ok: true }
//   POST /process                       -> 202 { jobId, status: 'queued' }
//          body: { projectId, jobId, imageUrls?: string[], videoUrl?: string, outputBucket, tenantId? }
//   GET  /jobs/:jobId                   -> 200 { jobId, status, meshUri?, errorMessage? }
//
// The worker:
//   1. Pulls input images or a video from `gs://bucket/path...`.
//      Videos are converted to frames with ffmpeg before COLMAP.
//   2. Runs COLMAP automatic_reconstructor on the staged folder
//      (sparse + dense; CPU-only — slower than GPU but free).
//   3. Uploads the resulting `meshed-poisson.ply` (or `.glb` if conversion is
//      added later) back to `outputBucket`.
//   4. Updates Firestore at
//        tenants/{tenantId}/photogrammetry_jobs/{jobId}
//      with status transitions queued → running → completed | failed.
//
// Auth: Cloud Run is invoked from a Cloud Tasks queue with an OIDC token
// minted from the trigger endpoint's service account. The worker validates
// the bearer token via the standard Cloud Run signature when
// `INVOKER_AUDIENCE` is set, otherwise it accepts a shared bearer for local
// docker testing (`PHOTOGRAMMETRY_WORKER_TOKEN`).
//
// IMPORTANT: this is a self-contained worker — it does NOT import from the
// main repo. The repo's tsconfig must NOT include this directory.

import express, { type Request, type Response } from 'express';
import { Storage } from '@google-cloud/storage';
import * as admin from 'firebase-admin';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8080);
const SHARED_TOKEN = process.env.PHOTOGRAMMETRY_WORKER_TOKEN;
const COLMAP_BIN = process.env.COLMAP_BIN ?? 'colmap';
const WORK_DIR = process.env.COLMAP_WORK_DIR ?? path.join(os.tmpdir(), 'colmap');

/**
 * Auth posture. The worker accepts requests in two modes — at least ONE
 * must be configured at boot; otherwise we fail fast instead of running
 * with the historical "accept any non-empty bearer" footgun (B2 fix,
 * 2026-05-19).
 *
 *   • SHARED_TOKEN  — set `PHOTOGRAMMETRY_WORKER_TOKEN` env var. The
 *                     caller must send exactly that token. Use for local
 *                     `docker run` smoke-tests and CI.
 *
 *   • OIDC          — set `INVOKER_AUDIENCE` env var (e.g. the worker's
 *                     own Cloud Run URL). The Cloud Run platform MUST be
 *                     deployed with `--no-allow-unauthenticated` so it
 *                     validates the OIDC JWT signature + audience claim
 *                     before forwarding the request to this container.
 *                     If you flip `--allow-unauthenticated` the worker
 *                     is exposed; reject the deploy.
 *
 * Both can be enabled simultaneously (e.g. shared token for local dev,
 * OIDC in prod) — any single match passes.
 */
const INVOKER_AUDIENCE = process.env.INVOKER_AUDIENCE;
const WORKER_AUTH_DISABLED_FOR_TESTS = process.env.WORKER_AUTH_DISABLED_FOR_TESTS === 'true';

if (!WORKER_AUTH_DISABLED_FOR_TESTS && !SHARED_TOKEN && !INVOKER_AUDIENCE) {
  // Fail-fast at module load so a misconfigured deploy crashes the container
  // boot rather than silently accepting any bearer. See B2 audit 2026-05-19.
  throw new Error(
    'photogrammetry-worker: neither PHOTOGRAMMETRY_WORKER_TOKEN nor INVOKER_AUDIENCE is set. ' +
    'Refusing to start with auth disabled. Set at least one (and remember to deploy with ' +
    '--no-allow-unauthenticated when relying on INVOKER_AUDIENCE).',
  );
}

// Lazy admin init — Cloud Run injects credentials via metadata server.
if (!admin.apps.length) {
  admin.initializeApp();
}
const storage = new Storage();
const db = admin.firestore();

interface ProcessRequest {
  projectId: string;
  jobId: string;
  imageUrls?: string[];
  videoUrl?: string;
  outputBucket: string;
  tenantId?: string;
}

const app = express();
app.use(express.json({ limit: '2mb' }));

// -----------------------------------------------------------------------------
// /health
// -----------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'photogrammetry-worker', version: '0.1.0' });
});

// -----------------------------------------------------------------------------
// Auth middleware. Accepts ONE of:
//   • Bearer <PHOTOGRAMMETRY_WORKER_TOKEN>  (strict equality against env var)
//   • Cloud Run OIDC token, when INVOKER_AUDIENCE is configured AND the
//     service is deployed with `--no-allow-unauthenticated` (Cloud Run then
//     validates the JWT signature + audience claim at the platform layer
//     before forwarding to this container).
//
// IMPORTANT (B2 fix, 2026-05-19): the prior implementation accepted ANY
// non-empty bearer token as "OIDC" — a wide-open backdoor if the service
// was ever deployed without `--no-allow-unauthenticated`. We now require
// either a strict shared-token match OR a configured audience, never both
// optional.
// -----------------------------------------------------------------------------
function checkAuth(req: Request, res: Response): boolean {
  if (WORKER_AUTH_DISABLED_FOR_TESTS) return true;

  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  const token = auth.slice('Bearer '.length).trim();
  if (token.length === 0) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }

  // Path 1: shared-token strict match.
  if (SHARED_TOKEN && token === SHARED_TOKEN) return true;

  // Path 2: OIDC. We rely on Cloud Run's platform-level enforcement here —
  // when INVOKER_AUDIENCE is set the operator has accepted the contract
  // that the service is deployed with `--no-allow-unauthenticated`. We
  // additionally enforce that the token LOOKS like a JWT (three base64url
  // segments separated by dots) so a stray non-empty string can't slip
  // through the way it used to.
  if (INVOKER_AUDIENCE && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return true;
  }

  res.status(401).json({ error: 'unauthorized' });
  return false;
}

// -----------------------------------------------------------------------------
// POST /process — kicks off a job. Returns 202 immediately and runs COLMAP
// asynchronously; the parent app polls Firestore (or GET /jobs/:id) for status.
// -----------------------------------------------------------------------------
app.post('/process', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;

  const body = req.body as Partial<ProcessRequest>;
  if (
    !body.projectId ||
    !body.jobId ||
    (!body.videoUrl && (!Array.isArray(body.imageUrls) || body.imageUrls.length === 0)) ||
    !body.outputBucket
  ) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const tenantId = body.tenantId ?? body.projectId;
  const jobRef = db
    .collection('tenants')
    .doc(tenantId)
    .collection('photogrammetry_jobs')
    .doc(body.jobId);

  // Best-effort transition to `running`. If Firestore is misconfigured this
  // still returns 202 — the orchestrator's status poll will surface the failure.
  await jobRef
    .set(
      {
        status: 'running',
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        engine: 'colmap',
      },
      { merge: true },
    )
    .catch((err) => console.error('[worker] firestore set running failed', err));

  res.status(202).json({ jobId: body.jobId, status: 'running' });

  // Fire-and-forget pipeline.
  void runPipeline(body as ProcessRequest, tenantId).catch(async (err) => {
    console.error('[worker] pipeline failed', err);
    await jobRef
      .set(
        {
          status: 'failed',
          errorMessage: String((err as Error).message ?? err).slice(0, 500),
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .catch(() => {});
  });
});

// -----------------------------------------------------------------------------
// GET /jobs/:jobId — surfaces Firestore state. Cloud Run does not have local
// memory across instances, so the job state must live in Firestore anyway.
// -----------------------------------------------------------------------------
app.get('/jobs/:jobId', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  const tenantId = (req.query.tenantId as string) ?? '';
  if (!tenantId) {
    return res.status(400).json({ error: 'missing_tenantId' });
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
    errorMessage: data.errorMessage ?? null,
    createdAt: data.createdAt?.toMillis?.() ?? null,
    completedAt: data.completedAt?.toMillis?.() ?? null,
  });
});

// -----------------------------------------------------------------------------
// Pipeline implementation. Wired separately so it can be unit-tested without
// Express. Throws on failure; the caller handles status updates.
// -----------------------------------------------------------------------------
async function runPipeline(req: ProcessRequest, tenantId: string): Promise<void> {
  const jobRef = db
    .collection('tenants')
    .doc(tenantId)
    .collection('photogrammetry_jobs')
    .doc(req.jobId);

  const workspaceId = `${req.jobId}-${crypto.randomBytes(4).toString('hex')}`;
  const workDir = path.join(WORK_DIR, workspaceId);
  const imagesDir = path.join(workDir, 'images');
  await fs.mkdir(imagesDir, { recursive: true });

  // 1. Stage images. If the app submits a video, extract frames first.
  // Codex P2 (PR #88): track `framesExtracted` so the orchestrator can
  // surface it in `metrics` on the job doc — useful for cost forensics
  // and for the UI to show "N frames" when sourceType=video.
  let framesExtracted = 0;
  if (req.videoUrl) {
    const videoExt = path.extname(new URL(req.videoUrl, 'gs://placeholder').pathname) || '.mp4';
    const videoPath = path.join(workDir, `input${videoExt}`);
    await downloadGcsObject(req.videoUrl, videoPath);
    // Codex P2 PR #96: cap frame extraction to avoid filling /tmp on long
    // videos. 500 frames @ fps=2 ≈ 4min de video, suficiente para SLAM
    // y dentro del budget de COLMAP + disco Cloud Run.
    const VIDEO_FRAME_CAP = 500;
    await runFfmpeg([
      '-y',
      '-i',
      videoPath,
      '-vf',
      'fps=2',
      '-frames:v',
      String(VIDEO_FRAME_CAP),
      '-q:v',
      '2',
      path.join(imagesDir, 'img_%04d.jpg'),
    ]);
    const frames = await fs.readdir(imagesDir);
    framesExtracted = frames.length;
    if (frames.length < 3) {
      throw new Error(`insufficient_video_frames:${frames.length}`);
    }
    if (frames.length > VIDEO_FRAME_CAP) {
      // ffmpeg ya enforces -frames:v, defensive log
      console.warn(`framecap-exceeded:${frames.length}`);
    }
  } else {
    for (let i = 0; i < (req.imageUrls ?? []).length; i++) {
      const url = req.imageUrls![i];
      const ext = path.extname(new URL(url, 'gs://placeholder').pathname) || '.jpg';
      const dest = path.join(imagesDir, `img_${String(i).padStart(4, '0')}${ext}`);
      await downloadGcsObject(url, dest);
    }
    framesExtracted = (req.imageUrls ?? []).length;
  }

  // 2. Run COLMAP automatic_reconstructor (CPU). Equivalent CLI:
  //    colmap automatic_reconstructor --workspace_path WORK --image_path WORK/images --quality medium
  await runColmap([
    'automatic_reconstructor',
    '--workspace_path',
    workDir,
    '--image_path',
    imagesDir,
    '--quality',
    'medium',
    '--use_gpu',
    '0',
  ]);

  // 3. Locate output mesh. COLMAP writes to dense/0/meshed-poisson.ply.
  const meshPath = path.join(workDir, 'dense', '0', 'meshed-poisson.ply');
  await fs.access(meshPath);

  // 4. Upload mesh to GCS.
  const outputObject = `photogrammetry/${tenantId}/${req.projectId}/${req.jobId}.ply`;
  await storage
    .bucket(req.outputBucket)
    .upload(meshPath, { destination: outputObject, resumable: false });
  const meshUri = `gs://${req.outputBucket}/${outputObject}`;

  // 5. Mark complete. Codex P2 (PR #88): persist `metrics.framesExtracted`
  // so the GET /jobs response (and the Digital Twin UI) can show how many
  // frames actually fed COLMAP, instead of the upstream `imageCount`
  // estimate that doesn't account for ffmpeg sampling.
  await jobRef.set(
    {
      status: 'completed',
      meshUri,
      meshFormat: 'ply',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      metrics: {
        framesExtracted,
      },
    },
    { merge: true },
  );

  // 6. Best-effort cleanup. Failure is non-fatal; Cloud Run instance is short-lived.
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
}

async function downloadGcsObject(uri: string, dest: string): Promise<void> {
  if (!uri.startsWith('gs://')) {
    throw new Error(`unsupported_uri:${uri.slice(0, 20)}`);
  }
  const without = uri.slice('gs://'.length);
  const slash = without.indexOf('/');
  if (slash < 0) throw new Error(`invalid_gs_uri:${uri.slice(0, 20)}`);
  const bucket = without.slice(0, slash);
  const objectName = without.slice(slash + 1);
  await storage.bucket(bucket).file(objectName).download({ destination: dest });
}

function runColmap(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(COLMAP_BIN, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`colmap_exit_${code ?? 'unknown'}`));
    });
  });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg_exit_${code ?? 'unknown'}`));
    });
  });
}

// -----------------------------------------------------------------------------
// Boot. Skipped when imported from tests.
// -----------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[photogrammetry-worker] listening on ${PORT}`);
  });
}

export { app, runPipeline };
