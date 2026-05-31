// Real-router supertest for src/server/routes/checklistBuilder.ts
// (Plan v3 Fase 1 — coverage campaign, Sprint 49 §261-270).
//
// The route is mounted at /api/sprint-k in server.ts (confirmed line 1001).
// All four endpoints are POST /:projectId/checklists/<sub-path> behind
// verifyAuth + validate(zodSchema) + guard(assertProjectMember).
//
// The engine functions (validateResponse, rectifyField, applySignature,
// lockResponse) are PURE COMPUTE — no mocking. We exercise them through the
// real HTTP surface so the 400/409/500 branches are covered as well as the
// 200 happy paths.
//
// z.unknown() probe note: templateSchema / responseSchema / fieldValueSchema
// are z.unknown() (checklistBuilder.ts lines 74-76), so malformed values
// pass the validate() middleware and only blow up (or not) inside the engine.
// See the "z.unknown() probe" tests below.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') || undefined,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import checklistBuilderRouter from '../../server/routes/checklistBuilder.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', checklistBuilderRouter);
  return app;
}

const PROJECT_ID = 'p-cb-test';
const CALLER_UID = 'uid-cb-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Checklist Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

// ─── Minimal valid template + response fixtures ───────────────────────────

const minTemplate = {
  id: 'tpl-altura-v1',
  version: '1.0.0',
  category: 'inspection',
  title: 'Inspección en altura',
  sections: [
    {
      id: 'sec-general',
      title: 'General',
      fields: [
        {
          id: 'f-epp-casco',
          kind: 'boolean',
          label: '¿Casco instalado?',
          required: true,
        },
      ],
    },
  ],
  requiredSignatures: [
    {
      role: 'supervisor',
      attestationText: 'Declaro que los EPP están en condiciones.',
    },
  ],
};

const minResponse = {
  templateId: 'tpl-altura-v1',
  templateVersion: '1.0.0',
  responseId: 'resp-001',
  startedAt: '2026-05-01T08:00:00.000Z',
  locked: false,
  responses: [
    { fieldId: 'f-epp-casco', value: true },
  ],
};

