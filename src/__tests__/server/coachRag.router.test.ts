// Real-router supertest for the Coach IA RAG HTTP surface
// (src/server/routes/coachRag.ts). Three stateless POST endpoints over the
// NormativeRagService (src/services/coach/normativeRag.ts) + the static
// DOMAIN_PROMPTS (src/services/coach/prompts.ts):
//
//   POST /:projectId/coach-rag/search-top-k      → { chunks: NormativeChunk[] }
//   POST /:projectId/coach-rag/list-chunks       → { chunks: NormativeChunk[] }
//   POST /:projectId/coach-rag/get-domain-prompt → { prompt: DomainPrompt }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the NormativeRagService and DOMAIN_PROMPTS run UNMOCKED so every 200 asserts
// real engine / constant output.
//
// Because no PINECONE_API_KEY env is set in tests, fromEnv() returns the
// in-memory bag-of-words service seeded from CL_PACK + the curated detail
// chunks — fully deterministic and hermetic. The 200 oracles below are derived
// by calling the REAL service in-test (not by copying the handler), so the
// assertions pin actual engine output rather than reimplementing it.

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
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import coachRagRouter from '../../server/routes/coachRag.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { NormativeRagService } from '../../services/coach/normativeRag.js';
import { DOMAIN_PROMPTS } from '../../services/coach/prompts.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', coachRagRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// Ensure in-memory mode (no Pinecone). If a real env happens to set these in
// CI, the deterministic oracle below would diverge — pin them off explicitly.
beforeEach(() => {
  delete process.env.PINECONE_API_KEY;
  delete process.env.PINECONE_INDEX;
  delete process.env.PINECONE_ENDPOINT;
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/coach-rag/search-top-k', () => {
  const url = '/api/sprint-k/p1/coach-rag/search-top-k';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ query: 'tolueno', domain: 'chemical' });
    expect(res.status).toBe(401);
  });

  it('200 returns the real top-K, ranked by the unmocked bag-of-words engine', async () => {
    // Query crafted from the distinctive vocabulary of the DS 594 anexo-4 LPP
    // chunk so the deterministic scorer surfaces it. The oracle is the REAL
    // service output for the same query/domain/k — same engine the route runs.
    const body = {
      query: 'tolueno metanol monoxido limites permisibles ponderados LPP',
      domain: 'chemical' as const,
      k: 3,
    };
    const expected = await NormativeRagService.fromEnv().searchTopK(
      body.query,
      body.domain,
      body.k,
    );

    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.chunks)).toBe(true);
    expect(res.body.chunks).toEqual(expected);
    // The engine never returns more than k.
    expect(res.body.chunks.length).toBeLessThanOrEqual(3);
    // Every returned chunk is actually tagged for the requested domain.
    for (const c of res.body.chunks) {
      expect(c.domains).toContain('chemical');
    }
    // The LPP query surfaces the anexo-4 detail chunk as the top hit.
    expect(res.body.chunks[0].id).toBe('detail-ds594-anexo4');
    expect(res.body.chunks[0].citation).toBe('DS 594/1999 anexo 4');
  });

  it('200 defaults k to 5 when omitted', async () => {
    const body = { query: 'ruido audiometria PREXOR', domain: 'medicine' as const };
    const expected = await NormativeRagService.fromEnv().searchTopK(
      body.query,
      body.domain,
      5,
    );
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    expect(res.body.chunks).toEqual(expected);
    expect(res.body.chunks.length).toBeLessThanOrEqual(5);
  });

  it('400 on missing domain', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ query: 'tolueno' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on a domain outside the HTTP enum (ergonomics is a real prompt but not exposed here)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ query: 'carga', domain: 'ergonomics' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on empty query (min length 1)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ query: '', domain: 'legal' });
    expect(res.status).toBe(400);
  });

  it('400 on k below 1', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ query: 'tolueno', domain: 'chemical', k: 0 });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p2/coach-rag/search-top-k')
      .set(uid)
      .send({ query: 'tolueno', domain: 'chemical' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/ghost/coach-rag/search-top-k')
      .set(uid)
      .send({ query: 'tolueno', domain: 'chemical' });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/coach-rag/list-chunks', () => {
  const url = '/api/sprint-k/p1/coach-rag/list-chunks';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({});
    expect(res.status).toBe(401);
  });

  it('200 returns the full corpus with embeddings stripped', async () => {
    // Oracle: the real corpus, with embedding removed exactly as the route does.
    const full = NormativeRagService.fromEnv().listChunks();
    const expected = full.map(({ embedding: _embedding, ...rest }) => rest);

    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(200);
    expect(res.body.chunks).toEqual(expected);
    expect(res.body.chunks.length).toBe(full.length);
    expect(res.body.chunks.length).toBeGreaterThan(0);
    // No chunk leaks an embedding vector at the HTTP surface.
    for (const c of res.body.chunks) {
      expect(c).not.toHaveProperty('embedding');
      expect(typeof c.id).toBe('string');
      expect(typeof c.citation).toBe('string');
      expect(Array.isArray(c.domains)).toBe(true);
    }
  });

  it('400 on a non-empty body (strict empty schema)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ unexpected: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p2/coach-rag/list-chunks')
      .set(uid)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/coach-rag/get-domain-prompt', () => {
  const url = '/api/sprint-k/p1/coach-rag/get-domain-prompt';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ domain: 'legal' });
    expect(res.status).toBe(401);
  });

  it('200 returns the real DOMAIN_PROMPTS entry for the requested domain', async () => {
    for (const domain of ['chemical', 'medicine', 'legal'] as const) {
      const res = await request(buildApp())
        .post(url)
        .set(uid)
        .send({ domain });
      expect(res.status).toBe(200);
      // Deep-equals the canonical constant the rest of the app uses.
      expect(res.body.prompt).toEqual(DOMAIN_PROMPTS[domain]);
      expect(res.body.prompt.systemPrompt.length).toBeGreaterThan(0);
      expect(res.body.prompt.examples.length).toBeGreaterThanOrEqual(2);
      expect(res.body.prompt.citations.length).toBeGreaterThan(0);
    }
  });

  it('400 on missing domain', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an unexposed domain (structural prompt exists but is not in the HTTP enum)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ domain: 'structural' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p2/coach-rag/get-domain-prompt')
      .set(uid)
      .send({ domain: 'legal' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
