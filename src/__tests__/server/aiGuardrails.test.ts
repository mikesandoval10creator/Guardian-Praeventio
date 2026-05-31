// Real-router supertest for src/server/routes/aiGuardrails.ts
// (Plan v3 Fase 1 — Sprint K §155-160).
//
// All 10 POST endpoints are pure-compute (no Firestore writes by the route
// itself). Auth is via the x-test-uid shim + fakeFirestore membership check
// (projects/<id> seeded with members array). No real LLM call is made —
// the aiGuardrails service functions are pure deterministic functions that
// do NOT touch any LLM adapter; the route imports them directly.
//
// Human-in-the-loop contract asserted here:
//   • guard-hallucination returns `allow: false` on specific numbers without
//     citation → the route wraps it and returns the raw result. The RESULT
//     itself is a SUGGESTION; the human caller decides whether to proceed.
//   • validate-response returns `ok: false` on invalid citations → flagged,
//     never auto-actioned. The route passes the result to the caller who
//     must present it to a human decision-maker.
//   • No endpoint auto-applies an LLM action — all return data for human
//     review, never commands.

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

import aiGuardrailsRouter from '../../server/routes/aiGuardrails.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const PROJECT_ID = 'proj-guardrails-1';
const MEMBER_UID = 'member-uid-1';
const OUTSIDER_UID = 'outsider-uid-1';

// Route is mounted at /api/sprint-k in production (server.ts line 1045).
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', aiGuardrailsRouter);
  return app;
}

