// Praeventio Guard â€” Sprint 28 Bucket B3.
//
// Coverage for the transversal Zod validation middleware
// (`src/server/middleware/validate.ts`). The middleware is the FIRST
// barrier on every endpoint that opts in via Sprint 28 â€” these tests
// pin the contract that broke in the audit (H17): one error envelope,
// one log emission, validated data exposed to the next handler.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

import { validate } from './validate.js';
import { logger } from '../../utils/logger.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  return app;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('validate() middleware', () => {
  it('passes through with 200 when the body matches the schema', async () => {
    const app = buildApp();
    const schema = z.object({ name: z.string().min(1), age: z.number().int() });
    app.post('/echo', validate(schema), (req, res) => {
      res.json({ ok: true, validated: req.validated });
    });

    const res = await request(app).post('/echo').send({ name: 'Daho', age: 33 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.validated).toEqual({ name: 'Daho', age: 33 });
  });

  it('returns 400 with `invalid_payload` and the issues array when the body is malformed', async () => {
    const app = buildApp();
    const schema = z.object({ name: z.string().min(1) });
    app.post('/echo', validate(schema), (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app).post('/echo').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it('reads from req.query when source is "query"', async () => {
    const app = buildApp();
    const schema = z.object({ q: z.string().min(1) });
    app.get('/search', validate(schema, 'query'), (req, res) => {
      res.json({ validated: req.validated });
    });

    const ok = await request(app).get('/search').query({ q: 'foo' });
    expect(ok.status).toBe(200);
    expect(ok.body.validated.q).toBe('foo');

    const bad = await request(app).get('/search');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_payload');
  });

  it('reads from req.params when source is "params"', async () => {
    const app = buildApp();
    const schema = z.object({ id: z.string().regex(/^[a-z0-9-]{3,}$/) });
    app.get('/item/:id', validate(schema, 'params'), (req, res) => {
      res.json({ validated: req.validated });
    });

    const ok = await request(app).get('/item/abc-123');
    expect(ok.status).toBe(200);
    expect(ok.body.validated.id).toBe('abc-123');

    const bad = await request(app).get('/item/!!');
    expect(bad.status).toBe(400);
  });

  it('exposes validated data to the next handler via req.validated', async () => {
    const app = buildApp();
    const schema = z.object({ projectId: z.string().min(1) });
    let seen: unknown = null;
    app.post('/x', validate(schema), (req, _res, next) => {
      seen = req.validated;
      next();
    }, (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app).post('/x').send({ projectId: 'p-1' });
    expect(res.status).toBe(200);
    expect(seen).toEqual({ projectId: 'p-1' });
  });

  it('applies z.transform on success', async () => {
    const app = buildApp();
    const schema = z.object({
      tag: z.string().transform((s) => s.trim().toLowerCase()),
    });
    app.post('/x', validate(schema), (req, res) => {
      res.json({ validated: req.validated });
    });

    const res = await request(app).post('/x').send({ tag: '  ALPHA  ' });
    expect(res.status).toBe(200);
    expect(res.body.validated.tag).toBe('alpha');
  });

  it('applies default fields on missing input', async () => {
    const app = buildApp();
    const schema = z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    });
    app.post('/x', validate(schema), (req, res) => {
      res.json({ validated: req.validated });
    });

    const res = await request(app).post('/x').send({});
    expect(res.status).toBe(200);
    expect(res.body.validated).toEqual({ page: 1, limit: 20 });
  });

  it('emits logger.warn with path + issues on validation failure', async () => {
    const app = buildApp();
    const schema = z.object({ name: z.string().min(1) });
    app.post('/needs-name', validate(schema), (_req, res) => {
      res.json({ ok: true });
    });

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const res = await request(app).post('/needs-name').send({});
    expect(res.status).toBe(400);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [event, payload] = warnSpy.mock.calls[0];
    expect(event).toBe('validation_failed');
    expect((payload as any).path).toBe('/needs-name');
    expect((payload as any).source).toBe('body');
    expect(Array.isArray((payload as any).issues)).toBe(true);
    expect((payload as any).issues.length).toBeGreaterThan(0);
  });

  it('records uid in the warn payload when verifyAuth populated req.user', async () => {
    const app = buildApp();
    const schema = z.object({ name: z.string().min(1) });
    app.post(
      '/with-auth',
      (req, _res, next) => {
        req.user = { uid: 'uid-A' };
        next();
      },
      validate(schema),
      (_req, res) => res.json({ ok: true }),
    );

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const res = await request(app).post('/with-auth').send({ name: '' });
    expect(res.status).toBe(400);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect((warnSpy.mock.calls[0][1] as any).uid).toBe('uid-A');
  });
});
