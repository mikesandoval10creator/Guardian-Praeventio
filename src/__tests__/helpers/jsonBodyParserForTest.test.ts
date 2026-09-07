import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  jsonBodyParserForTest,
  rawBodyParserForTest,
} from './jsonBodyParserForTest';

describe('jsonBodyParserForTest', () => {
  it('parses application/json bodies and exposes req.body', async () => {
    const app = express();
    app.use(jsonBodyParserForTest);
    app.post('/probe', (req, res) => res.json(req.body));

    const response = await request(app).post('/probe').send({ ping: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ping: true });
  });

  it('skips non-JSON bodies', async () => {
    const app = express();
    app.use(jsonBodyParserForTest);
    app.post('/probe', (req, res) => res.json({ body: req.body ?? null }));

    const response = await request(app).post('/probe').type('text').send('hello');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ body: null });
  });

  it('returns 400 for malformed JSON', async () => {
    const app = express();
    app.use(jsonBodyParserForTest);
    app.post('/probe', (_req, res) => res.json({ ok: true }));

    const response = await request(app)
      .post('/probe')
      .set('content-type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
  });

  it('returns 413 when the JSON body exceeds 100 KiB', async () => {
    const app = express();
    app.use(jsonBodyParserForTest);
    app.post('/probe', (_req, res) => res.json({ ok: true }));

    const response = await request(app)
      .post('/probe')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ payload: 'x'.repeat(101 * 1024) }));

    expect(response.status).toBe(413);
  });

  it('parses application/json bodies as a Buffer for raw webhook consumers', async () => {
    const app = express();
    app.use(rawBodyParserForTest({ limit: '10kb' }));
    app.post('/probe', (req, res) =>
      res.json({ isBuffer: Buffer.isBuffer(req.body), body: req.body.toString('utf8') }),
    );

    const response = await request(app).post('/probe').send({ signed: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ isBuffer: true, body: '{"signed":true}' });
  });

  it('returns 413 when a raw webhook body exceeds its configured limit', async () => {
    const app = express();
    app.use(rawBodyParserForTest({ limit: '10kb' }));
    app.post('/probe', (_req, res) => res.json({ ok: true }));

    const response = await request(app)
      .post('/probe')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ payload: 'x'.repeat(11 * 1024) }));

    expect(response.status).toBe(413);
  });
});
