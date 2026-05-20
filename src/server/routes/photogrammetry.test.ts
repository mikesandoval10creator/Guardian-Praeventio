// SPDX-License-Identifier: MIT
//
// Sprint 38 — Brecha C tests for /api/photogrammetry/jobs.
//
// Same playbook as iot.test.ts: rebuild a minimal Express app rather than
// boot the real router (which depends on `admin.firestore()` + `admin.auth()`
// which we cannot initialize in unit tests). We exercise the contract:
//
//   1. Happy path — supervisor caller queues a job (201 + persisted doc).
//   2. Worker dispatch — fetch is called with the correct payload when env set.
//   3. Role gate — worker-tier role gets 403.
//   4. Project membership — non-member gets 403.
//
// Schema is duplicated here so the test runs without importing the route's
// firebase-admin transitive deps. The duplication is intentional and matches
// iot.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { isAdminRole, isSupervisorRole } from '../../types/roles.js';

// Mirrors src/server/routes/photogrammetry.ts (Codex P2 fix on PR #88):
// regex is relaxed to accept percent-encoded and space-containing GCS object
// names, and videoUrl is gs://-only (worker rejects HTTPS).
const GS_URI_REGEX = /^gs:\/\/[A-Za-z0-9_.-]+\/[\w\-./%+ !*'()&$,:;=@~]+$/;

const CreateJobSchema = z.object({
  projectId: z.string().min(1).max(128),
  imageUrls: z
    .array(z.string().url().or(z.string().regex(GS_URI_REGEX)))
    .min(3)
    .max(500)
    .optional(),
  videoUrl: z.string().regex(GS_URI_REGEX, 'videoUrl must be a gs:// URI').optional(),
  name: z.string().min(1).max(256).optional(),
}).refine(
  (value) => Boolean(value.videoUrl) || Boolean(value.imageUrls && value.imageUrls.length >= 3),
  { message: 'videoUrl or at least 3 imageUrls are required' },
);

interface FakeUser {
  uid: string;
  customClaims?: { role?: string };
}
interface PhotoTestDeps {
  users: Map<string, FakeUser>;
  projects: Map<string, { tenantId?: string; members: string[]; createdBy?: string }>;
  jobs: Map<string, any>;
  fetchSpy: ReturnType<typeof vi.fn>;
}

function buildApp(deps: PhotoTestDeps): Express {
  const app = express();
  app.use(express.json());

  const verifyAuth = (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const user = deps.users.get(auth.slice('Bearer '.length));
    if (!user) return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    req.user = user;
    next();
  };

  const assertMembership = (uid: string, projectId: string): void => {
    const proj = deps.projects.get(projectId);
    if (!proj) throw new Error('forbidden');
    const isMember = proj.members.includes(uid) || proj.createdBy === uid;
    if (!isMember) throw new Error('forbidden');
  };

  app.post(
    '/api/photogrammetry/jobs',
    verifyAuth,
    validate(CreateJobSchema),
    async (req: any, res: any) => {
      const callerUid = req.user.uid;
      const role = req.user.customClaims?.role;
      if (!isAdminRole(role) && !isSupervisorRole(role)) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Requires admin or supervisor role' });
      }
      const { projectId, imageUrls, videoUrl, name } = req.validated;
      try {
        assertMembership(callerUid, projectId);
      } catch {
        return res.status(403).json({ error: 'forbidden' });
      }
      const tenantId = deps.projects.get(projectId)?.tenantId ?? projectId;
      const jobId = `job-${deps.jobs.size + 1}`;
      const inputCount = imageUrls?.length ?? 90;
      const estimatedDurationMin = Math.min(30, Math.max(2, Math.round((60 + inputCount * 2) / 60)));
      deps.jobs.set(`tenants/${tenantId}/photogrammetry_jobs/${jobId}`, {
        projectId,
        tenantId,
        name: name ?? null,
        status: 'queued',
        engine: 'colmap',
        sourceType: videoUrl ? 'video' : 'images',
        imageCount: imageUrls?.length ?? null,
        videoUrl: videoUrl ?? null,
        requestedBy: callerUid,
        estimatedDurationMin,
      });

      const workerUrl = process.env.PHOTOGRAMMETRY_WORKER_URL;
      const workerToken = process.env.PHOTOGRAMMETRY_WORKER_TOKEN;
      if (workerUrl && workerToken) {
        await (deps.fetchSpy as any)(`${workerUrl.replace(/\/$/, '')}/process`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${workerToken}`,
          },
          body: JSON.stringify({
            projectId,
            tenantId,
            jobId,
            ...(videoUrl ? { videoUrl } : { imageUrls }),
            outputBucket: process.env.PHOTOGRAMMETRY_OUTPUT_BUCKET ?? 'praeventio-photogrammetry',
          }),
        });
      }

      return res
        .status(201)
        .json({ jobId, status: 'queued', estimatedDurationMin, ...(workerUrl && workerToken ? {} : { worker: 'not_configured' }) });
    },
  );

  app.get('/api/photogrammetry/jobs', verifyAuth, async (req: any, res: any) => {
    const callerUid = req.user.uid;
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) return res.status(400).json({ error: 'missing_projectId' });
    try {
      assertMembership(callerUid, projectId);
    } catch {
      return res.status(403).json({ error: 'forbidden' });
    }
    const tenantId = deps.projects.get(projectId)?.tenantId ?? projectId;
    const prefix = `tenants/${tenantId}/photogrammetry_jobs/`;
    const jobs = Array.from(deps.jobs.entries())
      .filter(([key, job]) => key.startsWith(prefix) && job.projectId === projectId)
      // Codex P2 (PR #88): mirror Firestore `.orderBy('createdAt', 'desc')`.
      .sort(([, a], [, b]) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .map(([key, job]) => ({
        jobId: key.slice(prefix.length),
        status: job.status === 'running' ? 'processing' : job.status,
        progress: job.status === 'completed' ? 100 : job.status === 'running' ? 65 : 0,
        videoUrl: job.videoUrl ?? null,
        resultUrl: job.meshUri ?? null,
        error: job.errorMessage ?? null,
        metrics: job.metrics ?? null,
      }));
    return res.json(jobs);
  });

  app.get('/api/photogrammetry/jobs/:jobId', verifyAuth, async (req: any, res: any) => {
    const callerUid = req.user.uid;
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) return res.status(400).json({ error: 'missing_projectId' });
    try {
      assertMembership(callerUid, projectId);
    } catch {
      return res.status(403).json({ error: 'forbidden' });
    }
    const tenantId = deps.projects.get(projectId)?.tenantId ?? projectId;
    const job = deps.jobs.get(`tenants/${tenantId}/photogrammetry_jobs/${req.params.jobId}`);
    if (!job) return res.status(404).json({ error: 'not_found' });
    return res.json({
      jobId: req.params.jobId,
      status: job.status,
      meshUri: job.meshUri ?? null,
      errorMessage: job.errorMessage ?? null,
      estimatedDurationMin: job.estimatedDurationMin ?? null,
    });
  });

  return app;
}

describe('/api/photogrammetry/jobs (Sprint 38 Brecha C)', () => {
  const ORIGINAL_ENV = { ...process.env };
  let deps: PhotoTestDeps;

  beforeEach(() => {
    deps = {
      users: new Map([
        ['preven-token', { uid: 'u-preven', customClaims: { role: 'prevencionista' } }],
        ['admin-token', { uid: 'u-admin', customClaims: { role: 'admin' } }],
        ['worker-token', { uid: 'u-worker', customClaims: { role: 'worker' } }],
        ['stranger-token', { uid: 'u-stranger', customClaims: { role: 'admin' } }],
      ]),
      projects: new Map([
        ['p1', { tenantId: 't1', members: ['u-preven', 'u-admin'], createdBy: 'u-admin' }],
      ]),
      jobs: new Map(),
      fetchSpy: vi.fn(),
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('queues a job for a supervisor caller and dispatches to worker (201)', async () => {
    process.env.PHOTOGRAMMETRY_WORKER_URL = 'https://worker.run.app';
    process.env.PHOTOGRAMMETRY_WORKER_TOKEN = 'tok';
    process.env.PHOTOGRAMMETRY_OUTPUT_BUCKET = 'praeventio-photogrammetry';
    deps.fetchSpy.mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });

    const r = await request(buildApp(deps))
      .post('/api/photogrammetry/jobs')
      .set('Authorization', 'Bearer preven-token')
      .send({
        projectId: 'p1',
        name: 'Faena Norte 1',
        imageUrls: ['gs://bucket/a.jpg', 'gs://bucket/b.jpg', 'gs://bucket/c.jpg'],
      });

    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'queued' });
    expect(typeof r.body.jobId).toBe('string');
    expect(typeof r.body.estimatedDurationMin).toBe('number');
    // Persisted under correct tenant.
    const stored = Array.from(deps.jobs.keys());
    expect(stored.length).toBe(1);
    expect(stored[0]).toMatch(/^tenants\/t1\/photogrammetry_jobs\//);
    // Dispatch happened with correct payload.
    expect(deps.fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = deps.fetchSpy.mock.calls[0];
    expect(url).toBe('https://worker.run.app/process');
    expect(init.headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body);
    expect(body.projectId).toBe('p1');
    expect(body.tenantId).toBe('t1');
    expect(body.imageUrls).toHaveLength(3);
    expect(body.outputBucket).toBe('praeventio-photogrammetry');
  });

  it('queues a video reconstruction job and dispatches videoUrl to the worker', async () => {
    process.env.PHOTOGRAMMETRY_WORKER_URL = 'https://worker.run.app';
    process.env.PHOTOGRAMMETRY_WORKER_TOKEN = 'tok';
    deps.fetchSpy.mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });

    const r = await request(buildApp(deps))
      .post('/api/photogrammetry/jobs')
      .set('Authorization', 'Bearer preven-token')
      .send({
        projectId: 'p1',
        name: 'Recorrido galpon A',
        videoUrl: 'gs://bucket/digital_twin/p1/walkthrough.mp4',
      });

    expect(r.status).toBe(201);
    const [, init] = deps.fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      projectId: 'p1',
      tenantId: 't1',
      videoUrl: 'gs://bucket/digital_twin/p1/walkthrough.mp4',
    });
    expect(body.imageUrls).toBeUndefined();
  });

  it('GET list returns project jobs for the Digital Twin UI', async () => {
    deps.jobs.set('tenants/t1/photogrammetry_jobs/job-a', {
      projectId: 'p1',
      tenantId: 't1',
      status: 'running',
      videoUrl: 'gs://bucket/video.mp4',
    });
    deps.jobs.set('tenants/t1/photogrammetry_jobs/job-b', {
      projectId: 'p1',
      tenantId: 't1',
      status: 'completed',
      meshUri: 'gs://bucket/job-b.ply',
      metrics: { framesExtracted: 120 },
    });

    const r = await request(buildApp(deps))
      .get('/api/photogrammetry/jobs')
      .query({ projectId: 'p1' })
      .set('Authorization', 'Bearer preven-token');

    expect(r.status).toBe(200);
    expect(r.body).toEqual([
      expect.objectContaining({ jobId: 'job-a', status: 'processing', progress: 65 }),
      expect.objectContaining({ jobId: 'job-b', status: 'completed', resultUrl: 'gs://bucket/job-b.ply' }),
    ]);
  });

  it('GET returns the persisted status', async () => {
    deps.jobs.set('tenants/t1/photogrammetry_jobs/job-x', {
      projectId: 'p1',
      tenantId: 't1',
      status: 'completed',
      meshUri: 'gs://praeventio-photogrammetry/p1/job-x.ply',
      estimatedDurationMin: 18,
    });
    const r = await request(buildApp(deps))
      .get('/api/photogrammetry/jobs/job-x')
      .query({ projectId: 'p1' })
      .set('Authorization', 'Bearer preven-token');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      jobId: 'job-x',
      status: 'completed',
      meshUri: 'gs://praeventio-photogrammetry/p1/job-x.ply',
      errorMessage: null,
      estimatedDurationMin: 18,
    });
  });

  it('rejects a worker-tier role with 403', async () => {
    const r = await request(buildApp(deps))
      .post('/api/photogrammetry/jobs')
      .set('Authorization', 'Bearer worker-token')
      .send({
        projectId: 'p1',
        imageUrls: ['gs://b/a.jpg', 'gs://b/b.jpg', 'gs://b/c.jpg'],
      });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/Forbidden/);
    expect(deps.jobs.size).toBe(0);
    expect(deps.fetchSpy).not.toHaveBeenCalled();
  });

  it('Codex P2: GET list returns jobs ordered newest-first by createdAt', async () => {
    deps.jobs.set('tenants/t1/photogrammetry_jobs/job-old', {
      projectId: 'p1',
      tenantId: 't1',
      status: 'completed',
      createdAt: 1000,
    });
    deps.jobs.set('tenants/t1/photogrammetry_jobs/job-mid', {
      projectId: 'p1',
      tenantId: 't1',
      status: 'completed',
      createdAt: 2000,
    });
    deps.jobs.set('tenants/t1/photogrammetry_jobs/job-new', {
      projectId: 'p1',
      tenantId: 't1',
      status: 'running',
      createdAt: 3000,
    });

    const r = await request(buildApp(deps))
      .get('/api/photogrammetry/jobs')
      .query({ projectId: 'p1' })
      .set('Authorization', 'Bearer preven-token');

    expect(r.status).toBe(200);
    expect(r.body.map((j: any) => j.jobId)).toEqual(['job-new', 'job-mid', 'job-old']);
  });

  it('Codex P2: rejects HTTPS videoUrl with 400 (worker only supports gs://)', async () => {
    const r = await request(buildApp(deps))
      .post('/api/photogrammetry/jobs')
      .set('Authorization', 'Bearer preven-token')
      .send({
        projectId: 'p1',
        videoUrl: 'https://example.com/walkthrough.mp4',
      });
    expect(r.status).toBe(400);
    expect(deps.jobs.size).toBe(0);
  });

  it('Codex P2: accepts gs:// path with spaces and percent-encoded chars', async () => {
    process.env.PHOTOGRAMMETRY_WORKER_URL = 'https://worker.run.app';
    process.env.PHOTOGRAMMETRY_WORKER_TOKEN = 'tok';
    deps.fetchSpy.mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });

    const r = await request(buildApp(deps))
      .post('/api/photogrammetry/jobs')
      .set('Authorization', 'Bearer preven-token')
      .send({
        projectId: 'p1',
        imageUrls: [
          'gs://bucket/folder with spaces/a.jpg',
          'gs://bucket/folder%20encoded/b.jpg',
          "gs://bucket/o'reilly+1/c.jpg",
        ],
      });

    expect(r.status).toBe(201);
    expect(r.body.status).toBe('queued');
  });

  it('rejects a non-member admin with 403 (project membership check)', async () => {
    // u-stranger has role=admin but is NOT a member of p1.
    const r = await request(buildApp(deps))
      .post('/api/photogrammetry/jobs')
      .set('Authorization', 'Bearer stranger-token')
      .send({
        projectId: 'p1',
        imageUrls: ['gs://b/a.jpg', 'gs://b/b.jpg', 'gs://b/c.jpg'],
      });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'forbidden' });
    expect(deps.jobs.size).toBe(0);
  });
});
