import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
const H = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock('../rag/publicLawReader.js', () => ({ retrieveNativeNormative: H.retrieve }));
vi.mock('../middleware/verifyAuth.js', () => ({ verifyAuth: (req: Request, res: Response, next: NextFunction) => {
  const uid = req.header('x-test-uid');
  if (!uid) return void res.status(401).json({ error: 'unauthorized' });
  req.user = { uid } as Request['user']; next();
} }));
import router from './normatives';
const app = express(); app.use(express.json()); app.use('/api/normatives', router);
let sequence = 0;
beforeEach(() => { H.retrieve.mockReset(); H.retrieve.mockResolvedValue({ method: 'lexical', matches: [], scanLimited: false, reason: 'no_match' }); sequence++; });
function search(body: object, uid = `reader-${sequence}`) {
  return request(app).post('/api/normatives/search').set('x-test-uid', uid).send(body);
}
describe('public normative search shared with MCP', () => {
  it('requires authentication before retrieval', async () => {
    expect((await request(app).post('/api/normatives/search').send({ query: 'DS 44' })).status).toBe(401);
    expect(H.retrieve).not.toHaveBeenCalled();
  });
  it('returns the existing retriever result unchanged, including provenance and scan cap', async () => {
    const result = { method: 'lexical', scanLimited: true, matches: [{ id: 'law-1234-chunk-0', lawId: '1234', title: 'DS 44', excerpt: 'Extracto indexado de prueba', sourceUrl: 'https://www.bcn.cl/leychile/navegar?idNorma=1234', matchedTerms: ['44'], sourceStatus: 'indexed-unverified' }] };
    H.retrieve.mockResolvedValue(result);
    const res = await search({ query: '  DS 44  ' });
    expect(res.status).toBe(200); expect(res.body).toEqual(result);
    expect(H.retrieve).toHaveBeenCalledExactlyOnceWith('DS 44');
  });
  it.each([{}, { query: '   ' }, { query: 'abc' }, { query: 'x'.repeat(2001) }, { query: ['DS 44'] }, { query: 'DS 44', tenantId: 'foreign' }, { query: 'DS 44', projectId: 'private' }])('rejects invalid or scope-bearing input %j', async body => {
    expect((await search(body)).status).toBe(400); expect(H.retrieve).not.toHaveBeenCalled();
  });
  it('distinguishes no match from unavailable storage', async () => {
    const empty = await search({ query: 'ruido ocupacional' }); expect(empty.status).toBe(200); expect(empty.body.reason).toBe('no_match');
    H.retrieve.mockResolvedValue({ method: 'lexical', matches: [], scanLimited: false, reason: 'store_unavailable' });
    const unavailable = await search({ query: 'ruido ocupacional' }); expect(unavailable.status).toBe(503); expect(unavailable.body).toEqual({ error: 'normative_store_unavailable' });
  });
  it('sanitizes unexpected failures without echoing query or credentials', async () => {
    H.retrieve.mockRejectedValue(new Error('private query credential'));
    const res = await search({ query: 'ruido ocupacional' }); expect(res.status).toBe(503); expect(JSON.stringify(res.body)).not.toMatch(/private|credential|ruido/);
  });
  it('limits six attempts per authenticated user per minute; other users are independent', async () => {
    const uid = `budget-${sequence}`;
    for (let i = 0; i < 6; i++) expect((await search({ query: 'DS 44' }, uid)).status).toBe(200);
    expect((await search({ query: 'DS 44' }, uid)).status).toBe(429);
    expect(H.retrieve).toHaveBeenCalledTimes(6);
    expect((await search({ query: 'DS 44' }, `${uid}-other`)).status).toBe(200);
  });
});