function url(endpoint: string) {
  return `/api/sprint-k/${PROJECT_ID}/ai-guardrails/${endpoint}`;
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Seed project so assertProjectMember passes for MEMBER_UID.
  H.db._seed(`projects/${PROJECT_ID}`, {
    name: 'Test Project',
    createdBy: MEMBER_UID,
    members: [MEMBER_UID],
  });
  // OUTSIDER_UID is NOT in members and is NOT createdBy → 403.
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared auth + membership tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Auth + membership guard', () => {
  it('401 on get-prompt when no token is sent', async () => {
    const res = await request(buildApp())
      .post(url('get-prompt'))
      .send({ promptId: 'rag.zk.query', version: '1.0.0' });
    expect(res.status).toBe(401);
  });

  it('403 on get-prompt when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url('get-prompt'))
      .set('x-test-uid', OUTSIDER_UID)
      .send({ promptId: 'rag.zk.query', version: '1.0.0' });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('401 on get-catalog when no token is sent', async () => {
    const res = await request(buildApp())
      .post(url('get-catalog'))
      .send({});
    expect(res.status).toBe(401);
  });

  it('403 on get-catalog when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url('get-catalog'))
      .set('x-test-uid', OUTSIDER_UID)
      .send({});
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/ai-guardrails/get-prompt
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /get-prompt', () => {
  it('200 returns the requested prompt', async () => {
    const res = await request(buildApp())
      .post(url('get-prompt'))
      .set('x-test-uid', MEMBER_UID)
      .send({ promptId: 'rag.zk.query', version: '1.0.0' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('prompt');
    const prompt = body.prompt as Record<string, unknown>;
    expect(prompt.id).toBe('rag.zk.query');
    expect(prompt.version).toBe('1.0.0');
    expect(typeof prompt.body).toBe('string');
    expect(typeof prompt.maxTokens).toBe('number');
  });

  it('404 for an unknown promptId', async () => {
    const res = await request(buildApp())
      .post(url('get-prompt'))
      .set('x-test-uid', MEMBER_UID)
      .send({ promptId: 'nonexistent.prompt', version: '1.0.0' });
    expect(res.status).toBe(404);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('unknown_prompt');
    expect(typeof body.message).toBe('string');
  });

  it('404 for a known id but unknown version', async () => {
    const res = await request(buildApp())
      .post(url('get-prompt'))
      .set('x-test-uid', MEMBER_UID)
      .send({ promptId: 'rag.zk.query', version: '99.0.0' });
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('unknown_prompt');
  });

  it('400 when promptId is missing', async () => {
    const res = await request(buildApp())
      .post(url('get-prompt'))
      .set('x-test-uid', MEMBER_UID)
      .send({ version: '1.0.0' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when version is missing', async () => {
    const res = await request(buildApp())
      .post(url('get-prompt'))
      .set('x-test-uid', MEMBER_UID)
      .send({ promptId: 'rag.zk.query' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/ai-guardrails/get-latest-version
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /get-latest-version', () => {
  it('401 without token', async () => {
    const res = await request(buildApp())
      .post(url('get-latest-version'))
      .send({ promptId: 'rag.zk.query' });
    expect(res.status).toBe(401);
  });

  it('200 returns the latest version of a known prompt', async () => {
    const res = await request(buildApp())
      .post(url('get-latest-version'))
      .set('x-test-uid', MEMBER_UID)
      .send({ promptId: 'rag.zk.query' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('prompt');
    const prompt = body.prompt as Record<string, unknown>;
    expect(prompt.id).toBe('rag.zk.query');
    // Latest version of rag.zk.query is 2.0.0 (last in catalog).
    expect(prompt.version).toBe('2.0.0');
  });

  it('404 for a completely unknown promptId', async () => {
    const res = await request(buildApp())
      .post(url('get-latest-version'))
      .set('x-test-uid', MEMBER_UID)
      .send({ promptId: 'totally.unknown' });
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('unknown_prompt');
  });

  it('400 when promptId is missing', async () => {
    const res = await request(buildApp())
      .post(url('get-latest-version'))
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/ai-guardrails/list-versions
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /list-versions', () => {
  it('401 without token', async () => {
    const res = await request(buildApp())
      .post(url('list-versions'))
      .send({ promptId: 'rag.zk.query' });
    expect(res.status).toBe(401);
  });

  it('200 returns all versions for a known promptId', async () => {
    const res = await request(buildApp())
      .post(url('list-versions'))
      .set('x-test-uid', MEMBER_UID)
      .send({ promptId: 'rag.zk.query' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.versions)).toBe(true);
    const versions = body.versions as string[];
    expect(versions).toContain('1.0.0');
    expect(versions).toContain('1.1.0');
    expect(versions).toContain('2.0.0');
  });

  it('200 returns empty array for an unknown promptId (no throw)', async () => {
    const res = await request(buildApp())
      .post(url('list-versions'))
      .set('x-test-uid', MEMBER_UID)
      .send({ promptId: 'nonexistent.id' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.versions).toEqual([]);
  });

  it('403 when caller is not a member', async () => {
    const res = await request(buildApp())
      .post(url('list-versions'))
      .set('x-test-uid', OUTSIDER_UID)
      .send({ promptId: 'rag.zk.query' });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/ai-guardrails/list-prompt-ids
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /list-prompt-ids', () => {
  it('401 without token', async () => {
    const res = await request(buildApp())
      .post(url('list-prompt-ids'))
      .send({});
    expect(res.status).toBe(401);
  });

  it('200 returns all unique prompt IDs', async () => {
    const res = await request(buildApp())
      .post(url('list-prompt-ids'))
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.ids)).toBe(true);
    const ids = body.ids as string[];
    expect(ids).toContain('rag.zk.query');
    expect(ids).toContain('safety.epp.suggest');
    expect(ids).toContain('incidents.summarize');
    // IDs are unique.
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('400 on extra unknown fields (strict schema)', async () => {
    const res = await request(buildApp())
      .post(url('list-prompt-ids'))
      .set('x-test-uid', MEMBER_UID)
      .send({ unexpected: 'field' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/ai-guardrails/get-catalog
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /get-catalog', () => {
  it('401 without token', async () => {
    const res = await request(buildApp())
      .post(url('get-catalog'))
      .send({});
    expect(res.status).toBe(401);
  });

  it('200 returns the full catalog', async () => {
    const res = await request(buildApp())
      .post(url('get-catalog'))
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.catalog)).toBe(true);
    const catalog = body.catalog as Array<Record<string, unknown>>;
    expect(catalog.length).toBeGreaterThan(0);
    // Each entry has the expected shape.
    for (const entry of catalog) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.version).toBe('string');
      expect(typeof entry.body).toBe('string');
      expect(typeof entry.maxTokens).toBe('number');
      expect(['required', 'optional']).toContain(entry.citations);
    }
  });

  it('400 on extra fields (strict schema)', async () => {
    const res = await request(buildApp())
      .post(url('get-catalog'))
      .set('x-test-uid', MEMBER_UID)
      .send({ extra: true });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/ai-guardrails/render-prompt-body
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /render-prompt-body', () => {
  it('401 without token', async () => {
    const res = await request(buildApp())
      .post(url('render-prompt-body'))
      .send({ body: 'Hello {{name}}', inputs: { name: 'World' } });
    expect(res.status).toBe(401);
  });

  it('200 replaces placeholders in the prompt body', async () => {
    const res = await request(buildApp())
      .post(url('render-prompt-body'))
      .set('x-test-uid', MEMBER_UID)
      .send({
        body: 'Pregunta: {{question}}\nContexto: {{context}}',
        inputs: { question: '¿qué EPP?', context: 'minería subterránea' },
      });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(typeof body.rendered).toBe('string');
    expect(body.rendered).toContain('¿qué EPP?');
    expect(body.rendered).toContain('minería subterránea');
    expect(body.rendered).not.toContain('{{question}}');
    expect(body.rendered).not.toContain('{{context}}');
  });

  it('200 leaves unmatched placeholders as-is when not provided in inputs', async () => {
    const res = await request(buildApp())
      .post(url('render-prompt-body'))
      .set('x-test-uid', MEMBER_UID)
      .send({
        body: 'Hello {{name}}, your id is {{id}}',
        inputs: { name: 'Carlos' },
      });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    // name is resolved; id is NOT in inputs so stays as literal
    expect(body.rendered).toContain('Carlos');
    expect(body.rendered).toContain('{{id}}');
  });

  it('200 with empty body and empty inputs', async () => {
    const res = await request(buildApp())
      .post(url('render-prompt-body'))
      .set('x-test-uid', MEMBER_UID)
      .send({ body: '', inputs: {} });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).rendered).toBe('');
  });

  it('400 when body field is missing', async () => {
    const res = await request(buildApp())
      .post(url('render-prompt-body'))
      .set('x-test-uid', MEMBER_UID)
      .send({ inputs: {} });
    expect(res.status).toBe(400);
  });

  it('400 when inputs field is missing', async () => {
    const res = await request(buildApp())
      .post(url('render-prompt-body'))
      .set('x-test-uid', MEMBER_UID)
      .send({ body: 'hello' });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member', async () => {
    const res = await request(buildApp())
      .post(url('render-prompt-body'))
      .set('x-test-uid', OUTSIDER_UID)
      .send({ body: 'hello', inputs: {} });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/ai-guardrails/find-unresolved-placeholders
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /find-unresolved-placeholders', () => {
  it('401 without token', async () => {
    const res = await request(buildApp())
      .post(url('find-unresolved-placeholders'))
      .send({ rendered: 'some text' });
    expect(res.status).toBe(401);
  });

  it('200 returns empty array when no placeholders remain', async () => {
    const res = await request(buildApp())
      .post(url('find-unresolved-placeholders'))
      .set('x-test-uid', MEMBER_UID)
      .send({ rendered: 'Pregunta: ¿qué EPP?\nContexto: minería' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.unresolved).toEqual([]);
  });

  it('200 lists unresolved {{placeholder}} tokens', async () => {
    const res = await request(buildApp())
      .post(url('find-unresolved-placeholders'))
      .set('x-test-uid', MEMBER_UID)
      .send({ rendered: 'Hello {{name}}, your id is {{id}}' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.unresolved)).toBe(true);
    const unresolved = body.unresolved as string[];
    expect(unresolved).toContain('{{name}}');
    expect(unresolved).toContain('{{id}}');
  });

  it('200 with empty rendered string returns empty array', async () => {
    const res = await request(buildApp())
      .post(url('find-unresolved-placeholders'))
      .set('x-test-uid', MEMBER_UID)
      .send({ rendered: '' });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).unresolved).toEqual([]);
  });

  it('400 when rendered field is missing', async () => {
    const res = await request(buildApp())
      .post(url('find-unresolved-placeholders'))
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/ai-guardrails/extract-citations
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /extract-citations', () => {
  it('401 without token', async () => {
    const res = await request(buildApp())
      .post(url('extract-citations'))
      .send({ text: 'some text [1]' });
    expect(res.status).toBe(401);
  });

  it('200 returns citations from text with [n] markers', async () => {
    const res = await request(buildApp())
      .post(url('extract-citations'))
      .set('x-test-uid', MEMBER_UID)
      .send({ text: 'Según DS 594 [1] y Ley 16.744 [2] es obligatorio.' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.citations)).toBe(true);
    const citations = body.citations as Array<Record<string, unknown>>;
    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({ index: 1, position: expect.any(Number) as number });
    expect(citations[1]).toMatchObject({ index: 2, position: expect.any(Number) as number });
  });

  it('200 returns empty array when no citations are present', async () => {
    const res = await request(buildApp())
      .post(url('extract-citations'))
      .set('x-test-uid', MEMBER_UID)
      .send({ text: 'Texto sin ninguna citation.' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.citations).toEqual([]);
  });

  it('200 with empty text returns empty array', async () => {
    const res = await request(buildApp())
      .post(url('extract-citations'))
      .set('x-test-uid', MEMBER_UID)
      .send({ text: '' });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).citations).toEqual([]);
  });

  it('400 when text field is missing', async () => {
    const res = await request(buildApp())
      .post(url('extract-citations'))
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member', async () => {
    const res = await request(buildApp())
      .post(url('extract-citations'))
      .set('x-test-uid', OUTSIDER_UID)
      .send({ text: 'hello [1]' });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/ai-guardrails/validate-response
// (Human-in-the-loop: returns validation result — never auto-acts)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /validate-response', () => {
  it('401 without token', async () => {
    const res = await request(buildApp())
      .post(url('validate-response'))
      .send({ text: 'texto', sources: [], policy: 'optional' });
    expect(res.status).toBe(401);
  });

  it('200 result.ok=true when required policy and valid citation is present', async () => {
    const res = await request(buildApp())
      .post(url('validate-response'))
      .set('x-test-uid', MEMBER_UID)
      .send({
        text: 'Según el DS 594 [1] es obligatorio usar EPP.',
        sources: [{ id: 'node-ds594', label: 'DS 594' }],
        policy: 'required',
      });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('result');
    const result = body.result as Record<string, unknown>;
    // Human-in-the-loop: result is a SUGGESTION, caller must act on it
    expect(result.ok).toBe(true);
    expect(result.missingCitations).toEqual([]);
    expect(result.invalidCitations).toEqual([]);
  });

  it('200 result.ok=false when required policy but NO citations (flagged for human review)', async () => {
    const res = await request(buildApp())
      .post(url('validate-response'))
      .set('x-test-uid', MEMBER_UID)
      .send({
        text: 'El EPP es obligatorio en todo momento.',
        sources: [{ id: 'node-ds594' }],
        policy: 'required',
      });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    // AI output is flagged — returned as data for human decision, never auto-blocked by the route
    expect(result.ok).toBe(false);
    expect(Array.isArray(result.missingCitations)).toBe(true);
    expect((result.missingCitations as unknown[]).length).toBeGreaterThan(0);
  });

  it('200 result.ok=false when citation index exceeds sources length (hallucinated ref)', async () => {
    const res = await request(buildApp())
      .post(url('validate-response'))
      .set('x-test-uid', MEMBER_UID)
      .send({
        text: 'Según [99] el límite es 50 ppm.',
        sources: [{ id: 'node-a' }],
        policy: 'optional',
      });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    expect(result.ok).toBe(false);
    const invalid = result.invalidCitations as Array<Record<string, unknown>>;
    expect(invalid.length).toBeGreaterThan(0);
    expect(invalid[0]).toMatchObject({ index: 99 });
  });

  it('200 result.ok=true with optional policy and no citations', async () => {
    const res = await request(buildApp())
      .post(url('validate-response'))
      .set('x-test-uid', MEMBER_UID)
      .send({
        text: 'Use el casco siempre.',
        sources: [],
        policy: 'optional',
      });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    expect(result.ok).toBe(true);
  });

  it('400 when policy is invalid enum value', async () => {
    const res = await request(buildApp())
      .post(url('validate-response'))
      .set('x-test-uid', MEMBER_UID)
      .send({
        text: 'hello',
        sources: [],
        policy: 'mandatory', // invalid — only 'required' | 'optional'
      });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when sources is not an array', async () => {
    const res = await request(buildApp())
      .post(url('validate-response'))
      .set('x-test-uid', MEMBER_UID)
      .send({ text: 'hello', sources: 'not-an-array', policy: 'optional' });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member', async () => {
    const res = await request(buildApp())
      .post(url('validate-response'))
      .set('x-test-uid', OUTSIDER_UID)
      .send({ text: 'hello', sources: [], policy: 'optional' });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/ai-guardrails/guard-hallucination
// (Human-in-the-loop: guard result is a SUGGESTION, never auto-applied)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /guard-hallucination', () => {
  it('401 without token', async () => {
    const res = await request(buildApp())
      .post(url('guard-hallucination'))
      .send({ text: 'La concentración es 50 ppm.' });
    expect(res.status).toBe(401);
  });

  it('200 result.allow=true for text with no specific claims', async () => {
    const res = await request(buildApp())
      .post(url('guard-hallucination'))
      .set('x-test-uid', MEMBER_UID)
      .send({ text: 'Use siempre su casco de seguridad.' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('result');
    const result = body.result as Record<string, unknown>;
    expect(result.allow).toBe(true);
    expect(result.suspiciousSentences).toEqual([]);
  });

  it('200 result.allow=true when numeric claim has citation [n]', async () => {
    const res = await request(buildApp())
      .post(url('guard-hallucination'))
      .set('x-test-uid', MEMBER_UID)
      .send({ text: 'La concentración máxima es 50 ppm según [1].' });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    // Cited number: guard allows — human still sees the result before acting
    expect(result.allow).toBe(true);
  });

  it('200 result.allow=false for specific number WITHOUT citation (flagged for human review)', async () => {
    const res = await request(buildApp())
      .post(url('guard-hallucination'))
      .set('x-test-uid', MEMBER_UID)
      .send({ text: 'La concentración máxima es 50 ppm.' });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    // Guard flagged: result is returned as data — caller must present to human decision-maker
    // The route NEVER auto-acts; it only surfaces the guardrail signal
    expect(result.allow).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(Array.isArray(result.suspiciousSentences)).toBe(true);
    expect((result.suspiciousSentences as unknown[]).length).toBeGreaterThan(0);
    // The trigger must be one of the known types
    const sentence = (result.suspiciousSentences as Array<Record<string, unknown>>)[0];
    expect(['number_without_citation', 'date_without_citation', 'law_ref_without_citation', 'percentage_without_citation']).toContain(sentence!.trigger);
  });

  it('200 result.allow=false for law reference without citation', async () => {
    const res = await request(buildApp())
      .post(url('guard-hallucination'))
      .set('x-test-uid', MEMBER_UID)
      .send({ text: 'Según el DS 594 el empleador debe proveer EPP.' });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    expect(result.allow).toBe(false);
    const sentences = result.suspiciousSentences as Array<Record<string, unknown>>;
    expect(sentences[0]!.trigger).toBe('law_ref_without_citation');
  });

  it('200 result.allow=true for empty text (nothing to validate)', async () => {
    const res = await request(buildApp())
      .post(url('guard-hallucination'))
      .set('x-test-uid', MEMBER_UID)
      .send({ text: '' });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    expect(result.allow).toBe(true);
  });

  it('400 when text field is missing', async () => {
    const res = await request(buildApp())
      .post(url('guard-hallucination'))
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('403 when caller is not a member', async () => {
    const res = await request(buildApp())
      .post(url('guard-hallucination'))
      .set('x-test-uid', OUTSIDER_UID)
      .send({ text: 'hello' });
    expect(res.status).toBe(403);
  });
});
