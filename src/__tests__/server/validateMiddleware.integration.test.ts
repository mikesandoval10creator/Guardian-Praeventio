// Praeventio Guard — Sprint 28 Bucket B3 (audit hallazgo H17).
//
// Endpoint-level integration coverage for the 5 routes that adopted the
// transversal Zod validation middleware in this sprint. Each test wires
// the real Zod schema (re-declared here to match the source verbatim —
// the schemas are inline in their respective route files; co-locating
// them is a Sprint 29 cleanup) onto a minimal Express app with the real
// `validate()` factory, then sends a malformed payload and asserts the
// canonical 400 envelope:
//
//   { error: 'invalid_payload', issues: [...] }
//
// We do NOT exercise the downstream business logic here — that lives in
// the per-route test files (`emergency.test.ts`, `billing.appleSsn.test.ts`,
// etc.). The only contract we pin is: the middleware fires before the
// handler and produces the unified envelope. Full handler coverage with
// the validation barrier in place stays where it already is.

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

import { validate } from '../../server/middleware/validate.js';

function appWith(path: string, schema: z.ZodTypeAny, method: 'post' | 'get' = 'post') {
  const app = express();
  app.use(express.json());
  if (method === 'post') {
    app.post(path, validate(schema), (_req, res) => {
      // Stub handler — never reached on the malformed-payload path.
      res.json({ ok: true });
    });
  } else {
    app.get(path, validate(schema), (_req, res) => {
      res.json({ ok: true });
    });
  }
  return app;
}

// ──────────────────────────────────────────────────────────────────────
// 1. POST /api/emergency/notify-brigada
// ──────────────────────────────────────────────────────────────────────
const notifyBrigadaSchema = z.object({
  projectId: z.string().min(1).max(128),
  emergencyType: z.enum(['fall', 'sos', 'medical', 'fire', 'gas', 'collapse', 'other']),
  message: z.string().max(500).optional(),
});

describe('POST /api/emergency/notify-brigada — Zod barrier', () => {
  it('returns 400 invalid_payload when projectId is missing', async () => {
    const app = appWith('/api/emergency/notify-brigada', notifyBrigadaSchema);
    const res = await request(app)
      .post('/api/emergency/notify-brigada')
      .send({ emergencyType: 'fall' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('returns 400 invalid_payload when emergencyType is not in the enum', async () => {
    const app = appWith('/api/emergency/notify-brigada', notifyBrigadaSchema);
    const res = await request(app)
      .post('/api/emergency/notify-brigada')
      .send({ projectId: 'p-1', emergencyType: 'meteor' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ──────────────────────────────────────────────────────────────────────
// 2. POST /api/billing/webhook/apple
// ──────────────────────────────────────────────────────────────────────
const appleWebhookSchema = z.object({
  signedPayload: z.string().min(1),
});

describe('POST /api/billing/webhook/apple — Zod barrier', () => {
  it('returns 400 invalid_payload when signedPayload is missing', async () => {
    const app = appWith('/api/billing/webhook/apple', appleWebhookSchema);
    const res = await request(app).post('/api/billing/webhook/apple').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 invalid_payload when signedPayload is empty', async () => {
    const app = appWith('/api/billing/webhook/apple', appleWebhookSchema);
    const res = await request(app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ──────────────────────────────────────────────────────────────────────
// 3. POST /api/zettelkasten/nodes
//   (the user spec said /note; the actual route is /nodes — see file
//   header in src/server/routes/zettelkasten.ts.)
// ──────────────────────────────────────────────────────────────────────
const zettelkastenWriteSchema = z.object({
  projectId: z.string().min(1).max(128),
  nodes: z.array(z.object({
    title: z.string().min(1).max(256),
    content: z.string().max(8192).optional(),
    description: z.string().min(1).max(4096),
    type: z.string().min(1),
    severity: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
    connections: z.array(z.string().max(256)),
    references: z.array(z.string().max(256)),
    tags: z.array(z.string()).optional(),
    idempotencyKey: z.string().min(1).max(256),
  }).passthrough()).min(1).max(32),
});

describe('POST /api/zettelkasten/nodes — Zod barrier', () => {
  it('returns 400 invalid_payload when nodes is empty', async () => {
    const app = appWith('/api/zettelkasten/nodes', zettelkastenWriteSchema);
    const res = await request(app)
      .post('/api/zettelkasten/nodes')
      .send({ projectId: 'p-1', nodes: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 invalid_payload when a node is missing required fields', async () => {
    const app = appWith('/api/zettelkasten/nodes', zettelkastenWriteSchema);
    const res = await request(app)
      .post('/api/zettelkasten/nodes')
      .send({ projectId: 'p-1', nodes: [{ title: 'x' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ──────────────────────────────────────────────────────────────────────
// 4. POST /api/reports/generate-pdf
//   (the user spec said /reports/incident; the actual route is
//   /reports/generate-pdf — that's the de-facto incident-report endpoint
//   in the SUSESO PDF pipeline.)
// ──────────────────────────────────────────────────────────────────────
const reportsGeneratePdfSchema = z.object({
  type: z.enum(['general', 'incident', 'safety', 'compliance', 'inspection', 'training']).default('general'),
  title: z.string().min(1).max(256),
  description: z.string().max(8192).optional(),
  content: z.string().max(65536).optional(),
  projectId: z.string().min(1).max(128).optional(),
  incidentId: z.string().max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

describe('POST /api/reports/generate-pdf — Zod barrier', () => {
  it('returns 400 invalid_payload when title is missing', async () => {
    const app = appWith('/api/reports/generate-pdf', reportsGeneratePdfSchema);
    const res = await request(app)
      .post('/api/reports/generate-pdf')
      .send({ type: 'incident' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 invalid_payload when type is outside the enum', async () => {
    const app = appWith('/api/reports/generate-pdf', reportsGeneratePdfSchema);
    const res = await request(app)
      .post('/api/reports/generate-pdf')
      .send({ title: 'x', type: 'meteorology' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ──────────────────────────────────────────────────────────────────────
// 5. POST /api/compliance/data-request
// ──────────────────────────────────────────────────────────────────────
const dataRequestSchema = z.object({
  type: z.enum(['access', 'rectification', 'erasure', 'portability']),
  rectificationPayload: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().max(1024).optional(),
  targetUid: z.string().min(1).max(128).optional(),
});

describe('POST /api/compliance/data-request — Zod barrier', () => {
  it('returns 400 invalid_payload when type is missing', async () => {
    const app = appWith('/api/compliance/data-request', dataRequestSchema);
    const res = await request(app)
      .post('/api/compliance/data-request')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 invalid_payload when type is outside the enum', async () => {
    const app = appWith('/api/compliance/data-request', dataRequestSchema);
    const res = await request(app)
      .post('/api/compliance/data-request')
      .send({ type: 'wipe-everything' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});
