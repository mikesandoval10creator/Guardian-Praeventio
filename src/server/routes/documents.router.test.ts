// Praeventio Guard — Bloque E4 documents router.
//
// Real-router supertest for the audited server-side project document write path.
// Client SDK writes to projects/{pid}/documents used to persist compliance
// document metadata without audit_logs (CLAUDE.md #3). This endpoint stamps
// identity from the verified token, validates a narrow metadata shape, and writes
// both the document row and audit row via the server Admin SDK. It performs no
// external API calls (PII stays in Firestore only).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = {
      uid,
      email: req.header('x-test-email') ?? null,
    } as Request['user'];
    next();
  },
}));

vi.mock('../middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import documentsRouter from './documents.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const PROJECT = 'p1';
const MEMBER = 'member-1';
const OUTSIDER = 'outsider-9';
const BASE = `/api/projects/${PROJECT}/documents`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', documentsRouter);
  return app;
}

function seedProject(members: string[] = [MEMBER]) {
  H.db!._seed(`projects/${PROJECT}`, {
    name: 'Obra Norte',
    tenantId: 'tenant-1',
    createdBy: 'creator-1',
    members,
  });
}

const asUser = (uid: string) => ({ 'x-test-uid': uid, 'x-test-email': `${uid}@praeventio.test` });
const auditRows = () =>
  [...H.db!._store.entries()]
    .filter(([k]) => k.startsWith('audit_logs/'))
    .map(([, v]) => v as Record<string, any>);

const validBody = {
  name: 'Informe de inspección mensual',
  type: 'pdf',
  url: 'https://storage.googleapis.com/praeventio-test/docs/informe.pdf',
  category: 'SST',
  status: 'Vigente',
  version: '1.0',
  size: 12345,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject();
});

describe('POST /:projectId/documents', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(BASE).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 for a non-member with a valid body', async () => {
    const res = await request(buildApp()).post(BASE).set(asUser(OUTSIDER)).send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project doc does not exist', async () => {
    H.db = createFakeFirestore();
    const res = await request(buildApp()).post(BASE).set(asUser(MEMBER)).send(validBody);
    expect(res.status).toBe(403);
  });

  it('400 when required document metadata is invalid', async () => {
    const res = await request(buildApp())
      .post(BASE)
      .set(asUser(MEMBER))
      .send({ ...validBody, name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('201 creates a project document with server-stamped identity and an audit row', async () => {
    const res = await request(buildApp()).post(BASE).set(asUser(MEMBER)).send(validBody);
    expect(res.status).toBe(201);
    expect(typeof res.body.documentId).toBe('string');
    expect(res.body.documentId.length).toBeGreaterThan(0);

    const doc = H.db!._store.get(`projects/${PROJECT}/documents/${res.body.documentId}`) as Record<string, any>;
    expect(doc).toBeTruthy();
    expect(doc.name).toBe(validBody.name);
    expect(doc.projectId).toBe(PROJECT);
    expect(doc.createdBy).toBe(MEMBER);
    expect(doc.updatedBy).toBe(MEMBER);
    expect(doc.createdAt).toBeTruthy();
    expect(doc.updatedAt).toBeTruthy();

    const audit = auditRows().find((r) => r.action === 'documents.create');
    expect(audit, 'a documents.create audit row must exist').toBeTruthy();
    expect(audit!.module).toBe('documents');
    expect(audit!.userId).toBe(MEMBER);
    expect(audit!.userEmail).toBe(`${MEMBER}@praeventio.test`);
    expect(audit!.projectId).toBe(PROJECT);
    expect(audit!.details).toMatchObject({ projectId: PROJECT, documentId: res.body.documentId });
  });

  it('201 ignores client-supplied projectId and identity spoof fields', async () => {
    const res = await request(buildApp())
      .post(BASE)
      .set(asUser(MEMBER))
      .send({
        ...validBody,
        projectId: 'evil-project',
        createdBy: 'evil',
        updatedBy: 'evil',
        createdAt: '1900-01-01T00:00:00.000Z',
        updatedAt: '1900-01-01T00:00:00.000Z',
      });

    expect(res.status).toBe(201);
    const doc = H.db!._store.get(`projects/${PROJECT}/documents/${res.body.documentId}`) as Record<string, any>;
    expect(doc.projectId).toBe(PROJECT);
    expect(doc.createdBy).toBe(MEMBER);
    expect(doc.updatedBy).toBe(MEMBER);
    expect(doc.createdAt).not.toBe('1900-01-01T00:00:00.000Z');
    expect(doc.updatedAt).not.toBe('1900-01-01T00:00:00.000Z');
  });
});