// A locked response for rectify/lock-response tests
const lockedResponse = {
  ...minResponse,
  locked: true,
  completedAt: '2026-05-01T09:00:00.000Z',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/checklists/validate-response
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/checklists/validate-response', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/checklists/validate-response`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ template: minTemplate, response: minResponse });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ template: minTemplate, response: minResponse });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/checklists/validate-response`)
      .set('x-test-uid', CALLER_UID)
      .send({ template: minTemplate, response: minResponse });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 valid response → valid=true, completionScore=100', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ template: minTemplate, response: minResponse });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.valid).toBe(true);
    expect(result.completionScore).toBe(100);
    expect(result.riskScore).toBe(0);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('200 response with missing required field → valid=false, finding present', async () => {
    const incompleteResponse = {
      ...minResponse,
      responses: [], // no answers
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ template: minTemplate, response: incompleteResponse });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: { valid: boolean; findings: { kind: string }[]; completionScore: number } };
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.kind === 'missing_required_field')).toBe(true);
    expect(result.completionScore).toBe(0);
  });

  it('200 templateId mismatch → unknown_template finding', async () => {
    const mismatchedResponse = { ...minResponse, templateId: 'wrong-id' };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ template: minTemplate, response: mismatchedResponse });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: { findings: { kind: string }[] } };
    expect(result.findings.some((f) => f.kind === 'unknown_template')).toBe(true);
  });

  // ── z.unknown() probe: template field is MISSING entirely ──────────────
  // templateSchema = z.record(z.string(), z.unknown()) (line 74) → validate()
  // now rejects a missing/null template at the middleware layer.
  // FIXED BEHAVIOR: validate() returns 400 invalid_payload before the engine
  // is ever called. Fix applied in checklistBuilder.ts lines 70-76.
  it('z.unknown() probe: missing template → 400 invalid_payload (fixed)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ response: minResponse }); // template intentionally omitted
    // z.record rejects undefined at the validation layer → 400 invalid_payload
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  // ── z.unknown() probe: response field is MISSING entirely ──────────────
  // responseSchema = z.record(z.string(), z.unknown()) (line 75) → validate()
  // now rejects a missing/null response at the middleware layer.
  it('z.unknown() probe: missing response → 400 invalid_payload (fixed)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ template: minTemplate }); // response intentionally omitted
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 riskScore accumulates from options with riskWeight', async () => {
    const riskTemplate = {
      ...minTemplate,
      id: 'tpl-risk-v1',
      sections: [
        {
          id: 'sec-risk',
          title: 'Riesgo',
          fields: [
            {
              id: 'f-nivel-riesgo',
              kind: 'single_choice',
              label: '¿Nivel de riesgo?',
              required: true,
              options: [
                { value: 'bajo', label: 'Bajo', riskWeight: 1 },
                { value: 'alto', label: 'Alto', riskWeight: 10 },
              ],
            },
          ],
        },
      ],
      requiredSignatures: [],
    };
    const riskResponse = {
      ...minResponse,
      templateId: 'tpl-risk-v1',
      responses: [{ fieldId: 'f-nivel-riesgo', value: 'alto' }],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ template: riskTemplate, response: riskResponse });
    expect(res.status).toBe(200);
    expect((res.body as { result: { riskScore: number } }).result.riskScore).toBe(10);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/checklists/rectify-field
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/checklists/rectify-field', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/checklists/rectify-field`;

  const validRectifyBody = {
    response: lockedResponse,
    fieldId: 'f-epp-casco',
    newValue: false,
    reason: 'Corrección por supervisor: el casco estaba dañado',
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send(validRectifyBody);
    expect(res.status).toBe(401);
  });

  it('400 when fieldId is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ response: lockedResponse, newValue: false, reason: 'x'.repeat(10) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when reason is too short (< 10 chars in zod layer)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validRectifyBody, reason: 'corto' }); // < 10 chars
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when fieldId exceeds 200 chars', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validRectifyBody, fieldId: 'x'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send(validRectifyBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path: returns updated response with rectifiedFrom audit trail', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(validRectifyBody);
    expect(res.status).toBe(200);
    const { response } = res.body as {
      response: {
        responses: Array<{
          fieldId: string;
          value: unknown;
          rectifiedFrom?: { previousValue: unknown; rectifiedByUid: string };
        }>;
      }
    };
    const rectifiedField = response.responses.find((r) => r.fieldId === 'f-epp-casco');
    expect(rectifiedField).toBeDefined();
    expect(rectifiedField!.value).toBe(false);
    // rectifiedByUid must be server-stamped to the caller uid, not any client value
    expect(rectifiedField!.rectifiedFrom?.rectifiedByUid).toBe(CALLER_UID);
    expect(rectifiedField!.rectifiedFrom?.previousValue).toBe(true);
  });

  it('409 when response is not locked (RectificationError: not_locked)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validRectifyBody, response: minResponse }); // unlocked
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('not_locked');
  });

  it('409 when fieldId does not exist in response (RectificationError: field_not_found)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validRectifyBody, fieldId: 'nonexistent-field-id' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('field_not_found');
  });

  it('200 with optional now param: rectifiedAt reflects provided timestamp', async () => {
    const nowIso = '2026-03-15T10:30:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validRectifyBody, now: nowIso });
    expect(res.status).toBe(200);
    const { response } = res.body as {
      response: { responses: Array<{ fieldId: string; rectifiedFrom?: { rectifiedAt: string } }> }
    };
    const field = response.responses.find((r) => r.fieldId === 'f-epp-casco');
    expect(field?.rectifiedFrom?.rectifiedAt).toBe(nowIso);
  });

  // ── z.unknown() probe: response field MISSING ──────────────────────────
  // responseSchema = z.record(z.string(), z.unknown()) (line 75) → validate()
  // now rejects a missing/null response at the middleware layer.
  // FIXED BEHAVIOR: 400 invalid_payload instead of 500 internal_error.
  it('z.unknown() probe: missing response → 400 invalid_payload (fixed)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ fieldId: 'f-epp-casco', newValue: false, reason: 'Razón de diez caracteres' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/checklists/apply-signature
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/checklists/apply-signature', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/checklists/apply-signature`;

  // A minimal valid base64-like string ≥ 40 chars (the zod min)
  const fakePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';

  const validSignBody = {
    response: minResponse,
    role: 'supervisor',
    signaturePng: fakePng,
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send(validSignBody);
    expect(res.status).toBe(401);
  });

  it('400 when role is not one of the enum values', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validSignBody, role: 'director' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when signaturePng is too short (< 40 chars)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validSignBody, signaturePng: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send(validSignBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path: signature field added with server-stamped signedByUid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(validSignBody);
    expect(res.status).toBe(200);
    const { response } = res.body as {
      response: {
        responses: Array<{
          fieldId: string;
          value: string;
          signatureMeta?: { role: string; signedByUid: string };
        }>;
      }
    };
    const sigField = response.responses.find((r) => r.fieldId === 'signature:supervisor');
    expect(sigField).toBeDefined();
    expect(sigField!.signatureMeta?.role).toBe('supervisor');
    // signedByUid must be server-stamped to caller uid
    expect(sigField!.signatureMeta?.signedByUid).toBe(CALLER_UID);
    expect(sigField!.value).toBe(fakePng);
  });

  it('200 all 6 signature roles are accepted', async () => {
    const roles = ['worker', 'supervisor', 'prevencionista', 'cphs_rep', 'company_doctor', 'external_auditor'] as const;
    for (const role of roles) {
      const res = await request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send({ ...validSignBody, role });
      expect(res.status).toBe(200);
      const { response } = res.body as {
        response: { responses: Array<{ fieldId: string }> }
      };
      expect(response.responses.some((r) => r.fieldId === `signature:${role}`)).toBe(true);
    }
  });

  it('200 with optional now param: signedAt reflects provided timestamp', async () => {
    const nowIso = '2026-04-01T14:00:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validSignBody, now: nowIso });
    expect(res.status).toBe(200);
    const { response } = res.body as {
      response: { responses: Array<{ fieldId: string; signatureMeta?: { signedAt: string } }> }
    };
    const sigField = response.responses.find((r) => r.fieldId === 'signature:supervisor');
    expect(sigField?.signatureMeta?.signedAt).toBe(nowIso);
  });

  it('200 applying same role twice overwrites previous signature (idempotent replace)', async () => {
    const firstPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
    const secondPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSK';
    // First signature
    const res1 = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validSignBody, signaturePng: firstPng });
    expect(res1.status).toBe(200);
    const responseAfterFirst = (res1.body as { response: { responses: unknown[] } }).response;
    // Second signature with the same role
    const res2 = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ response: responseAfterFirst, role: 'supervisor', signaturePng: secondPng });
    expect(res2.status).toBe(200);
    const { response } = res2.body as {
      response: { responses: Array<{ fieldId: string; value: string }> }
    };
    const sigFields = response.responses.filter((r) => r.fieldId === 'signature:supervisor');
    // Must deduplicate — only one signature:supervisor entry
    expect(sigFields).toHaveLength(1);
    expect(sigFields[0].value).toBe(secondPng);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/checklists/lock-response
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/checklists/lock-response', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/checklists/lock-response`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ response: minResponse });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ response: minResponse });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/checklists/lock-response`)
      .set('x-test-uid', CALLER_UID)
      .send({ response: minResponse });
    expect(res.status).toBe(403);
  });

  it('200 unlocked response becomes locked with completedAt set', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ response: minResponse });
    expect(res.status).toBe(200);
    const { response } = res.body as { response: { locked: boolean; completedAt?: string } };
    expect(response.locked).toBe(true);
    expect(typeof response.completedAt).toBe('string');
  });

  it('200 already-locked response is returned unchanged (idempotent)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ response: lockedResponse });
    expect(res.status).toBe(200);
    const { response } = res.body as { response: { locked: boolean; completedAt: string } };
    expect(response.locked).toBe(true);
    // completedAt should remain the original value
    expect(response.completedAt).toBe(lockedResponse.completedAt);
  });

  it('200 with optional now param: completedAt reflects provided timestamp', async () => {
    const nowIso = '2026-06-01T16:00:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ response: minResponse, now: nowIso });
    expect(res.status).toBe(200);
    const { response } = res.body as { response: { completedAt: string } };
    expect(response.completedAt).toBe(nowIso);
  });

  // ── z.unknown() probe: response field MISSING ──────────────────────────
  // responseSchema = z.record(z.string(), z.unknown()) (line 75) → validate()
  // now rejects a missing/null response at the middleware layer.
  // FIXED BEHAVIOR: 400 invalid_payload instead of 500 internal_error.
  it('z.unknown() probe: missing response → 400 invalid_payload (fixed)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({}); // response intentionally omitted
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 all required fields preserved through lock', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ response: minResponse });
    expect(res.status).toBe(200);
    const { response } = res.body as {
      response: { templateId: string; responseId: string; startedAt: string }
    };
    expect(response.templateId).toBe(minResponse.templateId);
    expect(response.responseId).toBe(minResponse.responseId);
    expect(response.startedAt).toBe(minResponse.startedAt);
  });
});
