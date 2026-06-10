// SPDX-License-Identifier: MIT
// AUDIT-2026-06 A.1 — POST /api/projects/:projectId/health-check.
//
// The original route was removed in Round 14 because it was cross-tenant
// exploitable (no membership check), but the consumer was NOT removed:
// ProjectHealthCheck.tsx (live in Analytics) still POSTs here and renders
// the cached projects/{pid}/health_checks/latest doc. The reintroduction
// contract, per the Round 14 removal note in server.ts: it MUST use
// assertProjectMember.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  auditAi: vi.fn(),
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../services/gemini/operations.js', () => ({
  auditProjectComplianceWithAI: H.auditAi,
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import projectHealthRouter from '../../server/routes/projectHealth.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectHealthRouter);
  return app;
}

const PID = 'proj-alpha';

beforeEach(() => {
  H.db = createFakeFirestore();
  H.auditAi.mockReset();
  // Membership: assertProjectMember reads projects/{pid} members/ownerUid.
  H.db._seed(`projects/${PID}`, {
    name: 'Obra Norte',
    ownerUid: 'uid-owner',
    members: ['uid-member'],
    country: 'CL',
  });
  H.db._seed(`projects/${PID}/findings/f1`, {
    title: 'Tablero sin tapa',
    status: 'Abierto',
    priority: 'Alta',
  });
});

describe('POST /api/projects/:projectId/health-check', () => {
  it('401 without token', async () => {
    const res = await request(buildApp()).post(`/api/projects/${PID}/health-check`);
    expect(res.status).toBe(401);
    expect(H.auditAi).not.toHaveBeenCalled();
  });

  it('403 non-member (the Round 14 exploit, now closed)', async () => {
    const res = await request(buildApp())
      .post(`/api/projects/${PID}/health-check`)
      .set('x-test-uid', 'uid-intruder');
    expect(res.status).toBe(403);
    expect(H.auditAi).not.toHaveBeenCalled();
  });

  it('400 invalid projectId shape', async () => {
    const res = await request(buildApp())
      .post(`/api/projects/${'x'.repeat(200)}/health-check`)
      .set('x-test-uid', 'uid-member');
    expect(res.status).toBe(400);
  });

  it('200 member: runs the AI audit, caches health_checks/latest, audits', async () => {
    H.auditAi.mockResolvedValue({
      complianceScore: 72,
      criticalGaps: [
        { gap: 'Sin comité paritario', regulation: 'DS 54', severity: 'Crítica' },
      ],
      recommendations: ['Constituir CPHS'],
      summary: 'Cumplimiento parcial',
    });
    const res = await request(buildApp())
      .post(`/api/projects/${PID}/health-check`)
      .set('x-test-uid', 'uid-member');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The AI op received the project name and a normative context with
    // real Chilean references (country pack), plus the open finding.
    expect(H.auditAi).toHaveBeenCalledTimes(1);
    const [projectName, projectContext, normativeContext] = H.auditAi.mock.calls[0];
    expect(projectName).toBe('Obra Norte');
    expect(projectContext).toContain('Tablero sin tapa');
    expect(normativeContext).toContain('DS 54');

    // Cached result the component subscribes to.
    const cached = H.db!._store.get(`projects/${PID}/health_checks/latest`);
    expect(cached).toBeTruthy();
    expect((cached!.compliance as Record<string, unknown>).complianceScore).toBe(72);

    // Rule #3 — audit_logs row with server-stamped identity (canonical
    // auditServerEvent helper: userId from the verified token).
    const audit = [...H.db!._store.values()].find(
      (d) => d.action === 'project_health_check'
    );
    expect(audit?.userId).toBe('uid-member');
    expect(audit?.projectId).toBe(PID);
  });

  it('502 when the AI op fails — no cache write, no fake result', async () => {
    H.auditAi.mockRejectedValue(new Error('quota'));
    const res = await request(buildApp())
      .post(`/api/projects/${PID}/health-check`)
      .set('x-test-uid', 'uid-member');
    expect(res.status).toBe(502);
    expect(H.db!._store.get(`projects/${PID}/health_checks/latest`)).toBeUndefined();
  });
});
