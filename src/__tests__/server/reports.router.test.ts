// Real-router supertest for the PDF report generator
// (src/server/routes/reports.ts). One endpoint over the server-side PDFKit
// pipeline:
//
//   POST /api/reports/generate-pdf   (verifyAuth + validate(reportsGeneratePdfSchema))
//
// The router takes NO projectId gate (projectId is an optional tag only), so
// there is no 403 path — coverage is 401 (no token), 200 happy (real PDF bytes
// streamed back), and 400 (Zod validation rejects). The `validate` middleware
// (real Zod) and `verifyAuth` (real, via a fake firebase-admin auth) run
// unmocked over the REAL router; PDFKit runs unmocked so the response is a real
// generated PDF. We let `auditServerEvent` write to the fake Firestore so the
// audit row is observable, but the response completes before that fire-and-forget
// chain resolves (the handler emits audit inside `doc.on('end')` via `.then()`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  // verifyAuth calls admin.auth().verifyIdToken(token, true): map the Bearer
  // token straight to a uid so the real verifyAuth path is exercised (401 when
  // absent, decoded uid attached when present).
  const authImpl = {
    verifyIdToken: async (token: string) => {
      if (token === 'bad') throw new Error('invalid token');
      return { uid: token, email: `${token}@praeventio.test`, auth_time: Math.floor(Date.now() / 1000) };
    },
    getUser: async () => ({ uid: 'test' }),
  };
  return adminMock(() => H.db!, authImpl);
});
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import reportsRouter from '../../server/routes/reports.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', reportsRouter);
  return app;
}

const url = '/api/reports/generate-pdf';
const auth = { Authorization: 'Bearer u1' };

// supertest's default parser is text; for the binary PDF responses we collect
// raw chunks ourselves so we can assert on the real bytes.
// ponytail: `res` is the raw http.IncomingMessage at runtime, but supertest's
// `.parse()` Parser type declares superagent's Response — typed `any` so the
// stream API (.on) works at runtime while satisfying the .parse() signature.
function pdfParser(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('POST /api/reports/generate-pdf', () => {
  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ title: 'Reporte' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it('401 with an invalid bearer token', async () => {
    const res = await request(buildApp()).post(url).set({ Authorization: 'Bearer bad' }).send({ title: 'Reporte' });
    expect(res.status).toBe(401);
  });

  it('200 streams a real application/pdf buffer on the happy path', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(auth)
      .send({
        type: 'incident',
        title: 'Reporte de Incidente — Caída de altura',
        content: '# Resumen\nTrabajador sin arnés.\n## Acciones\n- Bloqueo de zona\n- Capacitación',
        incidentId: 'INC-42',
        metadata: { faena: 'Mina El Teniente', severidad: 'alta' },
      })
      .buffer(true)
      .parse(pdfParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    // Filename is derived from incidentId (real handler behavior).
    expect(res.headers['content-disposition']).toContain('Reporte_SUSESO_INC-42.pdf');
    const body = res.body as Buffer;
    // A real PDF starts with the "%PDF-" magic header and ends with %%EOF.
    expect(body.length).toBeGreaterThan(500);
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.subarray(-1024).toString('latin1')).toContain('%%EOF');
    // Content-Length header matches the streamed byte count.
    expect(Number(res.headers['content-length'])).toBe(body.length);
  });

  it('200 with minimal body (defaults to type=general, no content) still produces a PDF', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(auth)
      .send({ title: 'Documento mínimo' })
      .buffer(true)
      .parse(pdfParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    // No incidentId → filename falls back to a Date.now() suffix, not "undefined".
    expect(res.headers['content-disposition']).toMatch(/Reporte_SUSESO_\d+\.pdf/);
    expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('400 when title is missing (required by schema)', async () => {
    const res = await request(buildApp()).post(url).set(auth).send({ content: 'sin título' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('400 when title is empty (min(1))', async () => {
    const res = await request(buildApp()).post(url).set(auth).send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an unknown type enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(auth)
      .send({ title: 'Reporte', type: 'catastrofico' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when title exceeds the 256-char cap', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(auth)
      .send({ title: 'x'.repeat(257) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});
